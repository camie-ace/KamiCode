import { describe, expect, it } from "vite-plus/test";

import {
  defaultScheduledMessageInputValue,
  resolveRecurringMessageSchedule,
  resolveScheduledMessageInstant,
  toLocalDateTimeInputValue,
} from "./scheduleMessage";

describe("scheduled message date handling", () => {
  it("formats datetime-local values in local time", () => {
    const date = new Date(2026, 8, 10, 22, 38, 45);
    expect(toLocalDateTimeInputValue(date)).toBe("2026-09-10T22:38");
  });

  it("defaults to at least one hour ahead on a five-minute boundary", () => {
    const now = new Date(2026, 8, 10, 22, 38, 45);
    const value = defaultScheduledMessageInputValue(now);
    expect(value).toBe("2026-09-10T23:40");
  });

  it("rejects past values and returns a portable UTC instant for future values", () => {
    const localFuture = "2026-09-10T23:40";
    const futureMs = new Date(localFuture).getTime();
    expect(resolveScheduledMessageInstant(localFuture, futureMs - 1_000)).toEqual({
      scheduledFor: new Date(localFuture).toISOString(),
      error: null,
    });
    expect(resolveScheduledMessageInstant(localFuture, futureMs)).toEqual({
      scheduledFor: null,
      error: "Choose a time in the future.",
    });
  });

  it("derives repeat cron expressions from the selected local time", () => {
    const localDateTime = "2026-09-10T22:38";
    expect(
      resolveRecurringMessageSchedule({
        localDateTime,
        repeat: "weekly",
        customExpression: "",
        timezone: "Africa/Lagos",
      }),
    ).toEqual({
      schedule: {
        expression: `38 22 * * ${new Date(localDateTime).getDay()}`,
        timezone: "Africa/Lagos",
        repeat: "weekly",
      },
      error: null,
    });
    expect(
      resolveRecurringMessageSchedule({
        localDateTime,
        repeat: "weekdays",
        customExpression: "",
        timezone: "Africa/Lagos",
      }).schedule?.expression,
    ).toBe("38 22 * * 1-5");
  });

  it("validates custom repeat expressions", () => {
    expect(
      resolveRecurringMessageSchedule({
        localDateTime: "2026-09-10T22:38",
        repeat: "custom",
        customExpression: "",
        timezone: "UTC",
      }).error,
    ).toBe("Enter a cron expression for the custom repeat.");
    expect(
      resolveRecurringMessageSchedule({
        localDateTime: "2026-09-10T22:38",
        repeat: "custom",
        customExpression: "0 38 22 * * 1-5 2026",
        timezone: "UTC",
      }).error,
    ).toBe("Enter a valid cron expression.");
  });
});
