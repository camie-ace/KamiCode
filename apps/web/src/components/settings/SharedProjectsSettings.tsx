import type {
  ProjectId,
  SharedDeployAssociation,
  SharedEnvironmentType,
  SharedProjectDetail,
  SharedProjectEnvironment,
  SharedProjectId,
  SharedProjectRole,
  SharedRuntimeHealth,
  SharedRuntimeType,
  SharedThread,
  SharedThreadVisibility,
} from "@t3tools/contracts";
import {
  SharedProjectEnvironmentId,
  SharedProjectInviteCode,
  SharedRuntimeId,
} from "@t3tools/contracts";
import {
  CloudIcon,
  Code2Icon,
  GitBranchIcon,
  KeyRoundIcon,
  LinkIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  SendIcon,
  ServerIcon,
  Share2Icon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  appendSharedThreadMessage,
  claimSharedProjectInvite,
  createSharedProjectInvite,
  fetchSharedProjectCurrentUser,
  fetchSharedProjectDetail,
  listSharedProjects,
  publishLocalProject,
  publishSharedThread,
  removeSharedProjectMember,
  setSharedDefaultEnvironment,
  syncSharedProjectContext,
  syncSharedRemoteRuntime,
  updateSharedProjectMemberRole,
  updateSharedThreadVisibility,
  upsertSharedDeployAssociation,
  upsertSharedEnvironment,
  upsertSharedRuntime,
} from "../../sharedProjectsApi";
import {
  selectProjectsAcrossEnvironments,
  selectThreadShellsAcrossEnvironments,
  useStore,
} from "../../store";
import type { Project, ThreadShell } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const SELECT_CLASS =
  "h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-xs/5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24";

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded" }
  | { readonly status: "error"; readonly message: string };

type CurrentSharedUser = Awaited<ReturnType<typeof fetchSharedProjectCurrentUser>>["user"];

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

function detailCanManage(detail: SharedProjectDetail | null): boolean {
  return detail?.project.role === "owner" || detail?.project.role === "admin";
}

function detailCanEdit(detail: SharedProjectDetail | null): boolean {
  return detailCanManage(detail) || detail?.project.role === "member";
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
  const localProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const localThreads = useStore(useShallow(selectThreadShellsAcrossEnvironments));
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
  const [newRuntime, setNewRuntime] = useState({
    type: "ssh-vps" as SharedRuntimeType,
    label: "VPS runtime",
    endpoint: "",
    health: "healthy" as SharedRuntimeHealth,
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
  const [threadDrafts, setThreadDrafts] = useState<Record<string, string>>({});
  const [selectedRuntimeByThreadId, setSelectedRuntimeByThreadId] = useState<
    Record<string, string>
  >({});
  const [fallbackChoiceByThreadId, setFallbackChoiceByThreadId] = useState<Record<string, string>>(
    {},
  );
  const [acceptedBootstrap, setAcceptedBootstrap] = useState<
    Awaited<ReturnType<typeof claimSharedProjectInvite>>["bootstrap"] | null
  >(null);

  const selectedLocalProject = useMemo(
    () => localProjects.find((project) => project.id === detail?.project.sourceProjectId) ?? null,
    [detail?.project.sourceProjectId, localProjects],
  );
  const sharedProjectBySourceProjectId = useMemo(
    () => new Map(sharedProjects.map((project) => [project.sourceProjectId, project] as const)),
    [sharedProjects],
  );
  const activeLocalThreads = useMemo(
    () => localThreadsForProject(localThreads, detail?.project.sourceProjectId ?? null),
    [detail?.project.sourceProjectId, localThreads],
  );
  const activeSharedThreadByLocalId = useMemo(
    () => new Map((detail?.threads ?? []).map((thread) => [thread.localThreadId, thread] as const)),
    [detail?.threads],
  );
  const defaultEnvironment =
    detail?.environments.find((environment) => environment.isDefault) ?? null;
  const selectedRuntimeByThread = useMemo(
    () =>
      new Map<string, SharedProjectDetail["runtimes"][number]>(
        (detail?.runtimes ?? []).map((runtime) => [runtime.id, runtime] as const),
      ),
    [detail?.runtimes],
  );

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
        const nextSelectedId =
          preferredProjectId ?? selectedProjectId ?? listResult.projects[0]?.id ?? null;
        setSelectedProjectId(nextSelectedId);
        if (nextSelectedId) {
          setDetail(await fetchSharedProjectDetail(nextSelectedId));
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

  const runAction = useCallback(async (key: string, action: () => Promise<void>) => {
    setPendingAction(key);
    setLoadState({ status: "loaded" });
    try {
      await action();
    } catch (error) {
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Shared project action failed.",
      });
    } finally {
      setPendingAction(null);
    }
  }, []);

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
            const shared = await publishSharedThread({
              projectId: detail.project.id,
              localThreadId: thread.id,
              title: thread.title,
              visibility,
              codeState: {
                branch: detail.project.repository.currentBranch,
                headSha: detail.project.repository.headSha,
                dirty: detail.project.repository.dirty,
                patchAttached: false,
              },
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

  const appendThreadMessage = useCallback(
    (thread: SharedThread) =>
      detail
        ? runAction(`append-message:${thread.id}`, async () => {
            const text = threadDrafts[thread.id]?.trim() ?? "";
            if (!text) return;
            const nextThread = await appendSharedThreadMessage({
              projectId: detail.project.id,
              threadId: thread.id,
              role: "user",
              text,
              ...(selectedRuntimeByThreadId[thread.id]
                ? { runtimeId: SharedRuntimeId.make(selectedRuntimeByThreadId[thread.id]!) }
                : {}),
            });
            setThreadDrafts((current) => ({ ...current, [thread.id]: "" }));
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
    [detail, runAction, selectedRuntimeByThreadId, threadDrafts],
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
              capabilities: ["execute", "test", "sync"],
              providerLabel: "User-local provider profile",
              unavailableReason:
                newRuntime.health === "unavailable" ? "Provider or runtime unavailable" : null,
            });
            setNewRuntime({
              type: "ssh-vps",
              label: "VPS runtime",
              endpoint: "",
              health: "healthy",
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

      <SettingsSection title="Local project publishing" icon={<Code2Icon className="size-3.5" />}>
        {localProjects.map((project) => {
          const shared = sharedProjectBySourceProjectId.get(project.id) ?? null;
          return (
            <SettingsRow
              key={`${project.environmentId}:${project.id}`}
              title={project.name}
              description={project.cwd}
              status={
                shared ? (
                  <span className="text-success-foreground">Shared as {shared.name}</span>
                ) : (
                  "Local-only"
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
                    Share
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
            title="Shared threads"
            icon={<MessagesSquareIcon className="size-3.5" />}
          >
            {activeLocalThreads.map((thread) => {
              const shared = activeSharedThreadByLocalId.get(thread.id) ?? null;
              const selectedRuntimeId =
                selectedRuntimeByThreadId[shared?.id ?? ""] ?? detail.runtimes[0]?.id ?? "";
              const selectedRuntime = selectedRuntimeByThread.get(selectedRuntimeId);
              return (
                <SettingsRow
                  key={thread.id}
                  title={thread.title}
                  description={shared ? `Shared thread ${shared.id}` : "Private local thread"}
                  status={
                    detail.project.repository.dirty ? (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <TriangleAlertIcon className="size-3" />
                        Dirty local changes are present; attach a patch before handoff if needed.
                      </span>
                    ) : null
                  }
                  control={
                    shared ? (
                      <select
                        className={SELECT_CLASS}
                        value={shared.visibility}
                        disabled={!canEdit}
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
                    ) : (
                      <Button
                        size="xs"
                        disabled={!canEdit || isPending}
                        onClick={() => void shareThread(thread, "shared")}
                      >
                        Share thread
                      </Button>
                    )
                  }
                >
                  {shared ? (
                    <div className="mt-3 space-y-3 border-t border-border/50 py-3">
                      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                        <span>Branch {shared.codeState.branch ?? "unknown"}</span>
                        <span>SHA {shortSha(shared.codeState.headSha)}</span>
                        <span>{shared.codeState.dirty ? "Dirty work" : "Clean"}</span>
                        <span>
                          {shared.codeState.patchAttached ? "Patch attached" : "No patch"}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                          className={SELECT_CLASS}
                          value={selectedRuntimeId}
                          onChange={(event) =>
                            setSelectedRuntimeByThreadId((current) => ({
                              ...current,
                              [shared.id]: event.currentTarget.value,
                            }))
                          }
                        >
                          {detail.runtimes.map((runtime) => (
                            <option
                              key={runtime.id}
                              value={runtime.id}
                              disabled={runtime.health === "unavailable"}
                            >
                              {runtime.label} ({runtime.health})
                            </option>
                          ))}
                        </select>
                        <Input
                          className="h-7 min-w-0 flex-1 text-xs"
                          value={threadDrafts[shared.id] ?? ""}
                          placeholder="Continuation message"
                          disabled={!canEdit}
                          onChange={(event) =>
                            setThreadDrafts((current) => ({
                              ...current,
                              [shared.id]: event.currentTarget.value,
                            }))
                          }
                        />
                        <Button
                          size="xs"
                          disabled={!canEdit || (threadDrafts[shared.id]?.trim().length ?? 0) === 0}
                          onClick={() => void appendThreadMessage(shared)}
                        >
                          <SendIcon className="size-3.5" />
                          Send
                        </Button>
                      </div>
                      {selectedRuntime?.health === "unavailable" ? (
                        <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning sm:flex-row sm:items-center">
                          <span className="flex-1">
                            Selected runtime cannot continue. Provider credits and credentials stay
                            runtime-local.
                          </span>
                          <select
                            className={SELECT_CLASS}
                            value={fallbackChoiceByThreadId[shared.id] ?? "sync"}
                            onChange={(event) =>
                              setFallbackChoiceByThreadId((current) => ({
                                ...current,
                                [shared.id]: event.currentTarget.value,
                              }))
                            }
                          >
                            <option value="sync">Continue locally and sync</option>
                            <option value="private">Continue locally privately</option>
                          </select>
                        </div>
                      ) : null}
                      {shared.messages.length > 0 ? (
                        <div className="space-y-1 text-xs">
                          {shared.messages.slice(-4).map((message) => (
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
              <EmptyRow>No local threads are attached to this project.</EmptyRow>
            ) : null}
          </SettingsSection>

          <SettingsSection title="Runtimes" icon={<ServerIcon className="size-3.5" />}>
            {detail.runtimes.map((runtime) => (
              <SettingsRow
                key={runtime.id}
                title={runtime.label}
                description={runtime.endpointLabel ?? "No endpoint"}
                status={`Provider: ${runtime.providerLabel ?? "runtime-local"}. Capabilities: ${runtime.capabilities.join(", ")}.`}
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
                  <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[7rem_9rem_13rem_7rem_auto]">
                    <select
                      className={SELECT_CLASS}
                      value={newRuntime.type}
                      onChange={(event) =>
                        setNewRuntime((current) => ({
                          ...current,
                          type: event.currentTarget.value as SharedRuntimeType,
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
