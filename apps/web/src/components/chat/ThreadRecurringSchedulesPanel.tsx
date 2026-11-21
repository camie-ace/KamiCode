import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AlarmClockIcon, PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { memo, useEffect, useState } from "react";

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
  readonly refreshKey: number;
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

  const reportLoadError = (error: unknown) => reportError("Scheduled messages unavailable", error);

  const reload = async (reportFailure = true) => {
    await (async () => {
      try {
        const next = await listProjectTriggers({ environmentId, projectId });
        setTriggers(next.filter((trigger) => trigger.targetThreadId === threadId));
      } catch (error) {
        if (reportFailure) reportLoadError(error);
      }
    })().finally(() => {
      setLoaded(true);
    });
  };

  const refreshKey = props.refreshKey;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch this thread's schedules and discard responses after the destination or refresh generation changes.
  useEffect(() => {
    let canceled = false;
    void listProjectTriggers({ environmentId, projectId }).then(
      (next) => {
        if (canceled) return;
        setTriggers(next.filter((trigger) => trigger.targetThreadId === threadId));
        setLoaded(true);
      },
      (error: unknown) => {
        if (canceled) return;
        reportLoadError(error);
        setLoaded(true);
      },
    );
    return () => {
      canceled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A schedule mutation increments refreshKey to invalidate this server read.
  }, [environmentId, projectId, threadId, listProjectTriggers, refreshKey, reportLoadError]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Poll the server while this thread has schedules whose next fire time can change.
  useEffect(() => {
    if (!loaded || triggers.length === 0) return;
    const interval = window.setInterval(() => void reload(false), 5_000);
    return () => window.clearInterval(interval);
  }, [loaded, reload, triggers.length]);

  const executionLocation = (() =>
    resolveProjectTriggerExecutionLocation(environmentId, primaryEnvironmentId))();

  const toggle = async (trigger: ProjectTrigger) => {
    setPendingId(trigger.id);
    await (async () => {
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
              ...(trigger.onceAt ? { onceAt: trigger.onceAt } : {}),
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
      }
    })().finally(() => {
      setPendingId(null);
    });
  };

  const runNow = async (trigger: ProjectTrigger) => {
    setPendingId(trigger.id);
    await (async () => {
      try {
        await runProjectTriggerNow({
          environmentId,
          trigger: { projectId, triggerId: trigger.id },
        });
        toastManager.add({ type: "success", title: "Scheduled message queued" });
        await reload();
      } catch (error) {
        reportError("Could not run schedule", error);
      }
    })().finally(() => {
      setPendingId(null);
    });
  };

  const remove = async (trigger: ProjectTrigger) => {
    setPendingId(trigger.id);
    await (async () => {
      try {
        await deleteProjectTrigger({
          environmentId,
          trigger: { projectId, triggerId: trigger.id },
        });
        await reload();
      } catch (error) {
        reportError("Could not delete schedule", error);
      }
    })().finally(() => {
      setPendingId(null);
    });
  };

  if (!loaded || triggers.length === 0) return null;

  return (
    <div className="relative z-10 mb-1.5 overflow-hidden rounded-xl border border-border/70 bg-background/96 shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs">
        <AlarmClockIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium text-foreground">Scheduled messages</span>
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
                  {trigger.onceAt && trigger.lastFiredAt && !trigger.nextFireAt
                    ? "Completed"
                    : trigger.enabled
                      ? `Next: ${formatProjectTriggerFireTime(trigger.nextFireAt)}`
                      : (lifecycleReason ?? "Paused")}
                  {trigger.createdBy ? ` · @${trigger.createdBy.githubLogin}` : ""}
                </div>
              </div>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={pendingId !== null}
                aria-label={trigger.enabled ? "Pause schedule" : "Resume schedule"}
                onClick={() => void toggle(trigger)}
              >
                {trigger.enabled ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={pendingId !== null}
                aria-label="Run scheduled message now"
                onClick={() => void runNow(trigger)}
              >
                <AlarmClockIcon className={isPending ? "animate-pulse" : undefined} />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost-muted"
                disabled={pendingId !== null}
                aria-label="Delete schedule"
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
