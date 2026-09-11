import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AlarmClockIcon, PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import {
  formatProjectTriggerFireTime,
  resolveProjectTriggerExecutionLocation,
  type ProjectTrigger,
  useProjectTriggerActions,
} from "../ProjectTriggersControl";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

function disabledReasonLabel(reason: ProjectTrigger["disabledReason"]): string | null {
  switch (reason) {
    case "thread-settled":
      return "Disabled when the thread was settled";
    case "thread-archived":
      return "Disabled when the thread was archived";
    case "thread-deleted":
      return "Disabled when the thread was deleted";
    case "thread-missing":
      return "Disabled because the thread is unavailable";
    case null:
      return null;
  }
}

function reportError(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export const ThreadRecurringSchedulesPanel = memo(function ThreadRecurringSchedulesPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}) {
  const { environmentId, projectId, threadId } = props;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { listProjectTriggers, updateProjectTrigger, deleteProjectTrigger, runProjectTriggerNow } =
    useProjectTriggerActions();
  const [triggers, setTriggers] = useState<readonly ProjectTrigger[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const reload = useCallback(
    async (reportFailure = true) => {
      try {
        const next = await listProjectTriggers({ environmentId, projectId });
        setTriggers(next.filter((trigger) => trigger.targetThreadId === threadId));
      } catch (error) {
        if (reportFailure) reportError("Recurring schedules unavailable", error);
      } finally {
        setLoaded(true);
      }
    },
    [environmentId, listProjectTriggers, projectId, threadId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!loaded || triggers.length === 0) return;
    const interval = window.setInterval(() => void reload(false), 5_000);
    return () => window.clearInterval(interval);
  }, [loaded, reload, triggers.length]);

  const executionLocation = useMemo(
    () => resolveProjectTriggerExecutionLocation(environmentId, primaryEnvironmentId),
    [environmentId, primaryEnvironmentId],
  );

  const toggle = useCallback(
    async (trigger: ProjectTrigger) => {
      setPendingId(trigger.id);
      try {
        await updateProjectTrigger({
          environmentId,
          trigger: {
            projectId,
            triggerId: trigger.id,
            patch: {
              name: trigger.name,
              description: trigger.description ?? null,
              schedule: trigger.schedule,
              prompt: trigger.prompt ?? "",
              enabled: !trigger.enabled,
              timezone: trigger.timezone ?? null,
              executionLocation: trigger.executionLocation ?? executionLocation,
            },
          },
        });
        await reload();
      } catch (error) {
        reportError(
          trigger.enabled ? "Could not pause schedule" : "Could not resume schedule",
          error,
        );
      } finally {
        setPendingId(null);
      }
    },
    [environmentId, executionLocation, projectId, reload, updateProjectTrigger],
  );

  const runNow = useCallback(
    async (trigger: ProjectTrigger) => {
      setPendingId(trigger.id);
      try {
        await runProjectTriggerNow({
          environmentId,
          trigger: { projectId, triggerId: trigger.id },
        });
        toastManager.add({ type: "success", title: "Recurring message queued" });
        await reload();
      } catch (error) {
        reportError("Could not run schedule", error);
      } finally {
        setPendingId(null);
      }
    },
    [environmentId, projectId, reload, runProjectTriggerNow],
  );

  const remove = useCallback(
    async (trigger: ProjectTrigger) => {
      setPendingId(trigger.id);
      try {
        await deleteProjectTrigger({
          environmentId,
          trigger: { projectId, triggerId: trigger.id },
        });
        await reload();
      } catch (error) {
        reportError("Could not delete schedule", error);
      } finally {
        setPendingId(null);
      }
    },
    [deleteProjectTrigger, environmentId, projectId, reload],
  );

  if (!loaded || triggers.length === 0) return null;

  return (
    <div className="relative z-10 mb-1.5 overflow-hidden rounded-xl border border-border/70 bg-background/96 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <AlarmClockIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">Recurring schedules</span>
        <span className="text-muted-foreground">{triggers.length}</span>
      </div>
      <div className="divide-y divide-border/50">
        {triggers.map((trigger) => {
          const lifecycleReason = disabledReasonLabel(trigger.disabledReason);
          const isPending = pendingId === trigger.id;
          return (
            <div key={trigger.id} className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground/90">{trigger.prompt}</div>
                <div className="mt-0.5 truncate text-muted-foreground">
                  {trigger.enabled
                    ? `Next: ${formatProjectTriggerFireTime(trigger.nextFireAt)}`
                    : (lifecycleReason ?? "Paused")}
                  {trigger.createdBy ? ` · @${trigger.createdBy.githubLogin}` : ""}
                </div>
              </div>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={pendingId !== null}
                aria-label={
                  trigger.enabled ? "Pause recurring schedule" : "Resume recurring schedule"
                }
                onClick={() => void toggle(trigger)}
              >
                {trigger.enabled ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={pendingId !== null}
                aria-label="Run recurring message now"
                onClick={() => void runNow(trigger)}
              >
                <AlarmClockIcon className={isPending ? "animate-pulse" : undefined} />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={pendingId !== null}
                aria-label="Delete recurring schedule"
                onClick={() => void remove(trigger)}
              >
                <Trash2Icon />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
});
