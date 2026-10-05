import { isValidDayKey } from "./planu";

export function formatDayKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayKeyFromMs(atMs: number): string {
  return formatDayKeyLocal(new Date(atMs));
}

export function dayKeyToUtcMs(dayKey: string): number {
  return Date.parse(dayKey + "T00:00:00Z");
}

export function diffDays(aDayKey: string, bDayKey: string): number {
  return Math.round((dayKeyToUtcMs(bDayKey) - dayKeyToUtcMs(aDayKey)) / 86400000);
}

export function weekdayOfDayKey(dayKey: string): number {
  return new Date(dayKeyToUtcMs(dayKey)).getUTCDay();
}

function parseWeeklyDays(repeatRule: string): number[] {
  // weekly:mon,thu -> [1,4]
  const map: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const rest = repeatRule.slice("weekly:".length);
  return rest.split(",").map((d) => map[d.trim().toLowerCase()] ?? -1).filter((n) => n >= 0);
}

export function isNominatedDay(repeatRule: string | undefined, dayKey: string): boolean {
  if (!repeatRule || repeatRule === "daily") return true;
  const wd = weekdayOfDayKey(dayKey);
  if (repeatRule === "weekdays") return wd >= 1 && wd <= 5;
  if (repeatRule.startsWith("weekly:")) {
    return parseWeeklyDays(repeatRule).includes(wd);
  }
  return true;
}

export function shouldCarryStreak(
  repeatRule: string | undefined,
  prevDayKey: string | undefined,
  newDayKey: string
): boolean {
  if (!prevDayKey) return false;
  if (!isValidDayKey(prevDayKey) || !isValidDayKey(newDayKey)) return false;
  const diff = diffDays(prevDayKey, newDayKey);
  if (diff <= 0) return true;
  const rule = repeatRule ?? "daily";
  if (rule === "daily") return diff === 1;
  if (rule === "weekdays") {
    const prevWd = weekdayOfDayKey(prevDayKey);
    const newWd = weekdayOfDayKey(newDayKey);
    // Fri -> Mon carries across weekend
    if (prevWd === 5 && newWd === 1 && diff === 3) return true;
    // Weekend check-ins never break
    if (newWd === 0 || newWd === 6) return true;
    if (prevWd === 0 || prevWd === 6) return true;
    return diff === 1;
  }
  if (rule.startsWith("weekly:")) {
    const nominated = parseWeeklyDays(rule);
    if (nominated.length === 0) return diff === 1;
    if (!isNominatedDay(rule, newDayKey)) return true;
    // Count nominated days strictly between prev and new
    let missed = 0;
    for (let i = 1; i < diff; i++) {
      const midMs = dayKeyToUtcMs(prevDayKey) + i * 86400000;
      const midWd = new Date(midMs).getUTCDay();
      if (nominated.includes(midWd)) missed++;
    }
    return missed === 0;
  }
  return diff === 1;
}
