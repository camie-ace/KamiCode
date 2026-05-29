import type { UserAuthSessionState } from "@t3tools/contracts";
import { ExternalLinkIcon, LogOutIcon, RefreshCwIcon, UserRoundIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  fetchUserAuthSessionState,
  logoutGitHubUser,
  startGitHubUserLogin,
} from "../../environments/primary/userAuth";
import { GitHubIcon } from "../Icons";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

type ProfileSessionLoadState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly session: UserAuthSessionState }
  | { readonly status: "error"; readonly message: string };

type AuthenticatedUserAuthSession = Extract<UserAuthSessionState, { readonly authenticated: true }>;

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function GitHubAvatar({
  avatarUrl,
  displayName,
  githubLogin,
}: {
  readonly avatarUrl: string | null;
  readonly displayName: string | null;
  readonly githubLogin: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const label = displayName ?? githubLogin;

  if (!avatarUrl || imageFailed) {
    return (
      <span className="grid size-11 shrink-0 place-items-center rounded-full border border-border/70 bg-muted text-muted-foreground">
        <UserRoundIcon className="size-5" />
      </span>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt={label}
      className="size-11 shrink-0 rounded-full border border-border/70 bg-muted object-cover"
      onError={() => setImageFailed(true)}
    />
  );
}

function ProfileSessionSkeleton() {
  return (
    <SettingsRow
      title={<Skeleton className="h-4 w-28 rounded-full" />}
      description={<Skeleton className="h-3 w-52 rounded-full" />}
      control={<Skeleton className="h-7 w-20 rounded-md" />}
    >
      <div className="mt-3 flex items-center gap-3 border-t border-border/50 py-4">
        <Skeleton className="size-11 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-40 rounded-full" />
          <Skeleton className="h-3 w-28 rounded-full" />
        </div>
      </div>
    </SettingsRow>
  );
}

function AuthenticatedGitHubProfileRow({
  session,
  actionError,
  isPending,
  onOpenGitHubProfile,
  onSignOut,
}: {
  readonly session: AuthenticatedUserAuthSession;
  readonly actionError: string | null;
  readonly isPending: boolean;
  readonly onOpenGitHubProfile: (githubLogin: string) => void;
  readonly onSignOut: () => void;
}) {
  return (
    <SettingsRow
      title="GitHub connection"
      description="KamiCode uses this account for workspace access."
      status={actionError ? <span className="text-destructive">{actionError}</span> : null}
      control={
        <Button
          size="xs"
          variant="destructive-outline"
          disabled={isPending}
          onClick={() => onSignOut()}
        >
          <LogOutIcon className="size-3.5" />
          Sign out
        </Button>
      }
    >
      <div className="mt-3 flex flex-col gap-3 border-t border-border/50 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <GitHubAvatar
            avatarUrl={session.user.avatarUrl}
            displayName={session.user.displayName}
            githubLogin={session.user.githubLogin}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {session.user.displayName ?? session.user.githubLogin}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <GitHubIcon className="size-3.5 shrink-0" />
              <span className="truncate">@{session.user.githubLogin}</span>
            </div>
          </div>
        </div>
        <Button
          size="xs"
          variant="outline"
          onClick={() => onOpenGitHubProfile(session.user.githubLogin)}
        >
          <ExternalLinkIcon className="size-3.5" />
          Open
        </Button>
      </div>
    </SettingsRow>
  );
}

export function ProfileSettingsPanel() {
  const [loadState, setLoadState] = useState<ProfileSessionLoadState>({ status: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"refresh" | "sign-out" | "connect" | null>(
    null,
  );

  const loadSession = useCallback(async () => {
    setLoadState({ status: "loading" });
    setActionError(null);
    try {
      const session = await fetchUserAuthSessionState();
      setLoadState({ status: "loaded", session });
    } catch (error) {
      setLoadState({
        status: "error",
        message: resolveErrorMessage(error, "Failed to load profile."),
      });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const refreshSession = useCallback(async () => {
    setPendingAction("refresh");
    try {
      await loadSession();
    } finally {
      setPendingAction(null);
    }
  }, [loadSession]);

  const connectGitHub = useCallback(async () => {
    setPendingAction("connect");
    setActionError(null);
    try {
      await startGitHubUserLogin();
    } catch (error) {
      setActionError(resolveErrorMessage(error, "Failed to start GitHub sign-in."));
      setPendingAction(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    setPendingAction("sign-out");
    setActionError(null);
    try {
      await logoutGitHubUser();
      window.location.reload();
    } catch (error) {
      setActionError(resolveErrorMessage(error, "Failed to sign out."));
      setPendingAction(null);
    }
  }, []);

  const openGitHubProfile = useCallback(async (githubLogin: string) => {
    const url = `https://github.com/${githubLogin}`;
    if (window.desktopBridge) {
      const opened = await window.desktopBridge.openExternal(url);
      if (opened) return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const isPending = pendingAction !== null;

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Profile"
        icon={<UserRoundIcon className="size-3.5 text-muted-foreground/70" />}
        headerAction={
          <Button
            size="xs"
            variant="outline"
            disabled={isPending}
            onClick={() => void refreshSession()}
          >
            <RefreshCwIcon
              className={pendingAction === "refresh" ? "size-3.5 animate-spin" : "size-3.5"}
            />
            Refresh
          </Button>
        }
      >
        {loadState.status === "loading" ? <ProfileSessionSkeleton /> : null}

        {loadState.status === "error" ? (
          <SettingsRow
            title="GitHub connection"
            description="Profile status is unavailable."
            status={<span className="text-destructive">{loadState.message}</span>}
            control={
              <Button size="xs" variant="outline" onClick={() => void refreshSession()}>
                <RefreshCwIcon className="size-3.5" />
                Retry
              </Button>
            }
          />
        ) : null}

        {loadState.status === "loaded" && !loadState.session.enabled ? (
          <SettingsRow
            title="GitHub connection"
            description="GitHub login is not configured on this server."
            status={actionError ? <span className="text-destructive">{actionError}</span> : null}
          />
        ) : null}

        {loadState.status === "loaded" &&
        loadState.session.enabled &&
        !loadState.session.authenticated ? (
          <SettingsRow
            title="GitHub connection"
            description="No GitHub account is connected."
            status={actionError ? <span className="text-destructive">{actionError}</span> : null}
            control={
              <Button size="xs" disabled={isPending} onClick={() => void connectGitHub()}>
                <GitHubIcon className="size-3.5" />
                Connect GitHub
              </Button>
            }
          />
        ) : null}

        {loadState.status === "loaded" &&
        loadState.session.enabled &&
        loadState.session.authenticated ? (
          <AuthenticatedGitHubProfileRow
            session={loadState.session}
            actionError={actionError}
            isPending={isPending}
            onOpenGitHubProfile={(githubLogin) => void openGitHubProfile(githubLogin)}
            onSignOut={() => void signOut()}
          />
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
