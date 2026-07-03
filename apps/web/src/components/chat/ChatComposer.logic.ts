export interface ComposerPromptEditorDisabledInput {
  readonly isComposerApprovalState: boolean;
  readonly isConnecting: boolean;
  readonly isEnvironmentUnavailable: boolean;
  readonly hasActivePendingProgress: boolean;
}

export function shouldDisableComposerPromptEditor({
  isComposerApprovalState,
}: ComposerPromptEditorDisabledInput): boolean {
  // Draft editing must stay available while reconnecting; send remains blocked elsewhere.
  return isComposerApprovalState;
}
