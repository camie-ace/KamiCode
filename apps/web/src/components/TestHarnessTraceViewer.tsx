/* oxlint-disable react/iframe-missing-sandbox -- Playwright Trace Viewer needs same-origin service worker access to authenticated trace artifacts. */
import { ExternalLinkIcon, FileArchiveIcon, MonitorPlayIcon } from "lucide-react";
import { useState } from "react";

import {
  artifactFileName,
  testHarnessArtifactUrl,
  testHarnessTraceViewerUrl,
} from "~/testHarnessArtifacts";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "./ui/sheet";

interface TestHarnessTraceViewerProps {
  readonly tracePath: string | undefined;
  readonly className?: string | undefined;
  readonly label?: string | undefined;
  readonly compact?: boolean | undefined;
}

export function TestHarnessTraceViewer({
  tracePath,
  className,
  label = "Trace viewer",
  compact = false,
}: TestHarnessTraceViewerProps) {
  const [open, setOpen] = useState(false);

  if (!tracePath) {
    return null;
  }

  const viewerUrl = testHarnessTraceViewerUrl(tracePath);
  const artifactUrl = testHarnessArtifactUrl(tracePath);
  const filename = artifactFileName(tracePath);

  return (
    <>
      <Button
        variant="outline"
        size="xs"
        className={cn("text-muted-foreground hover:text-foreground", className)}
        title={`Open ${filename} in the integrated Playwright trace viewer`}
        render={
          <a
            href={viewerUrl}
            data-artifact-url={artifactUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              setOpen(true);
            }}
          />
        }
      >
        <MonitorPlayIcon className="size-3" />
        {compact ? "Trace" : label}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPopup side="right" variant="inset" className="max-w-[min(96vw,90rem)]">
          <SheetHeader>
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div className="min-w-0">
                <SheetTitle>Playwright Trace</SheetTitle>
                <SheetDescription className="truncate">
                  {filename} rendered from the saved harness artifact.
                </SheetDescription>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="outline"
                  size="xs"
                  render={<a href={artifactUrl} target="_blank" rel="noreferrer" />}
                >
                  <FileArchiveIcon className="size-3" />
                  ZIP
                  <ExternalLinkIcon className="size-2.5 opacity-55" />
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  render={<a href={viewerUrl} target="_blank" rel="noreferrer" />}
                >
                  <ExternalLinkIcon className="size-3" />
                  New tab
                </Button>
              </div>
            </div>
          </SheetHeader>
          <SheetPanel className="p-0">
            <iframe
              title={`Playwright trace ${filename}`}
              src={viewerUrl}
              className="h-[calc(100vh-8rem)] w-full border-0 bg-background"
            />
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </>
  );
}
