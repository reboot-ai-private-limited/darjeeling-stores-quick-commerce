/** Indian Standard Time is a fixed +05:30 offset (no daylight saving), so day boundaries are simple arithmetic. */
const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

export const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** The Indian calendar day (YYYY-MM-DD) of an instant. */
export function istDay(at: Date): string { return new Date(at.getTime() + IST_MS).toISOString().slice(0, 10); }
/** The instant an Indian day starts. */
export function dayStart(day: string): Date { return new Date(Date.parse(`${day}T00:00:00Z`) - IST_MS); }
export function addDays(day: string, days: number): string { return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10); }

export const MAX_RANGE_DAYS = 366;
export interface DayRange { from: string; to: string; start: Date; end: Date }

/** `from` and `to` are inclusive Indian days; the default is the last seven days including today. Returns an error message instead of a range when invalid. */
export function dayRange(input: { from?: string | undefined; to?: string | undefined }, now: Date): DayRange | { error: string } {
  const to = input.to ?? istDay(now);
  const from = input.from ?? addDays(to, -6);
  if (!isDay(from) || !isDay(to)) return { error: "Use dates like 2026-11-05" };
  if (from > to) return { error: "from must not be after to" };
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS >= MAX_RANGE_DAYS) return { error: `Ask for at most ${MAX_RANGE_DAYS} days at a time` };
  return { from, to, start: dayStart(from), end: dayStart(addDays(to, 1)) };
}

export interface ReportTable { columns: string[]; rows: (string | number | null)[][] }
export interface ReportParams { range: DayRange; warehouseIds: readonly string[] | null; groupBy: string }
export interface ReportDef {
  name: string; title: string; groupBy: readonly string[]; defaultGroupBy: string;
  run(params: ReportParams): Promise<ReportTable>;
}

/** A spreadsheet runs text starting with = + - or @ as a formula, so such text is prefixed to keep it plain. */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function toCsv(table: ReportTable): string {
  return [table.columns, ...table.rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Whole paise, rounded half up; zero when there is nothing to divide by. */
export const average = (sum: number, count: number) => (count > 0 ? Math.round(sum / count) : 0);
