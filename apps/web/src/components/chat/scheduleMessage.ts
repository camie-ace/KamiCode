const padDatePart = (value: number): string => String(value).padStart(2, "0");

export type ScheduledMessageRepeat =
  | "never"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "custom";

export interface RecurringMessageSchedule {
  readonly expression: string;
  readonly timezone: string;
  readonly repeat: Exclude<ScheduledMessageRepeat, "never">;
}

export interface ScheduledMessageSubmission {
  readonly scheduledFor: string;
  readonly recurrence: RecurringMessageSchedule | null;
}

export function toLocalDateTimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate(),
  )}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

export function defaultScheduledMessageInputValue(now: Date = new Date()): string {
  const next = new Date(now.getTime() + 60 * 60 * 1_000);
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil(next.getMinutes() / 5) * 5);
  return toLocalDateTimeInputValue(next);
}

export function resolveScheduledMessageInstant(
  localDateTime: string,
  nowMs: number = Date.now(),
): { readonly scheduledFor: string | null; readonly error: string | null } {
  if (localDateTime.trim().length === 0) {
    return { scheduledFor: null, error: "Choose a date and time." };
  }
  const scheduledAt = new Date(localDateTime);
  if (!Number.isFinite(scheduledAt.getTime())) {
    return { scheduledFor: null, error: "Choose a valid date and time." };
  }
  if (scheduledAt.getTime() <= nowMs) {
    return { scheduledFor: null, error: "Choose a time in the future." };
  }
  return { scheduledFor: scheduledAt.toISOString(), error: null };
}

export function resolveRecurringMessageSchedule(input: {
  readonly localDateTime: string;
  readonly repeat: ScheduledMessageRepeat;
  readonly customExpression: string;
  readonly timezone: string;
}): { readonly schedule: RecurringMessageSchedule | null; readonly error: string | null } {
  if (input.repeat === "never") return { schedule: null, error: null };

  const firstRun = new Date(input.localDateTime);
  if (!Number.isFinite(firstRun.getTime())) {
    return { schedule: null, error: "Choose a valid date and time." };
  }
  const timezone = input.timezone.trim();
  if (!timezone) return { schedule: null, error: "A timezone is required for repeats." };

  const minute = firstRun.getMinutes();
  const hour = firstRun.getHours();
  const expression =
    input.repeat === "daily"
      ? `${minute} ${hour} * * *`
      : input.repeat === "weekdays"
        ? `${minute} ${hour} * * 1-5`
        : input.repeat === "weekly"
          ? `${minute} ${hour} * * ${firstRun.getDay()}`
          : input.repeat === "monthly"
            ? `${minute} ${hour} ${firstRun.getDate()} * *`
            : input.customExpression.trim();

  if (!expression) {
    return { schedule: null, error: "Enter a cron expression for the custom repeat." };
  }
  const fields = expression.split(/\s+/);
  if (fields.length < 5 || fields.length > 6) {
    return { schedule: null, error: "Enter a valid cron expression." };
  }

  return {
    schedule: { expression, timezone, repeat: input.repeat },
    error: null,
  };
}
