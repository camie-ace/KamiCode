import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { PreparedConnection } from "../connection/model.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";
export const fetchEnvironmentThreadSnapshot = Effect.fn("fetchEnvironmentThreadSnapshot")(
  function* (input: {
    readonly prepared: PreparedConnection;
    readonly threadId: ThreadId;
    readonly signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>;
    readonly remoteAuthorization: Option.Option<
      RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]
    >;
  }) {
    const endpoint = { params: { threadId: input.threadId } };
    return yield* executeAuthenticatedEnvironmentHttpRequest({
      ...input,
      group: "orchestration",
      method: "GET",
      url: (urls) => urls.threadSnapshot(endpoint),
      timeoutMs: 30_000,
      request: ({ client, headers }) =>
        client.threadSnapshot({ ...endpoint, headers: withOrchestrationProtocolHeader(headers) }),
    });
  },
);
