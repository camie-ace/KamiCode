import type {
  ProjectId,
  SharedDeployAssociation,
  SharedEnvironmentType,
  SharedProjectDetail,
  SharedProjectEnvironment,
  SharedProjectId,
  SharedProjectRole,
  ServerSettingsPatch,
  SharedRuntimeHealth,
  SharedRuntimeType,
  SharedSshAuthType,
  SharedThread,
  SharedThreadVisibility,
} from "@t3tools/contracts";
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ProviderInstanceId,
  SharedProjectEnvironmentId,
  SharedProjectInviteCode,
  SharedSshCredentialId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { useNavigate } from "@tanstack/react-router";
import {
  CloudIcon,
  Code2Icon,
  GitBranchIcon,
  KeyRoundIcon,
  LinkIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  ServerIcon,
  Share2Icon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  claimSharedProjectInvite,
  createSharedProjectInvite,
  deleteSharedProject,
  fetchSharedProjectCurrentUser,
  fetchSharedProjectDetail,
  importSharedThread,
  listSharedProjects,
  publishLocalProject,
  publishSharedThread,
  removeSharedProjectMember,
  removeSharedSshCredential,
  setSharedDefaultEnvironment,
  syncSharedProjectContext,
  syncSharedRemoteRuntime,
  updateSharedProjectMemberRole,
  updateSharedThreadVisibility,
  upsertSharedDeployAssociation,
  upsertSharedEnvironment,
  upsertSharedRuntime,
  upsertSharedSshCredential,
} from "../../sharedProjectsApi";
import { buildThreadRouteParams } from "../../threadRoutes";
import {
  selectProjectsAcrossEnvironments,
  selectThreadShellsAcrossEnvironments,
  useStore,
} from "../../store";
import {
  loadThreadDetailForSharing,
  toSharedSessionSnapshot,
  toSharedThreadMessages,
} from "../../sharedSessionSnapshot";
import {
  useSavedEnvironmentRegistryStore,
  waitForSavedEnvironmentRegistryHydration,
  type SavedEnvironmentRecord,
} from "../../environments/runtime";
import { readEnvironmentApi } from "../../environmentApi";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { resolveInitialPrimaryEnvironmentDescriptor } from "../../environments/primary";
import { useSettings } from "../../hooks/useSettings";
import { newCommandId, newMessageId, newProjectId, newThreadId } from "../../lib/utils";
import { applySettingsUpdated } from "../../rpc/serverState";
import type { Project, ThreadShell } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const SELECT_CLASS =
  "h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-xs/5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded" }
  | { readonly status: "error"; readonly message: string };

type CurrentSharedUser = Awaited<ReturnType<typeof fetchSharedProjectCurrentUser>>["user"];
type CollabDeployFailure = {
  readonly rawMessage: string;
  readonly displayMessage: string;
  readonly mode: "deploy" | "install-docker";
  readonly occurredAt: string;
};

const roleOptions: readonly SharedProjectRole[] = ["admin", "member", "viewer"];
const environmentTypes: readonly SharedEnvironmentType[] = [
  "local-dev",
  "preview",
  "vps-staging",
  "production",
  "custom",
];
const runtimeTypes: readonly SharedRuntimeType[] = ["local", "ssh-vps", "hosted-worker"];
const runtimeHealthOptions: readonly SharedRuntimeHealth[] = ["healthy", "unknown", "unavailable"];
const sshAuthTypes: readonly SharedSshAuthType[] = ["agent", "password", "private-key"];
const COLLAB_DEPLOY_REPAIR_PROJECT_TITLE = "KamiCode deploy repair";

function isSharedProjectNotFoundError(error: unknown): boolean {
  return error instanceof Error && /\b404\b|not found/i.test(error.message);
}

function isMissingDockerCollabDeployError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Missing required command on SSH target:\s*docker/i.test(message);
}

function collabDeployRecovery(error: unknown): "install-docker" | null {
  return isMissingDockerCollabDeployError(error) ? "install-docker" : null;
}

function normalizeCollabDeployError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isMissingDockerCollabDeployError(error)) {
    return "Docker is not installed on the selected SSH target. Run the guided repair from this screen, or save an existing collaboration server URL and token.";
  }
  if (/Remote deploy repair requires root access or passwordless sudo/i.test(message)) {
    return "Guided deploy repair needs root access or passwordless sudo on the selected SSH server. Connect as root/admin or install the missing prerequisites manually, then deploy again.";
  }
  if (/Automatic deploy repair cannot install/i.test(message)) {
    return message.replace(/^Error invoking remote method 'desktop:deploy-collab-server':\s*/u, "");
  }
  if (/Deploy repair attempted to install/i.test(message)) {
    return message.replace(/^Error invoking remote method 'desktop:deploy-collab-server':\s*/u, "");
  }
  if (/Missing required command on SSH target:\s*git/i.test(message)) {
    return "Git is not installed on the selected SSH target. Install Git on that server, then deploy again.";
  }
  if (/Missing required command on SSH target:\s*curl/i.test(message)) {
    return "curl is not installed on the selected SSH target. Install curl on that server, then deploy again.";
  }
  if (/Docker is installed but not usable/i.test(message)) {
    return "Docker is installed, but this SSH user cannot use it. Add the user to the Docker group, reconnect SSH, then deploy again.";
  }
  if (/Collaboration server started check failed/i.test(message)) {
    return "The SSH deploy finished, but the URL is not accepting the generated token. Another collaboration server is probably already using that port. Stop the old service on the server, or save the existing server URL with its matching token.";
  }
  if (/requires a Linux SSH target/i.test(message)) {
    return "Collaboration server auto-deploy currently requires a Linux SSH target.";
  }
  if (/permission denied|authentication failed|too many authentication failures/i.test(message)) {
    return "SSH authentication failed for the selected connection. Check the password or saved SSH key, then deploy again.";
  }
  return message.replace(/^Error invoking remote method 'desktop:deploy-collab-server':\s*/u, "");
}

function normalizeInstallDockerDeployError(error: unknown): string {
  if (isMissingDockerCollabDeployError(error)) {
    return "The guided repair request did not reach the desktop deploy process. Restart the desktop app, then click Repair & deploy again.";
  }
  return normalizeCollabDeployError(error);
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatActionError(key: string, error: unknown): string {
  if (key === "deploy-collab-server") {
    return normalizeCollabDeployError(error);
  }
  return error instanceof Error ? error.message : "Shared project action failed.";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : "unknown";
}

function roleBadgeVariant(role: SharedProjectRole): "default" | "secondary" | "outline" {
  if (role === "owner") return "default";
  if (role === "admin") return "secondary";
  return "outline";
}

function projectRepoLabel(project: SharedProjectDetail["project"]): string {
  return (
    project.repository.canonicalKey ??
    project.repository.remoteUrl ??
    project.repository.currentBranch ??
    "No Git remote detected"
  );
}

function localProjectMatchesSharedProject(
  project: Project,
  sharedProject: SharedProjectDetail["project"] | null,
): boolean {
  if (!sharedProject) return false;
  if (sharedProject.sourceProjectId !== null && project.id === sharedProject.sourceProjectId) {
    return true;
  }
  const sharedCanonicalKey = sharedProject.repository.canonicalKey;
  return Boolean(
    sharedCanonicalKey &&
    project.repositoryIdentity?.canonicalKey &&
    project.repositoryIdentity.canonicalKey === sharedCanonicalKey,
  );
}

function detailCanManage(detail: SharedProjectDetail | null): boolean {
  return detail?.project.role === "owner" || detail?.project.role === "admin";
}

function detailCanEdit(detail: SharedProjectDetail | null): boolean {
  return detailCanManage(detail) || detail?.project.role === "member";
}

function formatSshCredential(
  credential: SharedProjectDetail["sshCredentials"][number] | null,
): string {
  return credential
    ? `${credential.username}@${credential.host}:${credential.port}`
    : "No SSH credential";
}

function formatSavedSshConnection(record: SavedEnvironmentRecord): string {
  const target = record.desktopSsh;
  if (!target) return record.label;
  const host = target.hostname || target.alias;
  const user = target.username ? `${target.username}@` : "";
  const port = target.port ? `:${target.port}` : "";
  return `${record.label} (${user}${host}${port})`;
}

function defaultCollabPublicBaseUrl(record: SavedEnvironmentRecord | null): string {
  const target = record?.desktopSsh;
  if (!target) return "";
  const host = target.hostname || target.alias;
  return host ? `http://${host}:8787` : "";
}

function buildCollabDeployAiRepairPrompt(input: {
  readonly failure: CollabDeployFailure;
  readonly connection: SavedEnvironmentRecord | null;
  readonly publicBaseUrl: string;
  readonly project: Project | null;
}): string {
  const target = input.connection?.desktopSsh;
  const connectionLabel = input.connection ? formatSavedSshConnection(input.connection) : "None";
  const targetHost = target
    ? `${target.username ? `${target.username}@` : ""}${target.hostname || target.alias}:${target.port ?? 22}`
    : "Unknown";
  const projectLabel = input.project
    ? `${input.project.name} (${input.project.cwd})`
    : "No local project selected";
  const repairAttempted =
    input.failure.mode === "install-docker"
      ? "Yes, guided prerequisite repair was attempted."
      : "No, this was the first deploy attempt.";

  return [
    "Actively repair this KamiCode collaboration server deploy failure.",
    "",
    "Goal:",
    "- Fix the root cause so the next Collaboration Server > Deploy or Repair & deploy attempt succeeds.",
    "- Do not stop after summarizing context.",
    "- Do not only propose a plan if you can safely inspect or change the workspace.",
    "- If the failure requires remote credentials, sudo input, or another secret that is not available to you, explain the exact UI step I should take next instead of asking me to paste secrets into chat.",
    "",
    "Context:",
    `- Local project: ${projectLabel}`,
    `- SSH connection: ${connectionLabel}`,
    `- SSH target: ${targetHost}`,
    `- Public collaboration URL requested: ${input.publicBaseUrl || "not provided"}`,
    `- Repair already attempted: ${repairAttempted}`,
    `- Failure time: ${input.failure.occurredAt}`,
    "",
    "User-visible error:",
    input.failure.displayMessage,
    "",
    "Raw deploy error:",
    "```text",
    input.failure.rawMessage,
    "```",
    "",
    "Repair instructions:",
    "1. Inspect the local deploy implementation first, especially apps/web/src/components/settings/SharedProjectsSettings.tsx, apps/desktop/src/ssh/DesktopCollabServerDeploy.ts, apps/desktop/src/ipc/methods/sshEnvironment.ts, and packages/contracts/src/ipc.ts.",
    "2. Decide whether this is an app-code bug, a remote-host prerequisite issue, an SSH/auth issue, or a stale desktop-main-process issue.",
    "3. If it is an app-code bug, edit the repo and run the required checks before finishing.",
    "4. If it is a remote-host issue and you have an approved way to inspect the SSH target, run only minimal diagnostic/repair commands through the normal KamiCode approval flow.",
    "5. Do not request or expose the SSH password, hosted collaboration bearer token, GitHub OAuth secret, private keys, provider credentials, or raw .env values.",
    "6. You cannot read the one-time SSH password from the Shared Projects form. If deployment must be retried with that password, tell me to return to Shared Projects settings and click Deploy or Repair & deploy again.",
    "7. Finish with a clear result: fixed in code, fixed on remote host, or blocked with the exact next action.",
  ].join("\n");
}

function localThreadsForProject(
  threads: readonly ThreadShell[],
  sourceProjectId: ProjectId | null,
): ThreadShell[] {
  if (!sourceProjectId) return [];
  return threads.filter(
    (thread) => thread.projectId === sourceProjectId && thread.archivedAt === null,
  );
}

function ProjectStatusBadge({ detail }: { readonly detail: SharedProjectDetail }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant={detail.project.repository.dirty ? "warning" : "success"} size="sm">
        {detail.project.repository.dirty ? "Dirty work" : "Clean HEAD"}
      </Badge>
      <Badge variant="outline" size="sm">
        {detail.project.repository.currentBranch ?? "No branch"}
      </Badge>
      <Badge variant="outline" size="sm">
        {shortSha(detail.project.repository.headSha)}
      </Badge>
    </div>
  );
}

function EmptyRow({ children }: { readonly children: ReactNode }) {
  return (
    <div className="border-t border-border/60 px-4 py-4 first:border-t-0 sm:px-5">
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

export function SharedProjectsSettings() {
  const navigate = useNavigate();
  const hostedCollaboration = useSettings((settings) => settings.hostedCollaboration);
  const localProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const localThreads = useStore(useShallow(selectThreadShellsAcrossEnvironments));
  const savedEnvironmentById = useSavedEnvironmentRegistryStore((state) => state.byId);
  const [currentUser, setCurrentUser] = useState<CurrentSharedUser | null>(null);
  const [sharedProjects, setSharedProjects] = useState<
    ReadonlyArray<SharedProjectDetail["project"]>
  >([]);
  const [selectedProjectId, setSelectedProjectId] = useState<SharedProjectId | null>(null);
  const [detail, setDetail] = useState<SharedProjectDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [claimCode, setClaimCode] = useState("");
  const [inviteLogin, setInviteLogin] = useState("");
  const [inviteRole, setInviteRole] = useState<SharedProjectRole>("member");
  const [lastInviteCode, setLastInviteCode] = useState<string | null>(null);
  const [stopSharingConfirmationProjectId, setStopSharingConfirmationProjectId] =
    useState<SharedProjectId | null>(null);
  const [newRuntime, setNewRuntime] = useState({
    type: "ssh-vps" as SharedRuntimeType,
    label: "VPS runtime",
    endpoint: "",
    health: "healthy" as SharedRuntimeHealth,
    sshCredentialId: "",
  });
  const [editingSshCredentialId, setEditingSshCredentialId] = useState<string | null>(null);
  const [sshCredentialForm, setSshCredentialForm] = useState({
    label: "VPS SSH",
    host: "",
    port: "22",
    username: "root",
    authType: "private-key" as SharedSshAuthType,
    password: "",
    privateKey: "",
    passphrase: "",
  });
  const [newEnvironment, setNewEnvironment] = useState({
    name: "VPS Staging",
    type: "vps-staging" as SharedEnvironmentType,
    baseUrl: "",
    isDefault: false,
  });
  const [deployForm, setDeployForm] = useState({
    branch: "",
    environmentId: "",
    deployUrl: "",
    deployedSha: "",
  });
  const [importTargetProjectId, setImportTargetProjectId] = useState<ProjectId | "">("");
  const [acceptedBootstrap, setAcceptedBootstrap] = useState<
    Awaited<ReturnType<typeof claimSharedProjectInvite>>["bootstrap"] | null
  >(null);
  const [collabServerForm, setCollabServerForm] = useState({
    url: hostedCollaboration.url,
    token: "",
    publicBaseUrl: "",
    selectedEnvironmentId: "",
    password: "",
  });
  const [collabDeployRecoveryAction, setCollabDeployRecoveryAction] = useState<
    "install-docker" | null
  >(null);
  const [collabDeployPendingMode, setCollabDeployPendingMode] = useState<
    "deploy" | "install-docker"
  >("deploy");
  const collabDeployPendingModeRef = useRef<"deploy" | "install-docker">("deploy");
  const [lastCollabDeployFailure, setLastCollabDeployFailure] =
    useState<CollabDeployFailure | null>(null);
  const [collabDeployRepairPromptCopied, setCollabDeployRepairPromptCopied] = useState(false);

  const selectedLocalProject = useMemo(
    () =>
      localProjects.find((project) => project.id === detail?.project.sourceProjectId) ??
      localProjects.find((project) =>
        localProjectMatchesSharedProject(project, detail?.project ?? null),
      ) ??
      null,
    [detail?.project, localProjects],
  );
  const preferredImportTargetProject = useMemo(
    () =>
      localProjects.find((project) =>
        localProjectMatchesSharedProject(project, detail?.project ?? null),
      ) ??
      localProjects[0] ??
      null,
    [detail?.project, localProjects],
  );
  const importTargetProject = useMemo(
    () =>
      localProjects.find((project) => project.id === importTargetProjectId) ??
      preferredImportTargetProject,
    [importTargetProjectId, localProjects, preferredImportTargetProject],
  );
  const sharedProjectBySourceProjectId = useMemo(
    () => new Map(sharedProjects.map((project) => [project.sourceProjectId, project] as const)),
    [sharedProjects],
  );
  const activeLocalThreads = useMemo(
    () => localThreadsForProject(localThreads, selectedLocalProject?.id ?? null),
    [localThreads, selectedLocalProject?.id],
  );
  const sharedThreadsByLocalId = useMemo(() => {
    const result = new Map<string, SharedThread[]>();
    for (const thread of detail?.threads ?? []) {
      if (thread.localThreadId === null) continue;
      result.set(thread.localThreadId, [...(result.get(thread.localThreadId) ?? []), thread]);
    }
    return result;
  }, [detail?.threads]);
  const defaultEnvironment =
    detail?.environments.find((environment) => environment.isDefault) ?? null;
  const sshCredentialById = useMemo(
    () =>
      new Map<string, SharedProjectDetail["sshCredentials"][number]>(
        (detail?.sshCredentials ?? []).map((credential) => [credential.id, credential] as const),
      ),
    [detail?.sshCredentials],
  );
  const savedSshConnections = useMemo(
    () =>
      Object.values(savedEnvironmentById)
        .filter((record) => record.desktopSsh)
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    [savedEnvironmentById],
  );
  const selectedDeployConnection =
    savedSshConnections.find(
      (record) => record.environmentId === collabServerForm.selectedEnvironmentId,
    ) ??
    savedSshConnections[0] ??
    null;
  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const hasHostedCollabConfig =
    hostedCollaboration.url.trim().length > 0 && hostedCollaboration.tokenRedacted;
  const isDeployingCollabServer = pendingAction === "deploy-collab-server";
  const isOpeningCollabDeployAiRepairThread =
    pendingAction === "open-collab-deploy-ai-repair-thread";
  const collabDeployPendingMessage =
    collabDeployPendingMode === "install-docker"
      ? "Repairing known deploy prerequisites on the SSH server, then deploying the collaboration server. This can take a few minutes."
      : "Deploying the collaboration server on the selected SSH server. This can take a few minutes.";
  const collabDeployAiRepairProject =
    selectedLocalProject ?? preferredImportTargetProject ?? localProjects[0] ?? null;
  const collabDeployAiRepairPrompt = lastCollabDeployFailure
    ? buildCollabDeployAiRepairPrompt({
        connection: selectedDeployConnection,
        failure: lastCollabDeployFailure,
        project: collabDeployAiRepairProject,
        publicBaseUrl:
          collabServerForm.publicBaseUrl.trim() ||
          defaultCollabPublicBaseUrl(selectedDeployConnection),
      })
    : "";

  const commitDetail = useCallback((nextDetail: SharedProjectDetail) => {
    setDetail(nextDetail);
    setSelectedProjectId(nextDetail.project.id);
    setSharedProjects((current) => {
      const without = current.filter((project) => project.id !== nextDetail.project.id);
      return [nextDetail.project, ...without].toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    });
  }, []);

  const load = useCallback(
    async (preferredProjectId?: SharedProjectId | null) => {
      setLoadState({ status: "loading" });
      try {
        const [userResult, listResult] = await Promise.all([
          fetchSharedProjectCurrentUser(),
          listSharedProjects(),
        ]);
        setCurrentUser(userResult.user);
        setSharedProjects(listResult.projects);
        const projectIds = new Set(listResult.projects.map((project) => project.id));
        const requestedProjectId = preferredProjectId ?? selectedProjectId;
        const nextSelectedId =
          requestedProjectId && projectIds.has(requestedProjectId)
            ? requestedProjectId
            : (listResult.projects[0]?.id ?? null);
        setSelectedProjectId(nextSelectedId);
        if (nextSelectedId) {
          try {
            setDetail(await fetchSharedProjectDetail(nextSelectedId));
          } catch (error) {
            if (!isSharedProjectNotFoundError(error)) {
              throw error;
            }
            setSelectedProjectId(null);
            setDetail(null);
          }
        } else {
          setDetail(null);
        }
        setLoadState({ status: "loaded" });
      } catch (error) {
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load shared projects.",
        });
      }
    },
    [selectedProjectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void waitForSavedEnvironmentRegistryHydration();
  }, []);

  useEffect(() => {
    setCollabServerForm((current) => ({
      ...current,
      url: hostedCollaboration.url,
      token: "",
    }));
  }, [hostedCollaboration.url, hostedCollaboration.tokenRedacted]);

  useEffect(() => {
    if (
      collabServerForm.selectedEnvironmentId &&
      savedSshConnections.some(
        (record) => record.environmentId === collabServerForm.selectedEnvironmentId,
      )
    ) {
      return;
    }
    const nextConnection = savedSshConnections[0] ?? null;
    setCollabServerForm((current) => ({
      ...current,
      selectedEnvironmentId: nextConnection?.environmentId ?? "",
      publicBaseUrl: current.publicBaseUrl || defaultCollabPublicBaseUrl(nextConnection),
    }));
  }, [collabServerForm.selectedEnvironmentId, savedSshConnections]);

  useEffect(() => {
    setStopSharingConfirmationProjectId(null);
  }, [detail?.project.id]);

  useEffect(() => {
    if (
      importTargetProjectId &&
      localProjects.some((project) => project.id === importTargetProjectId)
    ) {
      return;
    }
    setImportTargetProjectId(preferredImportTargetProject?.id ?? "");
  }, [importTargetProjectId, localProjects, preferredImportTargetProject?.id]);

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setPendingAction(key);
    setLoadState({ status: "loaded" });
    try {
      await action();
      if (key === "deploy-collab-server") {
        setCollabDeployRecoveryAction(null);
        setLastCollabDeployFailure(null);
        setCollabDeployRepairPromptCopied(false);
      }
    } catch (error) {
      const mode = collabDeployPendingModeRef.current;
      const displayMessage =
        key === "deploy-collab-server" && mode === "install-docker"
          ? normalizeInstallDockerDeployError(error)
          : formatActionError(key, error);
      if (key === "deploy-collab-server") {
        setCollabDeployRecoveryAction(collabDeployRecovery(error));
        setLastCollabDeployFailure({
          rawMessage: rawErrorMessage(error),
          displayMessage,
          mode,
          occurredAt: new Date().toISOString(),
        });
        setCollabDeployRepairPromptCopied(false);
      }
      setLoadState({
        status: "error",
        message: displayMessage,
      });
    } finally {
      setPendingAction(null);
    }
  }, []);

  const updateHostedCollaborationSettings = useCallback(
    async (hostedCollaborationPatch: NonNullable<ServerSettingsPatch["hostedCollaboration"]>) => {
      const nextSettings = await ensureLocalApi().server.updateSettings({
        hostedCollaboration: hostedCollaborationPatch,
      });
      applySettingsUpdated(nextSettings);
    },
    [],
  );

  const publishProject = useCallback(
    (project: Project) =>
      runAction(`publish:${project.id}`, async () => {
        const nextDetail = await publishLocalProject({
          sourceProjectId: project.id,
          name: project.name,
          cwd: project.cwd,
        });
        commitDetail(nextDetail);
      }),
    [commitDetail, runAction],
  );

  const claimInvite = useCallback(
    () =>
      runAction("claim-invite", async () => {
        const result = await claimSharedProjectInvite({
          code: SharedProjectInviteCode.make(claimCode.trim()),
        });
        setClaimCode("");
        setAcceptedBootstrap(result.bootstrap);
        await load(result.project.id);
      }),
    [claimCode, load, runAction],
  );

  const createInvite = useCallback(
    () =>
      detail
        ? runAction("create-invite", async () => {
            const invite = await createSharedProjectInvite({
              projectId: detail.project.id,
              githubLogin: inviteLogin.trim(),
              role: inviteRole,
            });
            setInviteLogin("");
            setLastInviteCode(invite.code);
            commitDetail(await fetchSharedProjectDetail(detail.project.id));
          })
        : undefined,
    [commitDetail, detail, inviteLogin, inviteRole, runAction],
  );

  const saveCollabServerConfig = useCallback(
    () =>
      runAction("save-collab-server", async () => {
        const token = collabServerForm.token.trim();
        await updateHostedCollaborationSettings({
          url: collabServerForm.url.trim(),
          ...(token.length > 0
            ? { token, tokenRedacted: false }
            : hostedCollaboration.tokenRedacted
              ? { tokenRedacted: true }
              : { token: "", tokenRedacted: false }),
        });
        setCollabServerForm((current) => ({ ...current, token: "" }));
        await load();
      }),
    [
      collabServerForm.token,
      collabServerForm.url,
      hostedCollaboration,
      load,
      runAction,
      updateHostedCollaborationSettings,
    ],
  );

  const clearCollabServerConfig = useCallback(
    () =>
      runAction("clear-collab-server", async () => {
        await updateHostedCollaborationSettings({
          url: "",
          token: "",
          tokenRedacted: false,
          deploymentTargetKey: "",
        });
        setCollabServerForm((current) => ({
          ...current,
          url: "",
          token: "",
          publicBaseUrl: "",
          password: "",
        }));
        await load();
      }),
    [load, runAction, updateHostedCollaborationSettings],
  );

  const deployCollabServer = useCallback(
    (options?: { readonly installDocker?: boolean; readonly confirmRepair?: boolean }) => {
      if (!selectedDeployConnection) return undefined;
      const mode = options?.installDocker ? "install-docker" : "deploy";
      collabDeployPendingModeRef.current = mode;
      setCollabDeployPendingMode(mode);
      return runAction("deploy-collab-server", async () => {
        if (!window.desktopBridge) {
          throw new Error("Desktop SSH deployment is only available in the desktop app.");
        }
        const target = selectedDeployConnection.desktopSsh;
        if (!target) {
          throw new Error("Select a saved SSH connection before deploying.");
        }
        if (options?.installDocker && options.confirmRepair !== false) {
          const accepted = await window.desktopBridge.confirm(
            "Run guided deploy repair on the selected SSH server and then deploy the collaboration server? KamiCode will only run allowlisted prerequisite fixes, and this may use sudo/root privileges on that server.",
          );
          if (!accepted) {
            return;
          }
        }
        const result = await window.desktopBridge.deployCollabServer({
          target,
          options: {
            installDocker: options?.installDocker ?? false,
            password: collabServerForm.password || null,
            publicBaseUrl:
              collabServerForm.publicBaseUrl.trim() ||
              defaultCollabPublicBaseUrl(selectedDeployConnection) ||
              null,
          },
        });
        await updateHostedCollaborationSettings({
          url: result.baseUrl,
          token: result.token,
          tokenRedacted: false,
          deploymentTargetKey: result.targetKey,
        });
        setCollabServerForm((current) => ({
          ...current,
          url: result.baseUrl,
          token: "",
          password: "",
          publicBaseUrl: result.baseUrl,
        }));
        await load();
      });
    },
    [
      collabServerForm.password,
      collabServerForm.publicBaseUrl,
      load,
      runAction,
      selectedDeployConnection,
      updateHostedCollaborationSettings,
    ],
  );

  const copyCollabDeployAiRepairPrompt = useCallback(
    () =>
      runAction("copy-collab-deploy-ai-repair-prompt", async () => {
        if (!collabDeployAiRepairPrompt) {
          throw new Error("No collaboration deploy failure is available to copy.");
        }
        await navigator.clipboard.writeText(collabDeployAiRepairPrompt);
        setCollabDeployRepairPromptCopied(true);
      }),
    [collabDeployAiRepairPrompt, runAction],
  );

  const openCollabDeployAiRepairThread = useCallback(
    () =>
      runAction("open-collab-deploy-ai-repair-thread", async () => {
        if (!lastCollabDeployFailure || !collabDeployAiRepairPrompt) {
          throw new Error("No collaboration deploy failure is available for AI repair.");
        }
        const workspaceProject = collabDeployAiRepairProject;
        const descriptor = workspaceProject
          ? null
          : await resolveInitialPrimaryEnvironmentDescriptor();
        const localApi = readLocalApi();
        const serverConfig =
          workspaceProject || !localApi ? null : await localApi.server.getConfig();
        const environmentId = workspaceProject?.environmentId ?? descriptor?.environmentId ?? null;
        const workspaceRoot = workspaceProject?.cwd ?? serverConfig?.cwd ?? null;
        if (!environmentId || !workspaceRoot) {
          throw new Error(
            "Cannot find a workspace for the AI repair thread. Open any local project once, then click Ask AI to repair again.",
          );
        }
        const api = readEnvironmentApi(environmentId);
        if (!api) {
          throw new Error("The local environment is not connected.");
        }
        const threadId = newThreadId();
        const createdAt = new Date().toISOString();
        const title = "Repair collaboration server deploy";
        const modelSelection = workspaceProject?.defaultModelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        };
        const standaloneProject =
          localProjects.find(
            (project) =>
              project.environmentId === environmentId &&
              project.name === COLLAB_DEPLOY_REPAIR_PROJECT_TITLE &&
              project.cwd === workspaceRoot,
          ) ?? null;
        const repairProjectId = standaloneProject?.id ?? newProjectId();
        if (!standaloneProject) {
          await api.orchestration.dispatchCommand({
            type: "project.create",
            commandId: newCommandId(),
            projectId: repairProjectId,
            title: COLLAB_DEPLOY_REPAIR_PROJECT_TITLE,
            workspaceRoot,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: modelSelection,
            createdAt,
          });
        }
        await api.orchestration.dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId,
          projectId: repairProjectId,
          title,
          modelSelection,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdAt,
        });
        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: collabDeployAiRepairPrompt,
            attachments: [],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          createdAt,
        });
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
        });
      }),
    [
      collabDeployAiRepairProject,
      collabDeployAiRepairPrompt,
      lastCollabDeployFailure,
      localProjects,
      navigate,
      runAction,
    ],
  );

  const stopSharingProject = useCallback(
    () =>
      detail
        ? runAction("stop-sharing", async () => {
            if (stopSharingConfirmationProjectId !== detail.project.id) {
              setStopSharingConfirmationProjectId(detail.project.id);
              return;
            }
            try {
              await deleteSharedProject({ projectId: detail.project.id });
            } catch (error) {
              if (!isSharedProjectNotFoundError(error)) {
                throw error;
              }
            }
            setStopSharingConfirmationProjectId(null);
            setSelectedProjectId(null);
            setDetail(null);
            const listResult = await listSharedProjects();
            setSharedProjects(listResult.projects);
            const nextProjectId = listResult.projects[0]?.id ?? null;
            setSelectedProjectId(nextProjectId);
            setDetail(nextProjectId ? await fetchSharedProjectDetail(nextProjectId) : null);
          })
        : undefined,
    [detail, runAction, stopSharingConfirmationProjectId],
  );

  const syncContext = useCallback(
    () =>
      detail && selectedLocalProject
        ? runAction("sync-context", async () => {
            commitDetail(
              await syncSharedProjectContext({
                projectId: detail.project.id,
                cwd: selectedLocalProject.cwd,
              }),
            );
          })
        : undefined,
    [commitDetail, detail, runAction, selectedLocalProject],
  );

  const shareThread = useCallback(
    (thread: ThreadShell, visibility: SharedThreadVisibility) =>
      detail
        ? runAction(`share-thread:${thread.id}`, async () => {
            const threadDetail = await loadThreadDetailForSharing(
              scopeThreadRef(thread.environmentId, thread.id),
            );
            const sessionSnapshot = toSharedSessionSnapshot(
              threadDetail,
              detail.project.repository,
            );
            const shared = await publishSharedThread({
              projectId: detail.project.id,
              localThreadId: threadDetail.id,
              title: threadDetail.title,
              visibility,
              codeState: {
                branch: threadDetail.branch ?? detail.project.repository.currentBranch,
                headSha: detail.project.repository.headSha,
                dirty: detail.project.repository.dirty,
                patchAttached: false,
              },
              messages: toSharedThreadMessages(threadDetail),
              sessionSnapshot,
            });
            setDetail((current) =>
              current
                ? {
                    ...current,
                    threads: [shared, ...current.threads.filter((entry) => entry.id !== shared.id)],
                  }
                : current,
            );
          })
        : undefined,
    [detail, runAction],
  );

  const importSharedSession = useCallback(
    (thread: SharedThread) =>
      detail && importTargetProject
        ? runAction(`import-thread:${thread.id}`, async () => {
            const result = await importSharedThread({
              projectId: detail.project.id,
              threadId: thread.id,
              targetProjectId: importTargetProject.id,
            });
            await navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(
                scopeThreadRef(importTargetProject.environmentId, result.threadId),
              ),
            });
          })
        : undefined,
    [detail, importTargetProject, navigate, runAction],
  );

  const setThreadVisibility = useCallback(
    (thread: SharedThread, visibility: SharedThreadVisibility) =>
      detail
        ? runAction(`thread-visibility:${thread.id}`, async () => {
            const nextThread = await updateSharedThreadVisibility({
              projectId: detail.project.id,
              threadId: thread.id,
              visibility,
            });
            setDetail((current) =>
              current
                ? {
                    ...current,
                    threads: current.threads.map((entry) =>
                      entry.id === nextThread.id ? nextThread : entry,
                    ),
                  }
                : current,
            );
          })
        : undefined,
    [detail, runAction],
  );

  const resetSshCredentialForm = useCallback(() => {
    setEditingSshCredentialId(null);
    setSshCredentialForm({
      label: "VPS SSH",
      host: "",
      port: "22",
      username: "root",
      authType: "private-key",
      password: "",
      privateKey: "",
      passphrase: "",
    });
  }, []);

  const editSshCredential = useCallback(
    (credential: SharedProjectDetail["sshCredentials"][number]) => {
      setEditingSshCredentialId(credential.id);
      setSshCredentialForm({
        label: credential.label,
        host: credential.host,
        port: String(credential.port),
        username: credential.username,
        authType: credential.authType,
        password: "",
        privateKey: "",
        passphrase: "",
      });
    },
    [],
  );

  const saveSshCredential = useCallback(
    () =>
      detail
        ? runAction("save-ssh-credential", async () => {
            const port = Number.parseInt(sshCredentialForm.port, 10);
            if (!Number.isInteger(port) || port < 1 || port > 65_535) {
              throw new Error("SSH port must be between 1 and 65535.");
            }
            await upsertSharedSshCredential({
              projectId: detail.project.id,
              ...(editingSshCredentialId
                ? { credentialId: SharedSshCredentialId.make(editingSshCredentialId) }
                : {}),
              label: sshCredentialForm.label.trim(),
              host: sshCredentialForm.host.trim(),
              port,
              username: sshCredentialForm.username.trim(),
              authType: sshCredentialForm.authType,
              ...(sshCredentialForm.authType === "password" &&
              (!editingSshCredentialId || sshCredentialForm.password.trim().length > 0)
                ? { password: sshCredentialForm.password }
                : {}),
              ...(sshCredentialForm.authType === "private-key" &&
              (!editingSshCredentialId || sshCredentialForm.privateKey.trim().length > 0)
                ? { privateKey: sshCredentialForm.privateKey }
                : {}),
              ...(sshCredentialForm.authType === "private-key" &&
              sshCredentialForm.passphrase.trim().length > 0
                ? { passphrase: sshCredentialForm.passphrase }
                : {}),
            });
            resetSshCredentialForm();
            commitDetail(await fetchSharedProjectDetail(detail.project.id));
          })
        : undefined,
    [
      commitDetail,
      detail,
      editingSshCredentialId,
      resetSshCredentialForm,
      runAction,
      sshCredentialForm,
    ],
  );

  const addRuntime = useCallback(
    () =>
      detail
        ? runAction("add-runtime", async () => {
            await upsertSharedRuntime({
              projectId: detail.project.id,
              type: newRuntime.type,
              label: newRuntime.label,
              endpointLabel: newRuntime.endpoint.trim() || null,
              health: newRuntime.health,
              capabilities: ["execute", "test"],
              providerLabel: "User-local provider profile",
              sshCredentialId:
                newRuntime.type === "ssh-vps" && newRuntime.sshCredentialId
                  ? SharedSshCredentialId.make(newRuntime.sshCredentialId)
                  : null,
              unavailableReason:
                newRuntime.health === "unavailable" ? "Provider or runtime unavailable" : null,
            });
            setNewRuntime({
              type: "ssh-vps",
              label: "VPS runtime",
              endpoint: "",
              health: "healthy",
              sshCredentialId: "",
            });
            commitDetail(await fetchSharedProjectDetail(detail.project.id));
          })
        : undefined,
    [commitDetail, detail, newRuntime, runAction],
  );

  const addEnvironment = useCallback(
    () =>
      detail
        ? runAction("add-environment", async () => {
            await upsertSharedEnvironment({
              projectId: detail.project.id,
              name: newEnvironment.name,
              type: newEnvironment.type,
              baseUrl: newEnvironment.baseUrl,
              isDefault: newEnvironment.isDefault,
            });
            setNewEnvironment({
              name: "VPS Staging",
              type: "vps-staging",
              baseUrl: "",
              isDefault: false,
            });
            commitDetail(await fetchSharedProjectDetail(detail.project.id));
          })
        : undefined,
    [commitDetail, detail, newEnvironment, runAction],
  );

  const addDeploy = useCallback(
    () =>
      detail
        ? runAction("add-deploy", async () => {
            const environmentId = deployForm.environmentId || defaultEnvironment?.id;
            if (!environmentId) return;
            commitDetail(
              await upsertSharedDeployAssociation({
                projectId: detail.project.id,
                branch:
                  deployForm.branch.trim() || detail.project.repository.currentBranch || "main",
                environmentId: SharedProjectEnvironmentId.make(environmentId),
                deployUrl: deployForm.deployUrl,
                deployedSha: deployForm.deployedSha.trim() || null,
              }),
            );
            setDeployForm({ branch: "", environmentId: "", deployUrl: "", deployedSha: "" });
          })
        : undefined,
    [commitDetail, defaultEnvironment?.id, deployForm, detail, runAction],
  );

  const canManage = detailCanManage(detail);
  const canEdit = detailCanEdit(detail);
  const canStopSharing = detail?.project.role === "owner";
  const isPending = pendingAction !== null;

  return (
    <SettingsPageContainer className="max-w-5xl">
      <SettingsSection
        title="Shared Projects"
        icon={<Share2Icon className="size-3.5 text-muted-foreground/70" />}
        headerAction={
          <Button size="xs" variant="outline" disabled={isPending} onClick={() => void load()}>
            <RefreshCwIcon className={isPending ? "size-3.5 animate-spin" : "size-3.5"} />
            Refresh
          </Button>
        }
      >
        <SettingsRow
          title="GitHub identity"
          description={
            currentUser
              ? `Invites and project access use @${currentUser.githubLogin}.`
              : "GitHub identity is required for shared project access."
          }
          status={
            loadState.status === "error" ? (
              <span className="text-destructive">{loadState.message}</span>
            ) : null
          }
          control={
            currentUser ? (
              <Badge variant="success">@{currentUser.githubLogin}</Badge>
            ) : (
              <Badge variant="warning">Unavailable</Badge>
            )
          }
        />
        <SettingsRow
          title="Accept invite"
          description="Claim a one-time project code for the signed-in GitHub account."
          control={
            <div className="flex w-full gap-2 sm:w-auto">
              <Input
                className="h-7 min-w-0 text-xs sm:w-48"
                value={claimCode}
                placeholder="Invite code"
                onChange={(event) => setClaimCode(event.currentTarget.value)}
              />
              <Button
                size="xs"
                disabled={isPending || claimCode.trim().length === 0}
                onClick={() => void claimInvite()}
              >
                <KeyRoundIcon className="size-3.5" />
                Claim
              </Button>
            </div>
          }
        >
          {acceptedBootstrap ? (
            <div className="mt-3 grid gap-2 border-t border-border/50 py-3 text-xs text-muted-foreground sm:grid-cols-3">
              <div>
                <span className="font-medium text-foreground">Open clone</span>
                <p className="mt-1">
                  Use an existing checkout for {acceptedBootstrap.project.name}.
                </p>
              </div>
              <div>
                <span className="font-medium text-foreground">Clone from GitHub</span>
                <p className="mt-1">
                  {acceptedBootstrap.project.repository.remoteUrl ?? "Repo URL unavailable"}
                </p>
              </div>
              <div>
                <span className="font-medium text-foreground">Attach runtime</span>
                <p className="mt-1">
                  {acceptedBootstrap.runtimes.length} runtime record(s) available.
                </p>
              </div>
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Collaboration server" icon={<ServerIcon className="size-3.5" />}>
        <SettingsRow
          title="Hosted control plane"
          description={
            hasHostedCollabConfig
              ? hostedCollaboration.url
              : "No hosted collaboration server is configured."
          }
          status={
            hasHostedCollabConfig ? (
              <Badge variant="success">Configured</Badge>
            ) : (
              <Badge variant="warning">Local only</Badge>
            )
          }
          control={
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={isPending || !hostedCollaboration.url}
              onClick={() => void clearCollabServerConfig()}
            >
              Clear
            </Button>
          }
        />
        <SettingsRow
          title="Use existing URL"
          description={
            hostedCollaboration.tokenRedacted
              ? "Save a hosted collaboration server URL. Leave the token empty to keep the stored token, or paste a new token to replace it."
              : "Save a hosted collaboration server URL and bearer token."
          }
          control={
            <Button
              size="xs"
              disabled={
                isPending ||
                collabServerForm.url.trim().length === 0 ||
                (!hostedCollaboration.tokenRedacted && collabServerForm.token.trim().length === 0)
              }
              onClick={() => void saveCollabServerConfig()}
            >
              <LinkIcon className="size-3.5" />
              Save
            </Button>
          }
        >
          <div className="mt-3 grid gap-2 border-t border-border/50 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
            <Input
              className="h-7 min-w-0 text-xs"
              value={collabServerForm.url}
              placeholder="https://collab.example.com"
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCollabServerForm((current) => ({
                  ...current,
                  url: value,
                }));
              }}
            />
            <Input
              className="h-7 min-w-0 text-xs"
              type="password"
              value={collabServerForm.token}
              placeholder={
                hostedCollaboration.tokenRedacted
                  ? "Stored token - paste to replace"
                  : "Bearer token"
              }
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCollabServerForm((current) => ({
                  ...current,
                  token: value,
                }));
              }}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title="Deploy over SSH"
          description="Clone camie-ace/KamiCode on the selected Linux SSH connection and start the collaboration server with Docker."
          status={
            hasDesktopBridge
              ? `${savedSshConnections.length} SSH connection(s) available.`
              : "Desktop app required."
          }
          control={
            <Button
              size="xs"
              variant="outline"
              disabled={isPending || !hasDesktopBridge || !selectedDeployConnection?.desktopSsh}
              onClick={() => void deployCollabServer()}
            >
              {isDeployingCollabServer && collabDeployPendingMode === "deploy" ? (
                <RefreshCwIcon className="size-3.5 animate-spin" />
              ) : (
                <ServerIcon className="size-3.5" />
              )}
              {isDeployingCollabServer && collabDeployPendingMode === "deploy"
                ? "Deploying..."
                : "Deploy"}
            </Button>
          }
        >
          <div className="mt-3 grid gap-2 border-t border-border/50 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,12rem)]">
            <select
              className={SELECT_CLASS}
              value={selectedDeployConnection?.environmentId ?? ""}
              disabled={isDeployingCollabServer || savedSshConnections.length === 0}
              onChange={(event) => {
                const value = event.currentTarget.value;
                const nextConnection =
                  savedSshConnections.find((record) => record.environmentId === value) ?? null;
                setCollabServerForm((current) => ({
                  ...current,
                  selectedEnvironmentId: value,
                  publicBaseUrl: defaultCollabPublicBaseUrl(nextConnection),
                }));
              }}
            >
              {savedSshConnections.length === 0 ? (
                <option value="">No saved SSH connections</option>
              ) : null}
              {savedSshConnections.map((record) => (
                <option key={record.environmentId} value={record.environmentId}>
                  {formatSavedSshConnection(record)}
                </option>
              ))}
            </select>
            <Input
              className="h-7 min-w-0 text-xs"
              value={collabServerForm.publicBaseUrl}
              placeholder="http://vps.example.com:8787"
              disabled={isDeployingCollabServer}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCollabServerForm((current) => ({
                  ...current,
                  publicBaseUrl: value,
                }));
              }}
            />
            <Input
              className="h-7 min-w-0 text-xs"
              type="password"
              value={collabServerForm.password}
              placeholder="SSH password"
              disabled={isDeployingCollabServer}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setCollabServerForm((current) => ({
                  ...current,
                  password: value,
                }));
              }}
            />
          </div>
          {isDeployingCollabServer ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-primary">
              <RefreshCwIcon className="size-3.5 shrink-0 animate-spin" />
              <span>{collabDeployPendingMessage}</span>
            </div>
          ) : null}
          {collabDeployRecoveryAction === "install-docker" ? (
            <div className="mb-3 flex flex-col gap-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning sm:flex-row sm:items-center">
              <span className="flex-1">
                Docker is missing on this SSH server. KamiCode can run a bounded repair for known
                prerequisites, then retry the deployment.
              </span>
              <Button
                size="xs"
                variant="outline"
                disabled={isPending || !hasDesktopBridge || !selectedDeployConnection?.desktopSsh}
                onClick={() => void deployCollabServer({ installDocker: true })}
              >
                {isDeployingCollabServer && collabDeployPendingMode === "install-docker" ? (
                  <RefreshCwIcon className="size-3.5 animate-spin" />
                ) : (
                  <ServerIcon className="size-3.5" />
                )}
                {isDeployingCollabServer && collabDeployPendingMode === "install-docker"
                  ? "Repairing..."
                  : "Repair & deploy"}
              </Button>
            </div>
          ) : null}
          {lastCollabDeployFailure && !isDeployingCollabServer ? (
            <div className="mb-3 flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3 text-xs">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-foreground">Deploy repair</span>
                <span className="text-muted-foreground">
                  First run the bounded repair and retry deployment from this screen so the one-time
                  SSH password stays in memory. Open an AI repair thread only if the retry still
                  cannot finish.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  disabled={isPending || !hasDesktopBridge || !selectedDeployConnection?.desktopSsh}
                  onClick={() =>
                    void deployCollabServer({ installDocker: true, confirmRepair: false })
                  }
                >
                  <ServerIcon className="size-3.5" />
                  Auto repair & retry
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={isPending || collabDeployAiRepairPrompt.length === 0}
                  onClick={() => void copyCollabDeployAiRepairPrompt()}
                >
                  <LinkIcon className="size-3.5" />
                  {collabDeployRepairPromptCopied ? "Copied" : "Copy prompt"}
                </Button>
                <Button
                  size="xs"
                  disabled={isPending || collabDeployAiRepairPrompt.length === 0}
                  onClick={() => void openCollabDeployAiRepairThread()}
                >
                  {isOpeningCollabDeployAiRepairThread ? (
                    <RefreshCwIcon className="size-3.5 animate-spin" />
                  ) : (
                    <MessagesSquareIcon className="size-3.5" />
                  )}
                  {isOpeningCollabDeployAiRepairThread ? "Opening..." : "Open AI repair thread"}
                </Button>
              </div>
            </div>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Project sharing enablement" icon={<Code2Icon className="size-3.5" />}>
        {localProjects.map((project) => {
          const shared = sharedProjectBySourceProjectId.get(project.id) ?? null;
          return (
            <SettingsRow
              key={`${project.environmentId}:${project.id}`}
              title={project.name}
              description={project.cwd}
              status={
                shared ? (
                  <span className="text-success-foreground">
                    Sessions can be shared under {shared.name}
                  </span>
                ) : (
                  "Not enabled for session sharing"
                )
              }
              control={
                shared ? (
                  <Button size="xs" variant="outline" onClick={() => void load(shared.id)}>
                    Open
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    disabled={isPending}
                    onClick={() => void publishProject(project)}
                  >
                    <Share2Icon className="size-3.5" />
                    Enable
                  </Button>
                )
              }
            />
          );
        })}
        {localProjects.length === 0 ? <EmptyRow>No local projects are loaded.</EmptyRow> : null}
      </SettingsSection>

      <SettingsSection
        title="Shared project control plane"
        icon={<ShieldCheckIcon className="size-3.5" />}
      >
        {sharedProjects.length > 0 ? (
          <SettingsRow
            title="Active project"
            description={detail ? projectRepoLabel(detail.project) : "Select a shared project."}
            control={
              <select
                className={SELECT_CLASS}
                value={selectedProjectId ?? ""}
                onChange={(event) => void load(event.currentTarget.value as SharedProjectId)}
              >
                {sharedProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            }
          >
            {detail ? (
              <div className="mt-3 border-t border-border/50 py-3">
                <ProjectStatusBadge detail={detail} />
                {canStopSharing ? (
                  <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="min-w-0 text-xs text-muted-foreground">
                      Stop sharing removes the shared project for all members. Local projects and
                      sessions stay on this machine.
                    </p>
                    <Button
                      size="xs"
                      variant="destructive-outline"
                      disabled={isPending}
                      onClick={() => void stopSharingProject()}
                    >
                      <Trash2Icon className="size-3.5" />
                      {stopSharingConfirmationProjectId === detail.project.id
                        ? "Confirm stop"
                        : "Stop sharing"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </SettingsRow>
        ) : (
          <EmptyRow>No shared projects yet.</EmptyRow>
        )}
      </SettingsSection>

      {detail ? (
        <>
          <SettingsSection title="Context bundle" icon={<GitBranchIcon className="size-3.5" />}>
            <SettingsRow
              title="Project context"
              description={`Last synced: ${formatTimestamp(detail.project.contextSyncedAt)}`}
              status={
                detail.contextBundle
                  ? `Includes ${detail.contextBundle.includedCategories.join(", ")}. Excludes ${detail.contextBundle.excludedCategories.join(", ")}.`
                  : "No bundle has been synced yet."
              }
              control={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canManage || !selectedLocalProject || isPending}
                  onClick={() => void syncContext()}
                >
                  <RefreshCwIcon className="size-3.5" />
                  Sync
                </Button>
              }
            >
              {detail.contextBundle ? (
                <div className="mt-3 grid gap-2 border-t border-border/50 py-3 text-xs text-muted-foreground sm:grid-cols-3">
                  <div>{detail.contextBundle.instructions.length} instruction file(s)</div>
                  <div>{detail.contextBundle.scripts.length} script(s)</div>
                  <div>{detail.contextBundle.environmentVariables.length} env var name(s)</div>
                </div>
              ) : null}
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            title="Members and invites"
            icon={<UsersRoundIcon className="size-3.5" />}
          >
            {detail.members.map((member) => (
              <SettingsRow
                key={member.userId}
                title={`@${member.githubLogin}`}
                description={member.displayName ?? "GitHub member"}
                status={`Joined ${formatTimestamp(member.joinedAt)}`}
                control={
                  <div className="flex items-center gap-2">
                    <Badge variant={roleBadgeVariant(member.role)}>{member.role}</Badge>
                    {member.role !== "owner" && canManage ? (
                      <>
                        <select
                          className={SELECT_CLASS}
                          value={member.role}
                          onChange={(event) =>
                            void runAction(`role:${member.userId}`, async () => {
                              commitDetail(
                                await updateSharedProjectMemberRole({
                                  projectId: detail.project.id,
                                  userId: member.userId,
                                  role: event.currentTarget.value as SharedProjectRole,
                                }),
                              );
                            })
                          }
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="xs"
                          variant="destructive-outline"
                          disabled={isPending}
                          onClick={() =>
                            void runAction(`remove:${member.userId}`, async () => {
                              commitDetail(
                                await removeSharedProjectMember({
                                  projectId: detail.project.id,
                                  userId: member.userId,
                                }),
                              );
                            })
                          }
                        >
                          Remove
                        </Button>
                      </>
                    ) : null}
                  </div>
                }
              />
            ))}
            {canManage ? (
              <SettingsRow
                title="Create invite"
                description="Codes are one-time, expiring, and bound to a GitHub handle."
                status={lastInviteCode ? `Latest code: ${lastInviteCode}` : null}
                control={
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <Input
                      className="h-7 text-xs sm:w-44"
                      value={inviteLogin}
                      placeholder="@octo-user"
                      onChange={(event) => setInviteLogin(event.currentTarget.value)}
                    />
                    <select
                      className={SELECT_CLASS}
                      value={inviteRole}
                      onChange={(event) =>
                        setInviteRole(event.currentTarget.value as SharedProjectRole)
                      }
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="xs"
                      disabled={isPending || inviteLogin.trim().length === 0}
                      onClick={() => void createInvite()}
                    >
                      <KeyRoundIcon className="size-3.5" />
                      Generate
                    </Button>
                  </div>
                }
              />
            ) : null}
            {detail.invites.map((invite) => (
              <SettingsRow
                key={invite.code}
                title={`Invite for @${invite.githubLogin}`}
                description={`Role: ${invite.role}`}
                status={`Status: ${invite.status}. Expires ${formatTimestamp(invite.expiresAt)}.`}
                control={
                  <Badge variant={invite.status === "pending" ? "warning" : "outline"}>
                    {invite.status}
                  </Badge>
                }
              />
            ))}
          </SettingsSection>

          <SettingsSection
            title="Shared sessions"
            icon={<MessagesSquareIcon className="size-3.5" />}
          >
            {detail.threads.length > 0 ? (
              <div className="border-b border-border/60 px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">Import target</p>
                    <p className="text-xs text-muted-foreground">
                      Imported sessions become new local sessions in this project.
                    </p>
                  </div>
                  <select
                    className={`${SELECT_CLASS} min-w-56`}
                    value={importTargetProject?.id ?? ""}
                    disabled={localProjects.length === 0}
                    onChange={(event) =>
                      setImportTargetProjectId(event.currentTarget.value as ProjectId)
                    }
                  >
                    {localProjects.length === 0 ? (
                      <option value="">Open a local project first</option>
                    ) : null}
                    {localProjects.map((project) => (
                      <option key={`${project.environmentId}:${project.id}`} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
            {activeLocalThreads.map((thread) => {
              const sharedSnapshots = sharedThreadsByLocalId.get(thread.id) ?? [];
              const latestSnapshot = sharedSnapshots.toSorted((left, right) =>
                right.createdAt.localeCompare(left.createdAt),
              )[0];
              return (
                <SettingsRow
                  key={thread.id}
                  title={thread.title}
                  description={
                    sharedSnapshots.length > 0
                      ? `${sharedSnapshots.length} snapshot share(s) created from this local session.`
                      : "Private local session. Sharing creates a new one-time snapshot."
                  }
                  status={
                    detail.project.repository.dirty ? (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <TriangleAlertIcon className="size-3" />
                        Dirty local code is not bundled. Push code to Git before sharing if the
                        receiver needs it.
                      </span>
                    ) : null
                  }
                  control={
                    <Button
                      size="xs"
                      disabled={!canEdit || isPending}
                      onClick={() => void shareThread(thread, "shared")}
                    >
                      Create snapshot share
                    </Button>
                  }
                >
                  {latestSnapshot ? (
                    <div className="mt-3 space-y-3 border-t border-border/50 py-3">
                      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                        <span>Latest branch {latestSnapshot.codeState.branch ?? "unknown"}</span>
                        <span>SHA {shortSha(latestSnapshot.codeState.headSha)}</span>
                        <span>{latestSnapshot.codeState.dirty ? "Dirty work" : "Clean"}</span>
                        <span>
                          {latestSnapshot.codeState.patchAttached ? "Patch attached" : "No patch"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {latestSnapshot.sessionSnapshot
                          ? `Latest snapshot captured ${formatTimestamp(latestSnapshot.sessionSnapshot.capturedAt)} with ${latestSnapshot.sessionSnapshot.messages.length} message(s), ${latestSnapshot.sessionSnapshot.activities.length} activity item(s), and ${latestSnapshot.sessionSnapshot.checkpoints.length} checkpoint(s). Continuing this local session will not update that share; click Create snapshot share again to publish a new handoff.`
                          : "Latest share has no rich session snapshot."}
                      </div>
                      {latestSnapshot.messages.length > 0 ? (
                        <div className="space-y-1 text-xs">
                          {latestSnapshot.messages.slice(-4).map((message) => (
                            <div key={message.id} className="rounded-md bg-muted/40 px-2 py-1.5">
                              <span className="font-medium text-foreground">{message.role}</span>{" "}
                              <span className="text-muted-foreground">{message.text}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </SettingsRow>
              );
            })}
            {activeLocalThreads.length === 0 ? (
              <EmptyRow>
                No matching local sessions are available. Import a shared snapshot into a local
                project, then continue it locally and create a new snapshot share when ready.
              </EmptyRow>
            ) : null}
            {detail.threads.length > 0 ? (
              <div className="border-t border-border/60 px-4 py-4 sm:px-5">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Available snapshot shares
                </p>
                <div className="mt-3 space-y-2">
                  {detail.threads.map((shared) => {
                    const isImporting = pendingAction === `import-thread:${shared.id}`;
                    return (
                      <div
                        key={shared.id}
                        className="rounded-lg border border-border/70 bg-background/60 p-3"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-medium text-foreground">
                                {shared.title}
                              </p>
                              <Badge variant="outline" size="sm">
                                {shared.visibility}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {shared.sessionSnapshot
                                ? `${shared.sessionSnapshot.messages.length} message(s), ${shared.sessionSnapshot.activities.length} activity item(s), ${shared.sessionSnapshot.checkpoints.length} checkpoint(s). Importing makes a local copy; it does not update this share.`
                                : "No importable snapshot captured yet."}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <select
                              className={SELECT_CLASS}
                              value={shared.visibility}
                              disabled={!canEdit || isPending}
                              onChange={(event) =>
                                void setThreadVisibility(
                                  shared,
                                  event.currentTarget.value as SharedThreadVisibility,
                                )
                              }
                            >
                              <option value="private">private</option>
                              <option value="shared">shared</option>
                            </select>
                            <Button
                              size="xs"
                              disabled={
                                isPending ||
                                isImporting ||
                                !shared.sessionSnapshot ||
                                importTargetProject === null
                              }
                              onClick={() => void importSharedSession(shared)}
                            >
                              {isImporting ? "Importing..." : "Import copy"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </SettingsSection>

          <SettingsSection title="SSH" icon={<KeyRoundIcon className="size-3.5" />}>
            {detail.sshCredentials.map((credential) => (
              <SettingsRow
                key={credential.id}
                title={credential.label}
                description={formatSshCredential(credential)}
                status={`Auth: ${credential.authType}. Secret updated ${formatTimestamp(credential.secretUpdatedAt)}.`}
                control={
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {credential.secretState.hasPrivateKey
                        ? "private key"
                        : credential.secretState.hasPassword
                          ? "password"
                          : "agent"}
                    </Badge>
                    {canManage ? (
                      <>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => editSshCredential(credential)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="xs"
                          variant="destructive-outline"
                          disabled={isPending}
                          onClick={() =>
                            void runAction(`remove-ssh:${credential.id}`, async () => {
                              commitDetail(
                                await removeSharedSshCredential({
                                  projectId: detail.project.id,
                                  credentialId: credential.id,
                                }),
                              );
                            })
                          }
                        >
                          Remove
                        </Button>
                      </>
                    ) : null}
                  </div>
                }
              >
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 py-3">
                  <Badge variant={credential.secretState.hasPassword ? "secondary" : "outline"}>
                    {credential.secretState.hasPassword ? "password saved" : "no password"}
                  </Badge>
                  <Badge variant={credential.secretState.hasPrivateKey ? "secondary" : "outline"}>
                    {credential.secretState.hasPrivateKey ? "key saved" : "no key"}
                  </Badge>
                  <Badge variant={credential.secretState.hasPassphrase ? "secondary" : "outline"}>
                    {credential.secretState.hasPassphrase ? "passphrase saved" : "no passphrase"}
                  </Badge>
                </div>
              </SettingsRow>
            ))}
            {detail.sshCredentials.length === 0 ? (
              <EmptyRow>No shared SSH credentials have been saved.</EmptyRow>
            ) : null}
            {canManage ? (
              <SettingsRow
                title={editingSshCredentialId ? "Edit SSH credential" : "Add SSH credential"}
                description="Secrets are encrypted by the main backend before SQLite persistence."
                status={
                  editingSshCredentialId
                    ? "Leave secret fields blank to keep the existing encrypted secret."
                    : "Use this when a task should deploy or run against a specific SSH instance."
                }
                control={
                  <div className="flex gap-2">
                    {editingSshCredentialId ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isPending}
                        onClick={resetSshCredentialForm}
                      >
                        Cancel
                      </Button>
                    ) : null}
                    <Button
                      size="xs"
                      disabled={
                        isPending ||
                        sshCredentialForm.label.trim().length === 0 ||
                        sshCredentialForm.host.trim().length === 0 ||
                        sshCredentialForm.username.trim().length === 0 ||
                        (!editingSshCredentialId &&
                          sshCredentialForm.authType === "password" &&
                          sshCredentialForm.password.trim().length === 0) ||
                        (!editingSshCredentialId &&
                          sshCredentialForm.authType === "private-key" &&
                          sshCredentialForm.privateKey.trim().length === 0)
                      }
                      onClick={() => void saveSshCredential()}
                    >
                      Save SSH
                    </Button>
                  </div>
                }
              >
                <div className="mt-3 grid gap-2 border-t border-border/50 py-3 sm:grid-cols-[10rem_1fr_5rem_9rem_9rem]">
                  <Input
                    className="h-7 text-xs"
                    value={sshCredentialForm.label}
                    placeholder="VPS SSH"
                    onChange={(event) =>
                      setSshCredentialForm((current) => ({
                        ...current,
                        label: event.currentTarget.value,
                      }))
                    }
                  />
                  <Input
                    className="h-7 text-xs"
                    value={sshCredentialForm.host}
                    placeholder="203.0.113.10"
                    onChange={(event) =>
                      setSshCredentialForm((current) => ({
                        ...current,
                        host: event.currentTarget.value,
                      }))
                    }
                  />
                  <Input
                    className="h-7 text-xs"
                    value={sshCredentialForm.port}
                    placeholder="22"
                    inputMode="numeric"
                    onChange={(event) =>
                      setSshCredentialForm((current) => ({
                        ...current,
                        port: event.currentTarget.value,
                      }))
                    }
                  />
                  <Input
                    className="h-7 text-xs"
                    value={sshCredentialForm.username}
                    placeholder="root"
                    onChange={(event) =>
                      setSshCredentialForm((current) => ({
                        ...current,
                        username: event.currentTarget.value,
                      }))
                    }
                  />
                  <select
                    className={SELECT_CLASS}
                    value={sshCredentialForm.authType}
                    onChange={(event) =>
                      setSshCredentialForm((current) => ({
                        ...current,
                        authType: event.currentTarget.value as SharedSshAuthType,
                      }))
                    }
                  >
                    {sshAuthTypes.map((authType) => (
                      <option key={authType} value={authType}>
                        {authType}
                      </option>
                    ))}
                  </select>
                </div>
                {sshCredentialForm.authType === "password" ? (
                  <div className="pb-3">
                    <Input
                      className="h-7 text-xs"
                      type="password"
                      value={sshCredentialForm.password}
                      placeholder={
                        editingSshCredentialId ? "Leave blank to keep saved password" : "Password"
                      }
                      onChange={(event) =>
                        setSshCredentialForm((current) => ({
                          ...current,
                          password: event.currentTarget.value,
                        }))
                      }
                    />
                  </div>
                ) : null}
                {sshCredentialForm.authType === "private-key" ? (
                  <div className="grid gap-2 pb-3 sm:grid-cols-[1fr_14rem]">
                    <Textarea
                      className="text-xs"
                      value={sshCredentialForm.privateKey}
                      placeholder={
                        editingSshCredentialId
                          ? "Leave blank to keep saved private key"
                          : "Paste private key"
                      }
                      onChange={(event) =>
                        setSshCredentialForm((current) => ({
                          ...current,
                          privateKey: event.currentTarget.value,
                        }))
                      }
                    />
                    <Input
                      className="h-7 text-xs"
                      type="password"
                      value={sshCredentialForm.passphrase}
                      placeholder="Passphrase optional"
                      onChange={(event) =>
                        setSshCredentialForm((current) => ({
                          ...current,
                          passphrase: event.currentTarget.value,
                        }))
                      }
                    />
                  </div>
                ) : null}
              </SettingsRow>
            ) : null}
          </SettingsSection>

          <SettingsSection title="Runtimes" icon={<ServerIcon className="size-3.5" />}>
            {detail.runtimes.map((runtime) => (
              <SettingsRow
                key={runtime.id}
                title={runtime.label}
                description={runtime.endpointLabel ?? "No endpoint"}
                status={`Provider: ${runtime.providerLabel ?? "runtime-local"}. SSH: ${formatSshCredential(runtime.sshCredentialId ? (sshCredentialById.get(runtime.sshCredentialId) ?? null) : null)}. Capabilities: ${runtime.capabilities.join(", ")}.`}
                control={
                  <Badge
                    variant={
                      runtime.health === "healthy"
                        ? "success"
                        : runtime.health === "unavailable"
                          ? "warning"
                          : "outline"
                    }
                  >
                    {runtime.health}
                  </Badge>
                }
              />
            ))}
            {canEdit ? (
              <SettingsRow
                title="Attach runtime"
                description="Execution location is selectable per continuation."
                control={
                  <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[7rem_9rem_13rem_10rem_7rem_auto]">
                    <select
                      className={SELECT_CLASS}
                      value={newRuntime.type}
                      onChange={(event) =>
                        setNewRuntime((current) => ({
                          ...current,
                          type: event.currentTarget.value as SharedRuntimeType,
                          sshCredentialId:
                            event.currentTarget.value === "ssh-vps" ? current.sshCredentialId : "",
                        }))
                      }
                    >
                      {runtimeTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="h-7 text-xs"
                      value={newRuntime.label}
                      onChange={(event) =>
                        setNewRuntime((current) => ({
                          ...current,
                          label: event.currentTarget.value,
                        }))
                      }
                    />
                    <Input
                      className="h-7 text-xs"
                      value={newRuntime.endpoint}
                      placeholder="https://staging.example.com"
                      onChange={(event) =>
                        setNewRuntime((current) => ({
                          ...current,
                          endpoint: event.currentTarget.value,
                        }))
                      }
                    />
                    <select
                      className={SELECT_CLASS}
                      value={newRuntime.sshCredentialId}
                      disabled={newRuntime.type !== "ssh-vps" || detail.sshCredentials.length === 0}
                      onChange={(event) =>
                        setNewRuntime((current) => ({
                          ...current,
                          sshCredentialId: event.currentTarget.value,
                        }))
                      }
                    >
                      <option value="">No SSH</option>
                      {detail.sshCredentials.map((credential) => (
                        <option key={credential.id} value={credential.id}>
                          {credential.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className={SELECT_CLASS}
                      value={newRuntime.health}
                      onChange={(event) =>
                        setNewRuntime((current) => ({
                          ...current,
                          health: event.currentTarget.value as SharedRuntimeHealth,
                        }))
                      }
                    >
                      {runtimeHealthOptions.map((health) => (
                        <option key={health} value={health}>
                          {health}
                        </option>
                      ))}
                    </select>
                    <Button size="xs" disabled={isPending} onClick={() => void addRuntime()}>
                      Add
                    </Button>
                  </div>
                }
              />
            ) : null}
          </SettingsSection>

          <SettingsSection title="Environments" icon={<LinkIcon className="size-3.5" />}>
            {detail.environments.map((environment) => (
              <EnvironmentRow
                key={environment.id}
                environment={environment}
                canManage={canManage}
                isPending={isPending}
                onSetDefault={() =>
                  void runAction(`default-env:${environment.id}`, async () => {
                    commitDetail(
                      await setSharedDefaultEnvironment({
                        projectId: detail.project.id,
                        environmentId: environment.id,
                      }),
                    );
                  })
                }
              />
            ))}
            {detail.environments.length === 0 ? (
              <EmptyRow>No environments defined.</EmptyRow>
            ) : null}
            {canManage ? (
              <SettingsRow
                title="Add environment"
                description="Exactly one environment becomes the default target."
                control={
                  <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[9rem_8rem_14rem_auto]">
                    <Input
                      className="h-7 text-xs"
                      value={newEnvironment.name}
                      onChange={(event) =>
                        setNewEnvironment((current) => ({
                          ...current,
                          name: event.currentTarget.value,
                        }))
                      }
                    />
                    <select
                      className={SELECT_CLASS}
                      value={newEnvironment.type}
                      onChange={(event) =>
                        setNewEnvironment((current) => ({
                          ...current,
                          type: event.currentTarget.value as SharedEnvironmentType,
                        }))
                      }
                    >
                      {environmentTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="h-7 text-xs"
                      value={newEnvironment.baseUrl}
                      placeholder="https://preview.example.com"
                      onChange={(event) =>
                        setNewEnvironment((current) => ({
                          ...current,
                          baseUrl: event.currentTarget.value,
                        }))
                      }
                    />
                    <Button
                      size="xs"
                      disabled={isPending || newEnvironment.baseUrl.trim().length === 0}
                      onClick={() => void addEnvironment()}
                    >
                      Add
                    </Button>
                  </div>
                }
              />
            ) : null}
          </SettingsSection>

          <SettingsSection title="Deploy associations" icon={<CloudIcon className="size-3.5" />}>
            {detail.deploys.map((deploy) => (
              <DeployRow key={deploy.id} deploy={deploy} environments={detail.environments} />
            ))}
            {detail.deploys.length === 0 ? (
              <EmptyRow>No deploy associations defined.</EmptyRow>
            ) : null}
            {canManage ? (
              <>
                <SettingsRow
                  title="Map branch to URL"
                  description="Staleness is computed against the shared project HEAD SHA."
                  control={
                    <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[9rem_9rem_13rem_9rem_auto]">
                      <Input
                        className="h-7 text-xs"
                        value={deployForm.branch}
                        placeholder={detail.project.repository.currentBranch ?? "branch"}
                        onChange={(event) =>
                          setDeployForm((current) => ({
                            ...current,
                            branch: event.currentTarget.value,
                          }))
                        }
                      />
                      <select
                        className={SELECT_CLASS}
                        value={deployForm.environmentId || defaultEnvironment?.id || ""}
                        onChange={(event) =>
                          setDeployForm((current) => ({
                            ...current,
                            environmentId: event.currentTarget.value,
                          }))
                        }
                      >
                        {detail.environments.map((environment) => (
                          <option key={environment.id} value={environment.id}>
                            {environment.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        className="h-7 text-xs"
                        value={deployForm.deployUrl}
                        placeholder="https://branch.example.com"
                        onChange={(event) =>
                          setDeployForm((current) => ({
                            ...current,
                            deployUrl: event.currentTarget.value,
                          }))
                        }
                      />
                      <Input
                        className="h-7 text-xs"
                        value={deployForm.deployedSha}
                        placeholder={shortSha(detail.project.repository.headSha)}
                        onChange={(event) =>
                          setDeployForm((current) => ({
                            ...current,
                            deployedSha: event.currentTarget.value,
                          }))
                        }
                      />
                      <Button
                        size="xs"
                        disabled={
                          isPending ||
                          detail.environments.length === 0 ||
                          deployForm.deployUrl.trim().length === 0
                        }
                        onClick={() => void addDeploy()}
                      >
                        Add
                      </Button>
                    </div>
                  }
                />
                <SettingsRow
                  title="Sync from remote runtime"
                  description="Healthy remote runtimes with valid endpoints become project environments."
                  control={
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        void runAction("sync-remote-runtime", async () => {
                          commitDetail(
                            await syncSharedRemoteRuntime({ projectId: detail.project.id }),
                          );
                        })
                      }
                    >
                      <RefreshCwIcon className="size-3.5" />
                      Sync
                    </Button>
                  }
                />
              </>
            ) : null}
          </SettingsSection>
        </>
      ) : null}
    </SettingsPageContainer>
  );
}

function EnvironmentRow({
  environment,
  canManage,
  isPending,
  onSetDefault,
}: {
  readonly environment: SharedProjectEnvironment;
  readonly canManage: boolean;
  readonly isPending: boolean;
  readonly onSetDefault: () => void;
}) {
  return (
    <SettingsRow
      title={environment.name}
      description={environment.baseUrl}
      status={`Type: ${environment.type}. Validation: ${environment.validationStatus}. Source: ${environment.source}.`}
      control={
        <div className="flex items-center gap-2">
          <Badge
            variant={
              environment.validationStatus === "invalid-url"
                ? "error"
                : environment.isDefault
                  ? "success"
                  : "outline"
            }
          >
            {environment.isDefault ? "default" : environment.validationStatus}
          </Badge>
          {canManage && !environment.isDefault ? (
            <Button size="xs" variant="outline" disabled={isPending} onClick={onSetDefault}>
              Set default
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

function DeployRow({
  deploy,
  environments,
}: {
  readonly deploy: SharedDeployAssociation;
  readonly environments: readonly SharedProjectEnvironment[];
}) {
  const environment = environments.find((entry) => entry.id === deploy.environmentId);
  return (
    <SettingsRow
      title={deploy.branch}
      description={deploy.deployUrl}
      status={`Environment: ${environment?.name ?? deploy.environmentId}. Deployed SHA: ${shortSha(deploy.deployedSha)}.`}
      control={
        <Badge
          variant={
            deploy.state === "current"
              ? "success"
              : deploy.state === "stale"
                ? "warning"
                : "outline"
          }
        >
          {deploy.state}
        </Badge>
      }
    />
  );
}
