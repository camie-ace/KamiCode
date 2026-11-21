import { APP_DISPLAY_NAME } from "../../branding";
import { namedClipboardTarget } from "../../hooks/useCopyToClipboard";
import { Alert, AlertDescription } from "../ui/alert";
import type { AuthSessionState } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CheckIcon, CopyIcon } from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import React, { useEffect, useEffectEvent, useRef, useState } from "react";

import { connectPairing } from "../../connection/onboarding";
import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  startGitHubUserLogin,
  submitServerAuthCredential,
} from "../../environments/primary";
import { readHostedPairingRequest } from "../../hostedPairing";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { useAtomCommand } from "../../state/use-atom-command";
import { m, type MessageResolver } from "../../i18n/messages";

export function PairingPendingSurface() {
  const gt = useGT();
  return (
    <StandalonePage>
      <StandalonePageHeader
        title={gt("Pairing with this environment")}
        description={gt("Validating the pairing link and preparing your session.")}
      />
    </StandalonePage>
  );
}

export function PairingRouteSurface({
  auth,
  initialErrorMessage,
  onAuthenticated,
}: {
  auth: AuthSessionState["auth"];
  initialErrorMessage?: string;
  onAuthenticated: () => Promise<void> | void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const [autoPairToken] = useState(peekPairingTokenFromUrl);
  const [credential, setCredential] = useState(autoPairToken ?? "");
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);

  const submitCredential = async (nextCredential: string) => {
    setIsSubmitting(true);
    setErrorMessage("");

    await (async () => {
      try {
        await submitServerAuthCredential(nextCredential);
        await onAuthenticated();
      } catch (error) {
        setErrorMessage(errorMessageFromUnknown(error));
      }
    })().finally(() => {
      setIsSubmitting(false);
    });
  };

  const handleSubmit = async (event?: React.SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault();
    await submitCredential(credential);
  };

  const autoSubmit = useEffectEvent((token: string) => {
    void submitCredential(token);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- strips the pairing token from the URL and submits it once when the route carries one
  useEffect(() => {
    if (!autoPairToken || autoSubmitAttemptedRef.current) {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    autoSubmit(autoPairToken);
  }, [autoPairToken]);

  return (
    <StandalonePage>
      <StandalonePageHeader
        title={gt("Pair with this environment")}
        description={describeAuthGate(auth.bootstrapMethods, messages)}
      />

      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="pairing-token">
            <T>Pairing token</T>
          </label>
          <Input
            id="pairing-token"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            disabled={isSubmitting}
            nativeInput
            onChange={(event) => setCredential(event.currentTarget.value)}
            placeholder={gt("Paste a one-time token or pairing secret")}
            spellCheck={false}
            value={credential}
          />
        </div>

        {errorMessage ? (
          <Alert variant="error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={isSubmitting} size="sm" type="submit">
            {isSubmitting ? gt("Pairing...") : gt("Continue")}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            <T>Reload app</T>
          </Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {describeSupportedMethods(auth.bootstrapMethods, messages)}
      </div>
    </StandalonePage>
  );
}

export function HostedPairingRouteSurface() {
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  const [request] = useState(readHostedPairingRequest);
  const gt = useGT();
  const [status, setStatus] = useState<"pairing" | "paired" | "error">(
    request ? "pairing" : "error",
  );
  const [message, setMessage] = useState(() =>
    request
      ? m(msg("Connecting to this backend."))
      : m(msg("This pairing link is missing its backend host or token.")),
  );
  const [canRetry, setCanRetry] = useState(false);
  const submitAttemptedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = async () => {
    if (!request) {
      setStatus("error");
      setMessage(gt("This pairing link is missing its backend host or token."));
      setCanRetry(false);
      return;
    }

    if (tokenSubmittedRef.current) {
      setStatus("error");
      setMessage(
        gt("This one-time pairing token was already submitted. Request a new pairing link."),
      );
      setCanRetry(false);
      return;
    }

    setStatus("pairing");
    setMessage(gt("Connecting to this backend."));
    setCanRetry(false);
    tokenSubmittedRef.current = true;

    const result = await connectPairingEnvironment({
      host: request.host,
      pairingCode: request.token,
    });
    if (result._tag === "Success") {
      setStatus("paired");
      setMessage(
        request.label
          ? gt("{environment} is saved in this browser.", { environment: request.label })
          : gt("The environment is saved in this browser."),
      );
      return;
    }

    tokenSubmittedRef.current = false;
    setStatus("error");
    setCanRetry(true);
    setMessage(
      gt(
        "{error} If the backend accepted this one-time token, request a new pairing link before retrying.",
        { error: errorMessageFromUnknown(squashAtomCommandFailure(result)) },
      ),
    );
  };

  const submitOnMount = useEffectEvent(() => {
    void submitHostedPairingRequest();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- strips the pairing token from the URL and submits the hosted pairing request once on mount
  useEffect(() => {
    if (submitAttemptedRef.current) {
      return;
    }
    submitAttemptedRef.current = true;

    stripPairingTokenFromUrl();
    submitOnMount();
  }, []);

  return (
    <StandalonePage>
      <StandalonePageHeader
        title={
          status === "paired"
            ? gt("Backend paired")
            : status === "error"
              ? gt("Pairing failed")
              : gt("Pairing backend")
        }
        description={message}
      />

      {request ? (
        <div className="mt-5 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          <T>
            Host:{" "}
            <span className="font-mono text-foreground/80">
              <Var>{request.host}</Var>
            </span>
          </T>
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="error" className="mt-5">
          <AlertDescription>
            <T>
              Verify the backend is reachable from this browser, supports CORS for hosted clients,
              and is served over HTTPS when opening this page from HTTPS.
            </T>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {status === "pairing" ? (
          <Button disabled size="sm">
            <T>Pairing...</T>
          </Button>
        ) : canRetry ? (
          <Button size="sm" onClick={() => void submitHostedPairingRequest()}>
            <T>Try again</T>
          </Button>
        ) : null}
        {status === "paired" ? (
          <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
            <T>Open app</T>
          </Button>
        ) : null}
      </div>
    </StandalonePage>
  );
}

export function GitHubLoginSurface({ errorMessage }: { errorMessage?: string }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginError, setLoginError] = useState(errorMessage ?? "");
  const [deviceCode, setDeviceCode] = useState<{
    readonly userCode: string;
    readonly verificationUri: string;
  } | null>(null);

  const handleLogin = async () => {
    setIsSubmitting(true);
    setLoginError("");
    setDeviceCode(null);

    try {
      await startGitHubUserLogin({
        onDeviceCode: (input) => setDeviceCode(input),
      });
    } catch (error) {
      setLoginError(errorMessageFromUnknown(error));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-profile-glow" />
        <div className="absolute inset-y-0 left-0 w-72 bg-profile-highlight" />
        <div className="absolute inset-0 bg-profile-surface" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-2xs font-semibold tracking-brand text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Sign in with GitHub
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          GitHub login is required before using shared KamiCode sessions on this server.
        </p>

        {deviceCode ? (
          <GitHubDeviceCode {...deviceCode} onCopyError={(error) => setLoginError(error.message)} />
        ) : null}

        {loginError ? (
          <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive">
            {loginError}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button disabled={isSubmitting} onClick={() => void handleLogin()} size="sm">
            {isSubmitting ? "Opening GitHub..." : "Continue with GitHub"}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            Reload app
          </Button>
        </div>
      </section>
    </div>
  );
}

export function GitHubDeviceCode({
  userCode,
  verificationUri,
  onCopyError,
}: {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly onCopyError?: (error: Error) => void;
}) {
  const { copyToClipboard: copyDeviceCode, isCopied } = useCopyToClipboard({
    target: namedClipboardTarget("GitHub device code"),
    onError: (error) => onCopyError?.(error),
  });

  return (
    <div className="mt-5 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-sm leading-relaxed">
      <p className="text-muted-foreground">Enter this code in the GitHub browser window.</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="font-mono text-lg font-semibold tracking-label">{userCode}</p>
        <Button
          aria-label={isCopied ? "GitHub device code copied" : "Copy GitHub device code"}
          onClick={() => copyDeviceCode(userCode)}
          size="icon-sm"
          title={isCopied ? "Copied" : "Copy code"}
          variant="ghost"
        >
          {isCopied ? (
            <CheckIcon className="size-4 text-primary" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </Button>
      </div>
      <a
        className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline"
        href={verificationUri}
        rel="noreferrer"
        target="_blank"
      >
        Open GitHub device activation
      </a>
    </div>
  );
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return m(msg("Authentication failed."));
}

function describeAuthGate(
  bootstrapMethods: ReadonlyArray<string>,
  resolve: MessageResolver,
): string {
  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return resolve(
      msg("This environment expects a trusted pairing credential before the app can connect."),
    );
  }

  return resolve(msg("Enter a pairing token to start a session with this environment."));
}

function describeSupportedMethods(
  bootstrapMethods: ReadonlyArray<string>,
  resolve: MessageResolver,
): string {
  if (
    bootstrapMethods.includes("desktop-bootstrap") &&
    bootstrapMethods.includes("one-time-token")
  ) {
    return resolve(
      msg(
        "Desktop-managed pairing and one-time pairing tokens are both accepted for this environment.",
      ),
    );
  }

  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return resolve(
      msg(
        "This environment is desktop-managed. Open it from the desktop app or paste a bootstrap credential if one was issued explicitly.",
      ),
    );
  }

  return resolve(
    msg(
      "This environment accepts one-time pairing tokens. Pairing links can open this page directly, or you can paste the token here.",
    ),
  );
}
