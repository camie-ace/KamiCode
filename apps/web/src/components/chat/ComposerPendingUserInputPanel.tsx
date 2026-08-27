import { type ApprovalRequestId } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import {
  CheckIcon,
  ChevronDownIcon,
  Clock3Icon,
  KeyRoundIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
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
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionLabel: string;
  } | null>(null);
  // Collapsing hides everything but the header so a tall prompt stops covering
  // the thread the user is trying to read. Scoped to a single question: the card
  // is keyed by request id so the next prompt starts expanded, and storing the
  // collapsed question's id (rather than a bare flag) reopens the card when the
  // prompt advances to its next question, which can happen without a click —
  // sending from the composer advances the active question.
  const [collapsedQuestionId, setCollapsedQuestionId] = useState<string | null>(null);
  const isCollapsed = collapsedQuestionId !== null && collapsedQuestionId === activeQuestion?.id;

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    if (!activeQuestion || activeQuestion.multiSelect || !optimisticSingleSelect) {
      return;
    }
    if (optimisticSingleSelect.questionId !== activeQuestion.id) {
      setOptimisticSingleSelect(null);
      return;
    }
    if (
      progress.customAnswer.trim().length === 0 &&
      progress.selectedOptionLabels.includes(optimisticSingleSelect.optionLabel)
    ) {
      setOptimisticSingleSelect(null);
    }
  }, [
    activeQuestion,
    optimisticSingleSelect,
    progress.customAnswer,
    progress.selectedOptionLabels,
  ]);

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const handleOptionSelection = useCallback(
    (questionId: string, optionLabel: string) => {
      if (activeQuestion?.multiSelect) {
        onToggleOption(questionId, optionLabel);
        return;
      }
      setOptimisticSingleSelect({ questionId, optionLabel });
      onToggleOption(questionId, optionLabel);
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        onAdvanceRef.current();
      }, 200);
    },
    [activeQuestion, onToggleOption],
  );

  // Keyboard shortcut: number keys 1-9 select corresponding options when focus is
  // outside editable fields. Multi-select prompts toggle options in place; single-
  // select prompts keep the existing auto-advance behavior. Collapsed prompts opt
  // out, since the numbers they refer to are not on screen.
  useEffect(() => {
    if (!activeQuestion || isResponding || isCollapsed) return;
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
  }, [activeQuestion, handleOptionSelection, isCollapsed, isResponding]);

  if (!activeQuestion) {
    return null;
  }

  const isAuthPrompt = isAuthStrategyQuestion(activeQuestion);
  const customAnswerActive = progress.customAnswer.trim().length > 0;

  return (
    <Collapsible
      className={cn("py-2", isAuthPrompt && "bg-amber-500/5")}
      open={!isCollapsed}
      onOpenChange={(open) => {
        setCollapsedQuestionId(open ? null : activeQuestion.id);
      }}
    >
      {/* The trigger's wrapper is inset less than the card's text column, and
          the trigger pays the difference back as padding: the hover background
          and focus ring bleed 10px past that column on both sides, while the
          header label and the chevron still line up with the left and right
          edges of the question text below. The negative block margin keeps the
          taller hit area from pushing the panel down. */}
      <div className="flex items-center gap-1 px-1 sm:px-2">
        <CollapsibleTrigger
          title={
            isCollapsed ? "Show the question and its options" : "Hide the question and its options"
          }
          data-pending-user-input-toggle={isCollapsed ? "collapsed" : "expanded"}
          className="group -my-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors duration-150 hover:bg-muted/35 focus-visible:ring-1 focus-visible:ring-primary/25"
        >
          {isAuthPrompt ? (
            <>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/10 text-amber-500">
                <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
              </span>
              <span className="text-[11px] font-semibold tracking-widest text-amber-500/85 uppercase">
                Test Auth
              </span>
            </>
          ) : (
            <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground/85">
              {activeQuestion.header}
            </span>
          )}
          {prompt.questions.length > 1 ? (
            <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
              {questionIndex + 1}/{prompt.questions.length}
            </span>
          ) : null}
          {/* Collapsed, the header is otherwise just a section label and a
              counter, so the question itself is echoed here as a one-line
              reminder of what is being asked. */}
          {isCollapsed ? (
            <span className="min-w-0 flex-1 truncate text-secondary-label text-xs">
              {activeQuestion.question}
            </span>
          ) : null}
          {/* The chevron points at the body: down while it is open below the
              header, up while it is collapsed into it. */}
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "ml-auto size-3.5 shrink-0 text-secondary-label transition-transform duration-150 group-hover:text-foreground",
              isCollapsed && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
      </div>
      {/* The panel carries the horizontal padding itself: it clips its content
          while the height animates, so the option buttons have to sit inside
          that padding or their focus rings get shaved off at the edges. */}
      <CollapsiblePanel className="px-3 sm:px-4">
        <div className="pt-2 pb-0.5">
          {isAuthPrompt ? (
            <p className="mb-2 text-xs text-muted-foreground/75">
              The agent needs an authenticated path before it can verify a gated feature.
            </p>
          ) : null}
          <p className="text-sm text-foreground/85">{activeQuestion.question}</p>
          {activeQuestion.multiSelect ? (
            <p className="mt-1 text-secondary-label text-xs">Select one or more options.</p>
          ) : null}
          <div className="mt-2 space-y-0.5">
            {activeQuestion.options.map((option, index) => {
              const isOptimisticallySelected =
                optimisticSingleSelect?.questionId === activeQuestion.id &&
                optimisticSingleSelect.optionLabel === option.label;
              const isSelected =
                isOptimisticallySelected ||
                (!customAnswerActive && progress.selectedOptionLabels.includes(option.label));
              const shortcutKey = index < 9 ? index + 1 : null;
              const className = cn(
                "group flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-primary/25",
                isSelected
                  ? isAuthPrompt
                    ? "border border-amber-500/40 bg-amber-500/10 text-foreground"
                    : "bg-muted/55 text-foreground"
                  : isAuthPrompt
                    ? "border border-amber-500/15 bg-background/60 text-foreground/85 hover:border-amber-500/30 hover:bg-amber-500/8"
                    : "bg-transparent text-foreground/85 hover:bg-muted/30",
                isResponding && "opacity-50 cursor-not-allowed",
                !isResponding && "cursor-pointer",
              );
              const content = (
                <>
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
                  ) : null}
                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{option.label}</span>
                    {option.description && option.description !== option.label ? (
                      <span className="text-secondary-label text-[11px]">{option.description}</span>
                    ) : null}
                  </div>
                  {isSelected ? (
                    <CheckIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        isAuthPrompt ? "text-amber-500" : "text-primary",
                      )}
                    />
                  ) : shortcutKey !== null ? (
                    <kbd
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center text-[10px] font-medium text-muted-foreground tabular-nums",
                      )}
                    >
                      {shortcutKey}
                    </kbd>
                  ) : null}
                </>
              );
              return (
                <button
                  key={`${activeQuestion.id}:${option.label}`}
                  type="button"
                  disabled={isResponding}
                  onClick={() => {
                    handleOptionSelection(activeQuestion.id, option.label);
                  }}
                  className={className}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
});
