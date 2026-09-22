import { describe, it, expect } from "vitest";
import type { TrainingWeek } from "../../src/schema/training-plan.js";
import {
  getWeekMonthKey,
  getMonthStarts,
  formatMonthFr,
  formatMonthShortFr,
  findWeekForDate,
} from "../../src/viewer/lib/utils.js";

function week(weekNumber: number, startDate: string, endDate: string): TrainingWeek {
  return { weekNumber, startDate, endDate, days: [] } as unknown as TrainingWeek;
}

const weeks = [
  week(1, "2026-09-21", "2026-09-27"),
  week(2, "2026-09-28", "2026-10-04"), // straddles Sep/Oct: belongs to September
  week(3, "2026-10-05", "2026-10-11"),
  week(4, "2026-12-28", "2027-01-03"), // straddles the year
  week(5, "2027-01-04", "2027-01-10"),
];

describe("Month utilities", () => {
  it("uses the month of the week's first day", () => {
    expect(getWeekMonthKey(weeks[1]!)).toBe("2026-09");
    expect(getWeekMonthKey(weeks[3]!)).toBe("2026-12");
  });

  it("lists the first week of each month", () => {
    expect(getMonthStarts(weeks)).toEqual([
      { monthKey: "2026-09", weekNumber: 1 },
      { monthKey: "2026-10", weekNumber: 3 },
      { monthKey: "2026-12", weekNumber: 4 },
      { monthKey: "2027-01", weekNumber: 5 },
    ]);
  });

  it("formats month names in French", () => {
    expect(formatMonthFr("2026-11")).toBe("Novembre 2026");
    expect(formatMonthFr("2027-02")).toBe("Février 2027");
    expect(formatMonthShortFr("2026-12")).toBe("déc");
    expect(formatMonthShortFr("2027-03")).toBe("mars");
  });

  it("finds the week containing a date, clamped to the plan bounds", () => {
    expect(findWeekForDate(weeks, "2026-10-02")?.weekNumber).toBe(2);
    expect(findWeekForDate(weeks, "2027-01-03")?.weekNumber).toBe(4);
    expect(findWeekForDate(weeks, "2026-01-01")?.weekNumber).toBe(1);
    expect(findWeekForDate(weeks, "2028-01-01")?.weekNumber).toBe(5);
    expect(findWeekForDate([], "2026-10-02")).toBeUndefined();
  });
});
