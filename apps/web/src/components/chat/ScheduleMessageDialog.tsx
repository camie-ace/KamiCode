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
  resolveScheduledMessageInstant,
  toLocalDateTimeInputValue,
} from "./scheduleMessage";

export function ScheduleMessageDialog(props: {
  readonly open: boolean;
  readonly shortcutLabel?: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSchedule: (scheduledFor: string) => void;
}) {
  const { open, shortcutLabel, onOpenChange, onSchedule } = props;
  const [localDateTime, setLocalDateTime] = useState(() => defaultScheduledMessageInputValue());
  const [error, setError] = useState<string | null>(null);
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time",
    [],
  );

  useEffect(() => {
    if (!open) return;
    setLocalDateTime(defaultScheduledMessageInputValue());
    setError(null);
  }, [open]);

  const submit = () => {
    const result = resolveScheduledMessageInstant(localDateTime);
    if (result.error !== null || result.scheduledFor === null) {
      setError(result.error ?? "Choose a valid date and time.");
      return;
    }
    onSchedule(result.scheduledFor);
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
            The message will become ready at the selected time. If this thread is busy then, it will
            wait in the queue.
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
