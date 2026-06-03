import { type ApprovalRequestId } from "@t3tools/contracts";
import { memo, useEffect, useEffectEvent, useRef } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckIcon, Clock3Icon, KeyRoundIcon, ShieldCheckIcon, UserPlusIcon } from "lucide-react";
import { cn } from "~/lib/utils";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
}

function isAuthStrategyQuestion(question: PendingUserInput["questions"][number]): boolean {
  const id = question.id.toLowerCase();
  const header = question.header.toLowerCase();
  const labels = question.options.map((option) => option.label.toLowerCase());
  return (
    id.includes("auth") ||
    header.includes("auth") ||
    labels.some(
      (label) =>
        label.includes("sign-in credentials") ||
        label.includes("permanent user") ||
        label.includes("temporary user"),
    )
  );
}

function AuthOptionIcon({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  if (normalized.includes("permanent")) {
    return <UserPlusIcon className="size-4" aria-hidden="true" />;
  }
  if (normalized.includes("temporary")) {
    return <Clock3Icon className="size-4" aria-hidden="true" />;
  }
  return <KeyRoundIcon className="size-4" aria-hidden="true" />;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const onAdvanceRef = useRef(onAdvance);

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const handleOptionSelection = useEffectEvent((questionId: string, optionLabel: string) => {
    onToggleOption(questionId, optionLabel);
    if (activeQuestion?.multiSelect) {
      return;
    }
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      onAdvanceRef.current();
    }, 200);
  });

  // Keyboard shortcut: number keys 1-9 select corresponding options when focus is
  // outside editable fields. Multi-select prompts toggle options in place; single-
  // select prompts keep the existing auto-advance behavior.
  useEffect(() => {
    if (!activeQuestion || isResponding) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      handleOptionSelection(activeQuestion.id, option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, isResponding]);

  if (!activeQuestion) {
    return null;
  }

  const isAuthPrompt = isAuthStrategyQuestion(activeQuestion);

  return (
    <div className={cn("px-4 py-3 sm:px-5", isAuthPrompt && "bg-amber-500/5")}>
      {isAuthPrompt ? (
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-500">
            <ShieldCheckIcon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {prompt.questions.length > 1 ? (
                <span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
                  {questionIndex + 1}/{prompt.questions.length}
                </span>
              ) : null}
              <span className="text-[11px] font-semibold tracking-widest text-amber-500/85 uppercase">
                Test Auth
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground/75">
              The agent needs an authenticated path before it can verify a gated feature.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {prompt.questions.length > 1 ? (
              <span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
                {questionIndex + 1}/{prompt.questions.length}
              </span>
            ) : null}
            <span className="text-[11px] font-semibold tracking-widest text-muted-foreground/50 uppercase">
              {activeQuestion.header}
            </span>
          </div>
        </div>
      )}
      <p className="mt-1.5 text-sm text-foreground/90">{activeQuestion.question}</p>
      {activeQuestion.multiSelect ? (
        <p className="mt-1 text-xs text-muted-foreground/65">Select one or more options.</p>
      ) : null}
      <div className="mt-3 space-y-1">
        {activeQuestion.options.map((option, index) => {
          const isSelected = progress.selectedOptionLabels.includes(option.label);
          const shortcutKey = index < 9 ? index + 1 : null;
          return (
            <button
              key={`${activeQuestion.id}:${option.label}`}
              type="button"
              disabled={isResponding}
              onClick={() => handleOptionSelection(activeQuestion.id, option.label)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-150",
                isSelected
                  ? isAuthPrompt
                    ? "border-amber-500/40 bg-amber-500/10 text-foreground"
                    : "border-blue-500/40 bg-blue-500/8 text-foreground"
                  : isAuthPrompt
                    ? "border-amber-500/15 bg-background/60 text-foreground/85 hover:bg-amber-500/8 hover:border-amber-500/30"
                    : "border-transparent bg-muted/20 text-foreground/80 hover:bg-muted/40 hover:border-border/40",
                isResponding && "opacity-50 cursor-not-allowed",
              )}
            >
              {isAuthPrompt ? (
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
                    isSelected
                      ? "bg-amber-500/20 text-amber-500"
                      : "bg-muted/35 text-muted-foreground/65 group-hover:bg-amber-500/12 group-hover:text-amber-500",
                  )}
                >
                  <AuthOptionIcon label={option.label} />
                </span>
              ) : shortcutKey !== null ? (
                <kbd
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded text-[11px] font-medium tabular-nums transition-colors duration-150",
                    isSelected
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-muted/40 text-muted-foreground/50 group-hover:bg-muted/60 group-hover:text-muted-foreground/70",
                  )}
                >
                  {shortcutKey}
                </kbd>
              ) : null}
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{option.label}</span>
                {option.description && option.description !== option.label ? (
                  <span className="ml-2 text-xs text-muted-foreground/50">
                    {option.description}
                  </span>
                ) : null}
              </div>
              {isSelected ? (
                <CheckIcon
                  className={cn(
                    "size-3.5 shrink-0",
                    isAuthPrompt ? "text-amber-500" : "text-blue-400",
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});
