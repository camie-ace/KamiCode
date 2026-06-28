import type { EnvironmentId } from "@t3tools/contracts";
import { ClockIcon, PencilIcon, PlayIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import React, { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import type { Project } from "../../types";
import {
  clearProjectTriggersSettingsFocus,
  formatProjectTriggerFireTime,
  projectTriggerExecutionLocationLabel,
  projectTriggersProjectKey,
  readProjectTriggersSettingsFocus,
  resolveProjectTriggerExecutionLocation,
  type ProjectTrigger,
  type ProjectTriggerExecutionLocation,
  type ProjectTriggerMutationInput,
  useProjectTriggerActions,
} from "../ProjectTriggersControl";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const SELECT_CLASS =
  "h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground shadow-xs/5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24";

type LoadState =
  | { readonly status: "idle" | "loading" | "loaded" }
  | { readonly status: "error"; readonly message: string };

interface TriggerFormState {
  readonly name: string;
  readonly schedule: string;
  readonly prompt: string;
  readonly enabled: boolean;
  readonly timezone: string;
  readonly executionLocation: ProjectTriggerExecutionLocation;
}

interface ProjectTriggersSectionProps {
  readonly projects: readonly Project[];
  readonly preferredProjectId?: string | null;
}

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function defaultTriggerForm(executionLocation: ProjectTriggerExecutionLocation): TriggerFormState {
  return {
    name: "",
    schedule: "0 9 * * 1-5",
    prompt: "",
    enabled: true,
    timezone: defaultTimezone(),
    executionLocation,
  };
}

function triggerFormFromTrigger(
  trigger: ProjectTrigger,
  fallbackExecutionLocation: ProjectTriggerExecutionLocation,
): TriggerFormState {
  return {
    name: trigger.name,
    schedule: trigger.schedule,
    prompt: trigger.prompt ?? "",
    enabled: trigger.enabled,
    timezone: trigger.timezone ?? defaultTimezone(),
    executionLocation: fallbackExecutionLocation,
  };
}

function mutationFromForm(form: TriggerFormState): ProjectTriggerMutationInput {
  return {
    name: form.name.trim(),
    schedule: form.schedule.trim(),
    prompt: form.prompt.trim(),
    enabled: form.enabled,
    timezone: form.timezone.trim() ? form.timezone.trim() : null,
    executionLocation: form.executionLocation,
  };
}

function mutationFromTrigger(
  trigger: ProjectTrigger,
  executionLocation: ProjectTriggerExecutionLocation,
  enabled: boolean,
): ProjectTriggerMutationInput {
  return {
    name: trigger.name,
    schedule: trigger.schedule,
    prompt: trigger.prompt ?? "",
    enabled,
    timezone: trigger.timezone ?? null,
    executionLocation,
  };
}

function projectOptionKey(project: Pick<Project, "environmentId" | "id">): string {
  return projectTriggersProjectKey({
    environmentId: project.environmentId,
    projectId: project.id,
  });
}

function projectRuntimeStatus(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
): string {
  const location = resolveProjectTriggerExecutionLocation(environmentId, primaryEnvironmentId);
  return `Scheduler: ${projectTriggerExecutionLocationLabel(location)}. Browser edits only.`;
}

function triggerStatusText(trigger: ProjectTrigger, executionLocationLabel: string): string {
  return [
    `Next: ${formatProjectTriggerFireTime(trigger.nextFireAt)}`,
    `Last: ${formatProjectTriggerFireTime(trigger.lastFiredAt)}`,
    `Scheduler: ${executionLocationLabel}`,
    trigger.lastRunStatus ? `Last run: ${trigger.lastRunStatus}` : null,
  ]
    .filter(Boolean)
    .join(". ");
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

export default function ProjectTriggersSection({
  projects,
  preferredProjectId = null,
}: ProjectTriggersSectionProps) {
  const formId = React.useId();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const {
    listProjectTriggers,
    createProjectTrigger,
    updateProjectTrigger,
    deleteProjectTrigger,
    runProjectTriggerNow,
  } = useProjectTriggerActions();
  const [settingsFocus] = useState(readProjectTriggersSettingsFocus);
  const [settingsFocusApplied, setSettingsFocusApplied] = useState(false);
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<readonly ProjectTrigger[]>([]);
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTrigger, setEditingTrigger] = useState<ProjectTrigger | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectTrigger | null>(null);
  const [form, setForm] = useState<TriggerFormState>(() => defaultTriggerForm("this-runtime"));
  const [validationError, setValidationError] = useState<string | null>(null);

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        key: projectOptionKey(project),
        project,
      })),
    [projects],
  );
  const projectByKey = useMemo(
    () => new Map(projectOptions.map((entry) => [entry.key, entry.project] as const)),
    [projectOptions],
  );
  const settingsFocusKey = settingsFocus ? projectTriggersProjectKey(settingsFocus) : null;
  const preferredProjectKey = useMemo(() => {
    if (!preferredProjectId) return null;
    return projectOptions.find((entry) => entry.project.id === preferredProjectId)?.key ?? null;
  }, [preferredProjectId, projectOptions]);

  useEffect(() => {
    if (settingsFocusKey && !settingsFocusApplied && projectByKey.has(settingsFocusKey)) {
      setSelectedProjectKey(settingsFocusKey);
      setSettingsFocusApplied(true);
      clearProjectTriggersSettingsFocus();
      return;
    }

    setSelectedProjectKey((current) => {
      if (current && projectByKey.has(current)) return current;
      if (preferredProjectKey && projectByKey.has(preferredProjectKey)) return preferredProjectKey;
      return projectOptions[0]?.key ?? null;
    });
  }, [preferredProjectKey, projectByKey, projectOptions, settingsFocusApplied, settingsFocusKey]);

  const selectedProject = selectedProjectKey
    ? (projectByKey.get(selectedProjectKey) ?? null)
    : null;
  const selectedExecutionLocation = selectedProject
    ? resolveProjectTriggerExecutionLocation(selectedProject.environmentId, primaryEnvironmentId)
    : "this-runtime";
  const selectedExecutionLocationLabel =
    projectTriggerExecutionLocationLabel(selectedExecutionLocation);

  const reloadTriggers = useCallback(async () => {
    if (!selectedProject) {
      setTriggers([]);
      setLoadState({ status: "idle" });
      return;
    }

    setLoadState({ status: "loading" });
    try {
      const nextTriggers = await listProjectTriggers({
        environmentId: selectedProject.environmentId,
        projectId: selectedProject.id,
      });
      setTriggers([...nextTriggers]);
      setLoadState({ status: "loaded" });
    } catch (error) {
      setTriggers([]);
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load project triggers.",
      });
    }
  }, [listProjectTriggers, selectedProject]);

  useEffect(() => {
    void reloadTriggers();
  }, [reloadTriggers]);

  const openCreateDialog = useCallback(() => {
    setEditingTrigger(null);
    setForm(defaultTriggerForm(selectedExecutionLocation));
    setValidationError(null);
    setDialogOpen(true);
  }, [selectedExecutionLocation]);

  const openEditDialog = useCallback(
    (trigger: ProjectTrigger) => {
      setEditingTrigger(trigger);
      setForm(triggerFormFromTrigger(trigger, selectedExecutionLocation));
      setValidationError(null);
      setDialogOpen(true);
    },
    [selectedExecutionLocation],
  );

  const submitForm = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!selectedProject) return;

      const mutation = mutationFromForm(form);
      if (!mutation.name) {
        setValidationError("Name is required.");
        return;
      }
      if (!mutation.schedule) {
        setValidationError("Schedule is required.");
        return;
      }
      if (!mutation.prompt) {
        setValidationError("Prompt is required.");
        return;
      }

      setPendingAction(editingTrigger ? `update:${editingTrigger.id}` : "create");
      setValidationError(null);
      try {
        if (editingTrigger) {
          await updateProjectTrigger({
            environmentId: selectedProject.environmentId,
            trigger: {
              projectId: selectedProject.id,
              triggerId: editingTrigger.id,
              patch: mutation,
            },
          });
        } else {
          await createProjectTrigger({
            environmentId: selectedProject.environmentId,
            trigger: {
              projectId: selectedProject.id,
              ...mutation,
            },
          });
        }
        setDialogOpen(false);
        await reloadTriggers();
      } catch (error) {
        setValidationError(error instanceof Error ? error.message : "Failed to save trigger.");
      } finally {
        setPendingAction(null);
      }
    },
    [createProjectTrigger, editingTrigger, form, reloadTriggers, selectedProject, updateProjectTrigger],
  );

  const toggleTriggerEnabled = useCallback(
    async (trigger: ProjectTrigger, enabled: boolean) => {
      if (!selectedProject || pendingAction !== null) return;
      setPendingAction(`toggle:${trigger.id}`);
      try {
        await updateProjectTrigger({
          environmentId: selectedProject.environmentId,
          trigger: {
            projectId: selectedProject.id,
            triggerId: trigger.id,
            patch: mutationFromTrigger(trigger, selectedExecutionLocation, enabled),
          },
        });
        await reloadTriggers();
      } catch (error) {
        toastTriggerError("Failed to update trigger", error);
      } finally {
        setPendingAction(null);
      }
    },
    [pendingAction, reloadTriggers, selectedExecutionLocation, selectedProject, updateProjectTrigger],
  );

  const runTrigger = useCallback(
    async (trigger: ProjectTrigger) => {
      if (!selectedProject || pendingAction !== null) return;
      setPendingAction(`run:${trigger.id}`);
      try {
        await runProjectTriggerNow({
          environmentId: selectedProject.environmentId,
          trigger: {
            projectId: selectedProject.id,
            triggerId: trigger.id,
          },
        });
        toastManager.add({
          type: "success",
          title: "Trigger started",
          description: `${trigger.name} was sent to ${selectedExecutionLocationLabel}.`,
        });
        await reloadTriggers();
      } catch (error) {
        toastTriggerError("Failed to run trigger", error);
      } finally {
        setPendingAction(null);
      }
    },
    [
      pendingAction,
      reloadTriggers,
      runProjectTriggerNow,
      selectedExecutionLocationLabel,
      selectedProject,
    ],
  );

  const confirmDelete = useCallback(async () => {
    if (!selectedProject || !deleteTarget || pendingAction !== null) return;
    setPendingAction(`delete:${deleteTarget.id}`);
    try {
      await deleteProjectTrigger({
        environmentId: selectedProject.environmentId,
        trigger: {
          projectId: selectedProject.id,
          triggerId: deleteTarget.id,
        },
      });
      setDeleteTarget(null);
      await reloadTriggers();
    } catch (error) {
      toastTriggerError("Failed to delete trigger", error);
    } finally {
      setPendingAction(null);
    }
  }, [deleteProjectTrigger, deleteTarget, pendingAction, reloadTriggers, selectedProject]);

  return (
    <>
      <SettingsSection
        id="project-triggers"
        title="Project triggers"
        icon={<ClockIcon className="size-3.5" />}
        headerAction={
          <Button
            size="xs"
            variant="outline"
            disabled={!selectedProject || pendingAction !== null}
            onClick={openCreateDialog}
          >
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        }
      >
        {projectOptions.length === 0 ? (
          <SettingsRow
            title="No project"
            description="Load a project before adding runtime-scheduled triggers."
          />
        ) : (
          <SettingsRow
            title="Project"
            description={selectedProject?.workspaceRoot ?? "Select a loaded project."}
            status={
              selectedProject
                ? projectRuntimeStatus(selectedProject.environmentId, primaryEnvironmentId)
                : null
            }
            control={
              <select
                className={SELECT_CLASS}
                value={selectedProjectKey ?? ""}
                onChange={(event) => setSelectedProjectKey(event.currentTarget.value || null)}
              >
                {projectOptions.map(({ key, project }) => (
                  <option key={key} value={key}>
                    {project.title}
                  </option>
                ))}
              </select>
            }
          />
        )}

        {loadState.status === "loading" ? (
          <SettingsRow
            title="Loading triggers"
            description="Reading schedules from the selected runtime."
            control={<RefreshCwIcon className="size-3.5 animate-spin text-muted-foreground" />}
          />
        ) : null}

        {loadState.status === "error" ? (
          <SettingsRow
            title="Triggers unavailable"
            description={loadState.message}
            control={
              <Button size="xs" variant="outline" onClick={() => void reloadTriggers()}>
                <RefreshCwIcon className="size-3.5" />
                Retry
              </Button>
            }
          />
        ) : null}

        {loadState.status === "loaded" && triggers.length === 0 ? (
          <SettingsRow
            title="No triggers"
            description={`No schedules are configured for ${selectedProject?.title ?? "this project"}.`}
            control={
              <Button size="xs" onClick={openCreateDialog} disabled={!selectedProject}>
                <PlusIcon className="size-3.5" />
                Add trigger
              </Button>
            }
          />
        ) : null}

        {loadState.status === "loaded"
          ? triggers.map((trigger) => {
              const runPending = pendingAction === `run:${trigger.id}`;
              const anyPending = pendingAction !== null;
              return (
                <SettingsRow
                  key={trigger.id}
                  title={
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{trigger.name}</span>
                      <Badge variant={trigger.enabled ? "success" : "outline"} size="sm">
                        {trigger.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </span>
                  }
                  description={trigger.schedule}
                  status={triggerStatusText(trigger, selectedExecutionLocationLabel)}
                  control={
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={trigger.enabled}
                        disabled={anyPending}
                        aria-label={`${trigger.enabled ? "Disable" : "Enable"} ${trigger.name}`}
                        onCheckedChange={(checked) =>
                          void toggleTriggerEnabled(trigger, Boolean(checked))
                        }
                      />
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={anyPending}
                        onClick={() => void runTrigger(trigger)}
                      >
                        {runPending ? (
                          <RefreshCwIcon className="size-3.5 animate-spin" />
                        ) : (
                          <PlayIcon className="size-3.5" />
                        )}
                        Run now
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="outline"
                        aria-label={`Edit ${trigger.name}`}
                        disabled={anyPending}
                        onClick={() => openEditDialog(trigger)}
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="destructive-outline"
                        aria-label={`Delete ${trigger.name}`}
                        disabled={anyPending}
                        onClick={() => setDeleteTarget(trigger)}
                      >
                        <Trash2Icon className="size-3.5" />
                      </Button>
                    </div>
                  }
                >
                  {trigger.prompt ? (
                    <div className="mt-3 border-t border-border/50 py-3 text-xs text-muted-foreground">
                      <p className="line-clamp-3 whitespace-pre-wrap">{trigger.prompt}</p>
                    </div>
                  ) : null}
                </SettingsRow>
              );
            })
          : null}
      </SettingsSection>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
        }}
        onOpenChangeComplete={(open) => {
          if (open) return;
          setEditingTrigger(null);
          setValidationError(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{editingTrigger ? "Edit Trigger" : "Add Trigger"}</DialogTitle>
            <DialogDescription>
              The selected runtime stores the schedule and starts the trigger.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={formId} className="space-y-4" onSubmit={submitForm}>
              <div className="space-y-1.5">
                <Label htmlFor="project-trigger-name">Name</Label>
                <Input
                  id="project-trigger-name"
                  autoFocus
                  placeholder="Morning project check"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.currentTarget.value }))
                  }
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="project-trigger-schedule">Schedule</Label>
                  <Input
                    id="project-trigger-schedule"
                    placeholder="0 9 * * 1-5"
                    value={form.schedule}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, schedule: event.currentTarget.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="project-trigger-timezone">Timezone</Label>
                  <Input
                    id="project-trigger-timezone"
                    value={form.timezone}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, timezone: event.currentTarget.value }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-trigger-scheduler">Scheduler</Label>
                <select
                  id="project-trigger-scheduler"
                  className={`${SELECT_CLASS} w-full`}
                  value={form.executionLocation}
                  disabled
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value === "this-runtime" || value === "remote-runtime") {
                      setForm((current) => ({ ...current, executionLocation: value }));
                    }
                  }}
                >
                  <option value="this-runtime">This runtime</option>
                  <option value="remote-runtime">Remote runtime</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="project-trigger-prompt">Prompt</Label>
                <Textarea
                  id="project-trigger-prompt"
                  placeholder="Check the project status and summarize anything that needs attention."
                  value={form.prompt}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, prompt: event.currentTarget.value }))
                  }
                />
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
                <span>Enabled</span>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({ ...current, enabled: Boolean(checked) }))
                  }
                />
              </label>
              {validationError ? (
                <p className="text-sm text-destructive">{validationError}</p>
              ) : null}
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button form={formId} type="submit" disabled={pendingAction !== null}>
              {pendingAction === "create" || pendingAction?.startsWith("update:") ? (
                <RefreshCwIcon className="size-3.5 animate-spin" />
              ) : null}
              {editingTrigger ? "Save changes" : "Save trigger"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete trigger "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This trigger cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={pendingAction !== null}
              onClick={() => void confirmDelete()}
            >
              Delete trigger
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
