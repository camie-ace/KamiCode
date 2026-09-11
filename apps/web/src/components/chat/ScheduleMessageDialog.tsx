import { CalendarClockIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  defaultScheduledMessageInputValue,
  resolveRecurringMessageSchedule,
  resolveScheduledMessageInstant,
  type ScheduledMessageRepeat,
  type ScheduledMessageSubmission,
  toLocalDateTimeInputValue,
} from "./scheduleMessage";

export function ScheduleMessageDialog(props: {
  readonly open: boolean;
  readonly shortcutLabel?: string | null;
  readonly allowRecurring?: boolean;
  readonly recurringUnavailableReason?: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSchedule: (submission: ScheduledMessageSubmission) => void;
}) {
  const {
    open,
    shortcutLabel,
    allowRecurring = true,
    recurringUnavailableReason = null,
    onOpenChange,
    onSchedule,
  } = props;
  const [localDateTime, setLocalDateTime] = useState(() => defaultScheduledMessageInputValue());
  const [repeat, setRepeat] = useState<ScheduledMessageRepeat>("never");
  const [customExpression, setCustomExpression] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  useEffect(() => {
    if (!open) return;
    setLocalDateTime(defaultScheduledMessageInputValue());
    setRepeat("never");
    setCustomExpression("");
    setError(null);
  }, [open]);

  const submit = () => {
    const result = resolveScheduledMessageInstant(localDateTime);
    if (result.error !== null || result.scheduledFor === null) {
      setError(result.error ?? "Choose a valid date and time.");
      return;
    }
    const recurrence = resolveRecurringMessageSchedule({
      localDateTime,
      repeat: allowRecurring ? repeat : "never",
      customExpression,
      timezone: timeZone,
    });
    if (recurrence.error !== null) {
      setError(recurrence.error);
      return;
    }
    onSchedule({ scheduledFor: result.scheduledFor, recurrence: recurrence.schedule });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <div className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-muted/60">
            <CalendarClockIcon aria-hidden className="size-4.5 text-muted-foreground" />
          </div>
          <DialogTitle>Schedule message</DialogTitle>
          <DialogDescription>
            {allowRecurring && repeat !== "never"
              ? "Each occurrence enters this thread's normal queue. If the thread is busy, drag it into the priority order you want."
              : "The message becomes ready at the selected time. If this thread is busy then, it waits in the queue."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel scrollFade={false}>
          <label className="grid gap-2 text-sm font-medium" htmlFor="scheduled-message-time">
            Send this message on
            <Input
              id="scheduled-message-time"
              nativeInput
              type="datetime-local"
              min={toLocalDateTimeInputValue(new Date(Date.now() + 60_000))}
              value={localDateTime}
              onChange={(event) => {
                setLocalDateTime(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              aria-invalid={error !== null}
            />
          </label>
          <label className="mt-4 grid gap-2 text-sm font-medium" htmlFor="scheduled-message-repeat">
            Repeat
            <select
              id="scheduled-message-repeat"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/24 disabled:opacity-50"
              value={allowRecurring ? repeat : "never"}
              disabled={!allowRecurring}
              onChange={(event) => {
                setRepeat(event.currentTarget.value as ScheduledMessageRepeat);
                setError(null);
              }}
            >
              <option value="never">Never</option>
              <option value="daily">Daily</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom cron</option>
            </select>
          </label>
          {!allowRecurring ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {recurringUnavailableReason ??
                "Start this thread once before adding a recurring schedule."}
            </p>
          ) : null}
          {allowRecurring && repeat === "custom" ? (
            <label className="mt-4 grid gap-2 text-sm font-medium" htmlFor="scheduled-message-cron">
              Cron expression
              <Input
                id="scheduled-message-cron"
                nativeInput
                value={customExpression}
                placeholder="0 9 * * 1-5"
                onChange={(event) => {
                  setCustomExpression(event.currentTarget.value);
                  setError(null);
                }}
              />
            </label>
          ) : null}
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{timeZone}</span>
            {shortcutLabel ? <span>Open with {shortcutLabel}</span> : null}
          </div>
          {error ? (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            Schedule
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
