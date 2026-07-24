import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { uploadEnvironmentWorkspaceFiles } from "@t3tools/client-runtime/state/filesystem";
import { FileTree, useFileTree } from "@pierre/trees/react";
import * as Option from "effect/Option";
import { LoaderCircle, RefreshCw, Search, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTheme } from "~/hooks/useTheme";
import { runtime } from "~/lib/runtime";
import { cn } from "~/lib/utils";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { usePreparedConnection } from "~/state/session";
import { toastManager } from "~/components/ui/toast";

import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  onOpenFile: (relativePath: string) => void;
}

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }
`;

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "" : path.slice(0, index);
}

function uploadDestinationLabel(directory: string): string {
  return directory.length > 0 ? directory : "project root";
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  onOpenFile,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const preparedConnection = usePreparedConnection(environmentId);
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd);
  const entries = entriesQuery.data?.entries ?? [];
  const entryKinds = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry.kind] as const)),
    [entries],
  );
  const entryKindsRef = useRef<ReadonlyMap<string, ProjectEntry["kind"]>>(entryKinds);
  const treePaths = useMemo(() => entries.map(treePath), [entries]);
  const previousTreePathsRef = useRef<readonly string[]>([]);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadDragDepthRef = useRef(0);
  const [uploadDirectory, setUploadDirectory] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (!selectedPath) {
        setUploadDirectory("");
        return;
      }
      if (entryKindsRef.current.get(selectedPath) === "file") {
        setUploadDirectory(parentDirectory(selectedPath));
        onOpenFile(selectedPath);
      } else {
        setUploadDirectory(selectedPath);
      }
    },
    paths: [],
    search: true,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    previousTreePathsRef.current = treePaths;
    model.resetPaths(treePaths);
  }, [entryKinds, model, treePaths]);

  const fileCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || isUploading) return;
    if (Option.isNone(preparedConnection)) {
      toastManager.add({
        type: "error",
        title: "Project upload is unavailable",
        description: "Reconnect this environment and try again.",
      });
      return;
    }

    setIsUploading(true);
    try {
      const result = await runtime.runPromise(
        uploadEnvironmentWorkspaceFiles({
          prepared: preparedConnection.value,
          cwd,
          directory: uploadDirectory,
          conflict: "keep-both",
          files,
        }),
      );
      entriesQuery.refresh();
      const uploaded = result.files.filter((file) => file.status !== "skipped");
      const renamed = result.files.filter((file) => file.status === "renamed");
      toastManager.add({
        type: "success",
        title: `Uploaded ${uploaded.length} ${uploaded.length === 1 ? "file" : "files"}`,
        description:
          renamed.length > 0
            ? `${renamed.length} existing ${renamed.length === 1 ? "name was" : "names were"} kept; the new ${renamed.length === 1 ? "file was" : "files were"} renamed.`
            : `Saved to ${uploadDestinationLabel(uploadDirectory)}.`,
      });
      if (uploaded.length === 1 && uploaded[0]) {
        onOpenFile(uploaded[0].relativePath);
      }
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: "Could not upload files",
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setIsUploading(false);
    }
  };

  const onUploadInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void uploadFiles(files);
  };

  const onUploadDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    uploadDragDepthRef.current += 1;
    setIsDraggingUpload(true);
  };

  const onUploadDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingUpload(true);
  };

  const onUploadDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    uploadDragDepthRef.current = 0;
    setIsDraggingUpload(false);
  };

  const onUploadDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    uploadDragDepthRef.current = 0;
    setIsDraggingUpload(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-background"
      data-file-browser-panel={`${environmentId}:${cwd}`}
      onDragEnter={onUploadDragEnter}
      onDragOver={onUploadDragOver}
      onDragLeave={onUploadDragLeave}
      onDrop={onUploadDrop}
    >
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        tabIndex={-1}
        className="sr-only"
        data-workspace-upload-input="true"
        onChange={onUploadInputChange}
      />
      {isDraggingUpload ? (
        <div
          className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border border-primary/60 bg-background/90 px-4 text-center text-xs font-medium text-foreground backdrop-blur-sm"
          data-workspace-upload-drop-overlay="true"
        >
          Drop files to upload to {uploadDestinationLabel(uploadDirectory)}
        </div>
      ) : null}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{projectName}</div>
          <div className="truncate text-[10px] leading-none text-muted-foreground">
            {entriesQuery.isPending && entriesQuery.data === null
              ? "Indexing…"
              : `${fileCount.toLocaleString()} files`}
            {entriesQuery.data?.truncated ? " · partial" : ""}
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label={`Upload files to ${uploadDestinationLabel(uploadDirectory)}`}
          title={`Upload files to ${uploadDestinationLabel(uploadDirectory)}. Existing files are kept and new copies are renamed.`}
          disabled={isUploading || Option.isNone(preparedConnection)}
          onClick={() => uploadInputRef.current?.click()}
        >
          {isUploading ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Search workspace files"
          onClick={() => model.openSearch()}
        >
          <Search className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Refresh workspace files"
          onClick={entriesQuery.refresh}
        >
          <RefreshCw className={cn("size-3.5", entriesQuery.isPending && "animate-spin")} />
        </button>
      </div>
      {entriesQuery.error && entriesQuery.data === null ? (
        <div className="p-4 text-xs leading-relaxed text-destructive">{entriesQuery.error}</div>
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={{
            colorScheme: resolvedTheme,
            ["--trees-fg-override" as string]: "var(--foreground)",
          }}
        />
      )}
    </div>
  );
}
