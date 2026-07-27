import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const projectTriggerEnvironment = {
  list: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:list",
    tag: WS_METHODS.projectTriggersList,
  }),
  get: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:get",
    tag: WS_METHODS.projectTriggersGet,
  }),
  create: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:create",
    tag: WS_METHODS.projectTriggersCreate,
  }),
  update: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:update",
    tag: WS_METHODS.projectTriggersUpdate,
  }),
  delete: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:delete",
    tag: WS_METHODS.projectTriggersDelete,
  }),
  fire: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:fire",
    tag: WS_METHODS.projectTriggersFire,
  }),
  getRun: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:get-run",
    tag: WS_METHODS.projectTriggersGetRun,
  }),
  cancelRun: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:cancel-run",
    tag: WS_METHODS.projectTriggersCancelRun,
  }),
  retryRun: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:retry-run",
    tag: WS_METHODS.projectTriggersRetryRun,
  }),
  rotateWebhookSecret: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:rotate-webhook-secret",
    tag: WS_METHODS.projectTriggersRotateWebhookSecret,
  }),
  listRuns: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:list-runs",
    tag: WS_METHODS.projectTriggersListRuns,
  }),
};
