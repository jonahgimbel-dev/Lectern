import { addDaysIso, monthStartIso, todayIso } from "@/lib/format";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthCells(anchor = todayIso()): string[] {
  const start = monthStartIso(anchor);
  const [year, month] = start.split("-").map(Number);
  const first = new Date(year ?? 0, (month ?? 1) - 1, 1);
  const pad = first.getDay();
  const daysInMonth = new Date(year ?? 0, month ?? 1, 0).getDate();
  const cells: string[] = [];
  for (let i = 0; i < pad; i += 1) cells.push("");
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(addDaysIso(start, day - 1));
  }
  while (cells.length % 7 !== 0) cells.push("");
  return cells;
}

export function shiftMonth(iso: string, delta: number): string {
  const [year, month] = iso.split("-").map(Number);
  const next = new Date(year ?? 0, (month ?? 1) - 1 + delta, 1);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}
