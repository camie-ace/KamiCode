import { ProviderInstanceId } from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { EnvironmentAuth } from "../auth/EnvironmentAuth.ts";
import { createProjectTriggerDynamicToolRunner } from "../projectTriggers/dynamicTools.ts";
import {
  ProjectTriggerId,
  ProjectTriggerRepository,
} from "../projectTriggers/Services/ProjectTriggerRepository.ts";
import { ProjectTriggerService } from "../projectTriggers/Services/ProjectTriggerService.ts";

/** Capture the same server services for each provider instance, without a provider-specific store. */
export const makeKamiRuntimeTools = Effect.fn("makeKamiRuntimeTools")(
  (instanceId: ProviderInstanceId) =>
    Effect.gen(function* () {
      const random = yield* SecureRandom.SecureRandom;
      const auth = yield* Effect.serviceOption(EnvironmentAuth);
      const service = yield* Effect.serviceOption(ProjectTriggerService);
      const repository = yield* Effect.serviceOption(ProjectTriggerRepository);
      return {
        ...(Option.isNone(auth)
          ? {}
          : {
              issueTestHarnessPairingCredential: () =>
                auth.value.issuePairingCredential({ label: "KamiCode test harness" }).pipe(
                  Effect.map((issued) => issued.credential),
                  Effect.mapError((cause) => cause.message),
                ),
            }),
        ...(Option.isNone(service) || Option.isNone(repository)
          ? {}
          : {
              projectTriggerDynamicToolRunner: createProjectTriggerDynamicToolRunner({
                service: service.value,
                repository: repository.value,
                defaultProviderInstanceId: instanceId,
                makeTriggerId: random.uuidV4().pipe(
                  Effect.orDie,
                  Effect.map((id) => ProjectTriggerId.make(`trigger:${id}`)),
                ),
              }),
            }),
      };
    }),
);
