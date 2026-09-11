const padDatePart = (value: number): string => String(value).padStart(2, "0");

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
