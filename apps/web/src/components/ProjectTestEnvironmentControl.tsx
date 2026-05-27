import type { ProjectTestEnvironment } from "@t3tools/contracts";
import { Globe2Icon } from "lucide-react";
import React, { type FormEvent, useMemo, useState } from "react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export const DEFAULT_LOCAL_TEST_ENVIRONMENT_ID = "default-local";

export function resolveDefaultTestEnvironment(
  testEnvironments: ReadonlyArray<ProjectTestEnvironment>,
): ProjectTestEnvironment | null {
  return testEnvironments.find((environment) => environment.isDefault) ?? null;
}

export function buildProjectTestEnvironmentsWithDefaultBaseUrl(
  testEnvironments: ReadonlyArray<ProjectTestEnvironment>,
  baseUrl: string,
): ProjectTestEnvironment[] {
  const trimmedBaseUrl = baseUrl.trim();
  const existing = testEnvironments.filter(
    (environment) => environment.id !== DEFAULT_LOCAL_TEST_ENVIRONMENT_ID,
  );

  if (trimmedBaseUrl.length === 0) {
    return existing.map((environment) => ({ ...environment }));
  }

  return [
    ...existing.map((environment) => ({ ...environment, isDefault: false })),
    {
      id: DEFAULT_LOCAL_TEST_ENVIRONMENT_ID,
      name: "Local dev",
      kind: "local",
      baseUrl: trimmedBaseUrl,
      isDefault: true,
    },
  ];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readableUrlLabel(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.host;
  } catch {
    return baseUrl;
  }
}

interface ProjectTestEnvironmentControlProps {
  testEnvironments: ReadonlyArray<ProjectTestEnvironment>;
  onUpdateTestEnvironments: (
    testEnvironments: ProjectTestEnvironment[],
  ) => Promise<void> | void;
}

export default function ProjectTestEnvironmentControl({
  testEnvironments,
  onUpdateTestEnvironments,
}: ProjectTestEnvironmentControlProps) {
  const formId = React.useId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const defaultEnvironment = useMemo(
    () => resolveDefaultTestEnvironment(testEnvironments),
    [testEnvironments],
  );
  const defaultBaseUrl = defaultEnvironment?.baseUrl ?? "";
  const testUrlLabel = defaultBaseUrl ? readableUrlLabel(defaultBaseUrl) : "Test URL";

  const openDialog = () => {
    setBaseUrl(defaultBaseUrl);
    setValidationError(null);
    setDialogOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedBaseUrl = baseUrl.trim();
    if (trimmedBaseUrl.length > 0 && !isHttpUrl(trimmedBaseUrl)) {
      setValidationError("Use an http:// or https:// URL.");
      return;
    }

    setValidationError(null);
    try {
      await onUpdateTestEnvironments(
        buildProjectTestEnvironmentsWithDefaultBaseUrl(testEnvironments, trimmedBaseUrl),
      );
      setDialogOpen(false);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save test URL.");
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={openDialog}
              aria-label="Configure default test URL"
            />
          }
        >
          <Globe2Icon className="size-3.5" />
          <span className="sr-only @4xl/header-actions:not-sr-only @4xl/header-actions:ml-0.5">
            {testUrlLabel}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {defaultBaseUrl ? `Default test URL: ${defaultBaseUrl}` : "Set default test URL"}
        </TooltipPopup>
      </Tooltip>

      <Dialog
        onOpenChange={setDialogOpen}
        onOpenChangeComplete={(open) => {
          if (open) return;
          setBaseUrl("");
          setValidationError(null);
        }}
        open={dialogOpen}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Default Test URL</DialogTitle>
            <DialogDescription>
              Project-scoped URL the test harness should open first for visual testing.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={formId} className="space-y-3" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="project-test-base-url">Base URL</Label>
                <Input
                  id="project-test-base-url"
                  autoFocus
                  placeholder="http://localhost:5173"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to clear the local default.
                </p>
              </div>
              {validationError && <p className="text-sm text-destructive">{validationError}</p>}
            </form>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button form={formId} type="submit">
              Save URL
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
