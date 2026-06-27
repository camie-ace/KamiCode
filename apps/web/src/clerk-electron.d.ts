declare module "@clerk/electron/passkeys" {
  export const passkeys: unknown;
}

declare module "@clerk/electron/react" {
  import type { PropsWithChildren, ReactElement } from "react";

  export function ClerkProvider(
    props: PropsWithChildren<{
      publishableKey: string;
      passkeys?: unknown;
    }>,
  ): ReactElement;
}
