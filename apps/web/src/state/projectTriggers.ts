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
  listRuns: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project-triggers:list-runs",
    tag: WS_METHODS.projectTriggersListRuns,
  }),
};
