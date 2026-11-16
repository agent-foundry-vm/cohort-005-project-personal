import { describe, expect, it } from "vitest";
import { daysSince, formatRelativeTime } from "./utils";

const NOW = new Date("2027-02-18T12:00:00Z");

describe("formatRelativeTime", () => {
  it("says just now under a minute", () => {
    expect(formatRelativeTime("2027-02-18T11:59:30Z", NOW)).toBe("just now");
  });

  it("counts minutes, hours and days", () => {
    expect(formatRelativeTime("2027-02-18T11:55:00Z", NOW)).toBe("5m ago");
    expect(formatRelativeTime("2027-02-18T09:00:00Z", NOW)).toBe("3h ago");
    expect(formatRelativeTime("2027-02-16T12:00:00Z", NOW)).toBe("2d ago");
  });

  it("returns an empty string for a date it cannot read", () => {
    expect(formatRelativeTime("not a date", NOW)).toBe("");
  });
});

describe("daysSince", () => {
  it("clamps a future date to zero", () => {
    expect(daysSince("2027-03-01T00:00:00Z", NOW)).toBe(0);
  });

  it("counts whole days", () => {
    expect(daysSince("2027-02-15T11:00:00Z", NOW)).toBe(3);
  });
});
