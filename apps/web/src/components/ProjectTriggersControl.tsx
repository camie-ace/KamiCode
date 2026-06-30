import type {
  EnvironmentId,
  ProjectId,
  ProjectTriggerId as ContractProjectTriggerId,
  ProjectTriggerRecord as ContractProjectTriggerRecord,
  ProjectTriggerRuntimeTarget,
} from "@t3tools/contracts";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ClockIcon, PlayIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePrimaryEnvironmentId } from "../state/environments";
import { projectTriggerEnvironment } from "../state/projectTriggers";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Group, GroupSeparator } from "./ui/group";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export type ProjectTriggerId = ContractProjectTriggerId;
export type ProjectTriggerExecutionLocation = "this-runtime" | "remote-runtime";

export interface ProjectTrigger {
  readonly id: ProjectTriggerId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly description?: string | null;
  readonly schedule: string;
  readonly enabled: boolean;
  readonly prompt?: string | null;
  readonly timezone?: string | null;
  readonly executionLocation?: ProjectTriggerExecutionLocation | null;
  readonly nextFireAt?: string | null;
  readonly lastFiredAt?: string | null;
  readonly lastRunStatus?: ContractProjectTriggerRecord["lastRunStatus"];
  readonly runtimeLabel?: string | null;
}

export interface ProjectTriggerMutationInput {
  readonly name: string;
  readonly description: string | null;
  readonly schedule: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly timezone: string | null;
  readonly executionLocation: ProjectTriggerExecutionLocation;
}

export interface ProjectTriggerCreateInput extends ProjectTriggerMutationInput {
  readonly projectId: ProjectId;
}

export interface ProjectTriggerUpdateInput {
  readonly projectId: ProjectId;
  readonly triggerId: ProjectTriggerId;
  readonly patch: ProjectTriggerMutationInput;
}

export interface ProjectTriggerDeleteInput {
  readonly projectId: ProjectId;
  readonly triggerId: ProjectTriggerId;
}

export interface ProjectTriggerRunNowInput {
  readonly projectId: ProjectId;
  readonly triggerId: ProjectTriggerId;
}

export interface ProjectTriggerListInput {
  readonly projectId: ProjectId;
}

export interface ProjectTriggerListResult {
  readonly triggers: readonly ProjectTrigger[];
}

export interface ProjectTriggerRunNowResult {
  readonly runId?: string;
  readonly startedAt?: string;
}

export interface ProjectTriggersSettingsFocus {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

const PROJECT_TRIGGERS_SETTINGS_FOCUS_KEY = "t3tools.projectTriggers.settingsFocus";

function projectRefKey(input: ProjectTriggersSettingsFocus): string {
  return `${input.environmentId}:${input.projectId}`;
}

export function writeProjectTriggersSettingsFocus(input: ProjectTriggersSettingsFocus): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PROJECT_TRIGGERS_SETTINGS_FOCUS_KEY, JSON.stringify(input));
}

export function readProjectTriggersSettingsFocus(): ProjectTriggersSettingsFocus | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PROJECT_TRIGGERS_SETTINGS_FOCUS_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ProjectTriggersSettingsFocus>;
    if (typeof parsed.environmentId !== "string" || typeof parsed.projectId !== "string") {
      return null;
    }
    return {
      environmentId: parsed.environmentId as EnvironmentId,
      projectId: parsed.projectId as ProjectId,
    };
  } catch {
    return null;
  }
}

export function clearProjectTriggersSettingsFocus(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PROJECT_TRIGGERS_SETTINGS_FOCUS_KEY);
}

export function projectTriggersProjectKey(input: ProjectTriggersSettingsFocus): string {
  return projectRefKey(input);
}

export function resolveProjectTriggerExecutionLocation(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
): ProjectTriggerExecutionLocation {
  return primaryEnvironmentId !== null && environmentId !== primaryEnvironmentId
    ? "remote-runtime"
    : "this-runtime";
}

export function projectTriggerExecutionLocationLabel(
  location: ProjectTriggerExecutionLocation,
): string {
  return location === "remote-runtime" ? "remote runtime" : "this runtime";
}

function toRuntimeTarget(location: ProjectTriggerExecutionLocation): ProjectTriggerRuntimeTarget {
  return location === "remote-runtime" ? "remote" : "local";
}

function fromRuntimeTarget(runtime: ProjectTriggerRuntimeTarget): ProjectTriggerExecutionLocation {
  return runtime === "remote" ? "remote-runtime" : "this-runtime";
}

function toProjectTrigger(record: ContractProjectTriggerRecord): ProjectTrigger {
  const schedule =
    record.schedule.kind === "cron"
      ? {
          expression: record.schedule.expression,
          timezone: record.schedule.timezone ?? null,
          executionLocation: fromRuntimeTarget(record.schedule.runtime),
        }
      : {
          expression: "",
          timezone: null,
          executionLocation: null,
        };

  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    description: record.description,
    schedule: schedule.expression,
    enabled: record.enabled,
    prompt: record.threadTemplate.prompt,
    timezone: schedule.timezone,
    executionLocation: schedule.executionLocation,
    nextFireAt: record.nextRunAt,
    lastFiredAt: record.lastRunAt,
    lastRunStatus: record.lastRunStatus,
  };
}

function toContractSchedule(input: ProjectTriggerMutationInput) {
  return {
    kind: "cron" as const,
    expression: input.schedule,
    runtime: toRuntimeTarget(input.executionLocation),
    ...(input.timezone ? { timezone: input.timezone } : {}),
  };
}

function toContractThreadTemplate(input: ProjectTriggerMutationInput) {
  return {
    prompt: input.prompt,
    titleSeed: input.name,
  };
}

function unwrapCommandResult<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Success") {
    return result.value;
  }
  throw squashAtomCommandFailure(result);
}

export function useProjectTriggerActions() {
  const listCommand = useAtomCommand(projectTriggerEnvironment.list, {
    label: "list project triggers",
    reportFailure: false,
  });
  const createCommand = useAtomCommand(projectTriggerEnvironment.create, {
    label: "create project trigger",
    reportFailure: false,
  });
  const updateCommand = useAtomCommand(projectTriggerEnvironment.update, {
    label: "update project trigger",
    reportFailure: false,
  });
  const deleteCommand = useAtomCommand(projectTriggerEnvironment.delete, {
    label: "delete project trigger",
    reportFailure: false,
  });
  const fireCommand = useAtomCommand(projectTriggerEnvironment.fire, {
    label: "fire project trigger",
    reportFailure: false,
  });

  return useMemo(
    () => ({
      listProjectTriggers: async (input: {
        readonly environmentId: EnvironmentId;
        readonly projectId: ProjectId;
      }): Promise<readonly ProjectTrigger[]> => {
        const result = unwrapCommandResult(
          await listCommand({
            environmentId: input.environmentId,
            input: { projectId: input.projectId },
          }),
        );
        return result.triggers.map(toProjectTrigger);
      },
      createProjectTrigger: async (input: {
        readonly environmentId: EnvironmentId;
        readonly trigger: ProjectTriggerCreateInput;
      }): Promise<ProjectTrigger> => {
        const result = unwrapCommandResult(
          await createCommand({
            environmentId: input.environmentId,
            input: {
              projectId: input.trigger.projectId,
              name: input.trigger.name,
              description: input.trigger.description,
              enabled: input.trigger.enabled,
              schedule: toContractSchedule(input.trigger),
              threadTemplate: toContractThreadTemplate(input.trigger),
            },
          }),
        );
        return toProjectTrigger(result.trigger);
      },
      updateProjectTrigger: async (input: {
        readonly environmentId: EnvironmentId;
        readonly trigger: ProjectTriggerUpdateInput;
      }): Promise<ProjectTrigger> => {
        const result = unwrapCommandResult(
          await updateCommand({
            environmentId: input.environmentId,
            input: {
              triggerId: input.trigger.triggerId,
              patch: {
                name: input.trigger.patch.name,
                description: input.trigger.patch.description,
                enabled: input.trigger.patch.enabled,
                schedule: toContractSchedule(input.trigger.patch),
                threadTemplate: toContractThreadTemplate(input.trigger.patch),
              },
            },
          }),
        );
        return toProjectTrigger(result.trigger);
      },
      deleteProjectTrigger: async (input: {
        readonly environmentId: EnvironmentId;
        readonly trigger: ProjectTriggerDeleteInput;
      }): Promise<void> => {
        unwrapCommandResult(
          await deleteCommand({
            environmentId: input.environmentId,
            input: { triggerId: input.trigger.triggerId },
          }),
        );
      },
      runProjectTriggerNow: async (input: {
        readonly environmentId: EnvironmentId;
        readonly trigger: ProjectTriggerRunNowInput;
      }): Promise<ProjectTriggerRunNowResult> => {
        const result = unwrapCommandResult(
          await fireCommand({
            environmentId: input.environmentId,
            input: { triggerId: input.trigger.triggerId },
          }),
        );
        return {
          runId: result.run.id,
          startedAt: result.run.startedAt ?? result.run.createdAt,
        };
      },
    }),
    [createCommand, deleteCommand, fireCommand, listCommand, updateCommand],
  );
}

export function formatProjectTriggerFireTime(value: string | null | undefined): string {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatCompactFireTime(value: string | null | undefined): string {
  if (!value) return "No next fire";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const now = new Date();
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  return parsed.toLocaleString(
    undefined,
    sameDay ? { timeStyle: "short" } : { dateStyle: "short" },
  );
}

function compareNextFire(left: ProjectTrigger, right: ProjectTrigger): number {
  const leftTime = left.nextFireAt ? Date.parse(left.nextFireAt) : Number.POSITIVE_INFINITY;
  const rightTime = right.nextFireAt ? Date.parse(right.nextFireAt) : Number.POSITIVE_INFINITY;
  return leftTime - rightTime;
}

function toastTriggerError(title: string, error: unknown): void {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

interface ProjectTriggersControlProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | undefined;
  readonly projectName: string | undefined;
}

export default function ProjectTriggersControl({
  environmentId,
  projectId,
  projectName,
}: ProjectTriggersControlProps) {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { listProjectTriggers, runProjectTriggerNow } = useProjectTriggerActions();
  const [triggers, setTriggers] = useState<readonly ProjectTrigger[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingTriggerId, setPendingTriggerId] = useState<ProjectTriggerId | null>(null);
  const executionLocation = resolveProjectTriggerExecutionLocation(
    environmentId,
    primaryEnvironmentId,
  );
  const executionLocationLabel = projectTriggerExecutionLocationLabel(executionLocation);

  const refreshTriggers = useCallback(async () => {
    if (!projectId) {
      setTriggers([]);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const nextTriggers = await listProjectTriggers({ environmentId, projectId });
      setTriggers([...nextTriggers].sort(compareNextFire));
    } catch (error) {
      setTriggers([]);
      setLoadError(error instanceof Error ? error.message : "Failed to load project triggers.");
    } finally {
      setIsLoading(false);
    }
  }, [environmentId, listProjectTriggers, projectId]);

  useEffect(() => {
    void refreshTriggers();
  }, [refreshTriggers]);

  const primaryTrigger = useMemo(
    () =>
      triggers.find((trigger) => trigger.enabled) ?? (triggers.length > 0 ? triggers[0]! : null),
    [triggers],
  );

  const openSettings = useCallback(() => {
    if (projectId) {
      writeProjectTriggersSettingsFocus({ environmentId, projectId });
    }
    void navigate({ to: "/settings/shared-projects" });
  }, [environmentId, navigate, projectId]);

  const runTrigger = useCallback(
    async (trigger: ProjectTrigger) => {
      if (!projectId || pendingTriggerId) return;
      setPendingTriggerId(trigger.id);
      try {
        await runProjectTriggerNow({
          environmentId,
          trigger: {
            projectId,
            triggerId: trigger.id,
          },
        });
        toastManager.add({
          type: "success",
          title: "Trigger started",
          description: `${trigger.name} was sent to ${projectTriggerExecutionLocationLabel(
            trigger.executionLocation ?? executionLocation,
          )}.`,
        });
        void refreshTriggers();
      } catch (error) {
        toastTriggerError("Failed to run trigger", error);
      } finally {
        setPendingTriggerId(null);
      }
    },
    [
      environmentId,
      executionLocation,
      executionLocationLabel,
      pendingTriggerId,
      projectId,
      refreshTriggers,
      runProjectTriggerNow,
    ],
  );

  if (!projectId) {
    return null;
  }

  if (!primaryTrigger) {
    const tooltipText = loadError ?? `Manage triggers for ${projectName ?? "this project"}`;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="outline"
              aria-label="Manage project triggers"
              onClick={openSettings}
            />
          }
        >
          {isLoading ? (
            <RefreshCwIcon className="size-3.5 animate-spin" />
          ) : (
            <ClockIcon className="size-3.5" />
          )}
          <span className="sr-only @4xl/header-actions:not-sr-only @4xl/header-actions:ml-0.5">
            Triggers
          </span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">{tooltipText}</TooltipPopup>
      </Tooltip>
    );
  }

  const primaryNextFire = formatCompactFireTime(primaryTrigger.nextFireAt);
  const primaryPending = pendingTriggerId === primaryTrigger.id;

  return (
    <Group aria-label="Project triggers">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="outline"
              aria-label={`Run ${primaryTrigger.name} trigger now`}
              disabled={pendingTriggerId !== null}
              onClick={() => void runTrigger(primaryTrigger)}
            />
          }
        >
          {primaryPending ? (
            <RefreshCwIcon className="size-3.5 animate-spin" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
          <span className="sr-only @5xl/header-actions:not-sr-only @5xl/header-actions:ml-0.5">
            {primaryTrigger.name}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          Run {primaryTrigger.name} on {executionLocationLabel}. Next: {primaryNextFire}.
        </TooltipPopup>
      </Tooltip>
      <GroupSeparator className="hidden @4xl/header-actions:block" />
      <Menu highlightItemOnHover={false}>
        <MenuTrigger
          render={<Button size="icon-xs" variant="outline" aria-label="Project trigger actions" />}
        >
          <ChevronDownIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-56">
          <MenuGroupLabel>Scheduled by {executionLocationLabel}</MenuGroupLabel>
          {triggers.map((trigger) => {
            const pending = pendingTriggerId === trigger.id;
            return (
              <MenuItem
                key={trigger.id}
                disabled={pendingTriggerId !== null}
                onClick={() => void runTrigger(trigger)}
              >
                {pending ? (
                  <RefreshCwIcon className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {trigger.enabled ? trigger.name : `${trigger.name} (disabled)`}
                </span>
                <MenuShortcut className="tracking-normal">
                  {formatCompactFireTime(trigger.nextFireAt)}
                </MenuShortcut>
              </MenuItem>
            );
          })}
          <MenuSeparator />
          <MenuItem onClick={openSettings}>
            <SettingsIcon className="size-4" />
            Manage triggers
          </MenuItem>
          <MenuItem disabled={isLoading} onClick={() => void refreshTriggers()}>
            <RefreshCwIcon className={isLoading ? "size-4 animate-spin" : "size-4"} />
            Refresh
          </MenuItem>
        </MenuPopup>
      </Menu>
    </Group>
  );
}
