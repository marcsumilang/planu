import type { ExtractTasksResult, RouteCaptureResult } from "./ai";
import type { ItemType } from "./planu";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

function nextWeekdayMs(nowMs: number, targetDow: number): number {
  const d = new Date(nowMs);
  const cur = d.getUTCDay();
  let delta = (targetDow - cur + 7) % 7;
  // If today, schedule today 09:00 UTC if still morning, else next week.
  // Deterministic simple rule: 0 -> 7 (next week) unless we treat today as today.
  if (delta === 0) delta = 0;
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + delta * 86400000;
  return base + 9 * 3600000;
}

function parseDueToken(token: string, nowMs: number): number | undefined {
  const t = token.toLowerCase();
  if (t === "today") {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 18 * 3600000;
  }
  if (t === "tomorrow" || t === "tmr" || t === "tmrw") {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 86400000 + 9 * 3600000;
  }
  if (t === "next-week" || t === "nextweek") {
    const d = new Date(nowMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 7 * 86400000 + 9 * 3600000;
  }
  if (t in WEEKDAYS) return nextWeekdayMs(nowMs, WEEKDAYS[t]);
  const parsed = Date.parse(token);
  if (Number.isFinite(parsed)) return parsed;
  return undefined;
}

export function scrubPII(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]")
    .replace(/\b(sk-[A-Za-z0-9-_]{8,}|xox[bpas]-[A-Za-z0-9-]{8,}|ghp_[A-Za-z0-9]{8,})\b/g, "[redacted-key]");
}

export function extractTasksFromMarkdown(body: string): ExtractTasksResult {
  const tasks: ExtractTasksResult["tasks"] = [];
  const lines = body.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s*\[ \]\s+(.+?)\s*$/);
    if (!m) continue;
    const title = m[1].trim().slice(0, 160);
    if (title) tasks.push({ title, priority: 2 as const });
    if (tasks.length >= 20) break;
  }
  return { tasks };
}

const TYPE_TOKEN = /type\s*:\s*(note|plan|goal|milestone|habit|task|idea)\b/i;
const PROJECT_TOKEN = /@([A-Za-z0-9][A-Za-z0-9\-_]{0,39})/;
const PRIORITY_TOKEN = /!p([123])\b/i;
const DUE_TOKEN = /due\s*:\s*([A-Za-z0-9\-:]+)/i;
const TAG_TOKEN = /#([A-Za-z0-9][A-Za-z0-9\-_]{0,39})/g;

function detectType(raw: string, hasTaskSignals: boolean): { type: ItemType; confidence: number; explicit: boolean } {
  const m = raw.match(TYPE_TOKEN);
  if (m) return { type: m[1].toLowerCase() as ItemType, confidence: 0.95, explicit: true };
  const lower = raw.toLowerCase();
  if (/^(habit|repeat|daily|streak)\b/.test(lower) || lower.includes("every day") || lower.includes("every morning")) {
    return { type: "habit", confidence: 0.8, explicit: false };
  }
  if (/^(goal|objective)\b/.test(lower)) return { type: "goal", confidence: 0.8, explicit: false };
  if (/^(note|doc|memo)\b/.test(lower)) return { type: "note", confidence: 0.75, explicit: false };
  if (hasTaskSignals) return { type: "task", confidence: 0.75, explicit: false };
  if (/\[ \]/.test(raw)) return { type: "task", confidence: 0.7, explicit: false };
  return { type: "idea", confidence: 0.6, explicit: false };
}

export function routeCapture(rawText: string, nowMs: number = Date.now()): RouteCaptureResult {
  const raw = typeof rawText === "string" ? rawText : "";
  const projectMatch = raw.match(PROJECT_TOKEN);
  const priorityMatch = raw.match(PRIORITY_TOKEN);
  const dueMatch = raw.match(DUE_TOKEN);
  const tags: string[] = [];
  const found = raw.match(/#([A-Za-z0-9][A-Za-z0-9\-_]{0,39})/g) ?? [];
  for (const f of found.slice(0, 10)) {
    tags.push(f.slice(1).toLowerCase());
  }
  const hasTaskSignals = Boolean(projectMatch || priorityMatch || dueMatch);

  const { type, confidence } = detectType(raw, hasTaskSignals);
  const priority = priorityMatch ? (Number(priorityMatch[1]) as 1 | 2 | 3) : 2;
  const dueAt = dueMatch ? parseDueToken(dueMatch[1], nowMs) : undefined;
  const projectName = projectMatch ? projectMatch[1] : undefined;

  let title = raw
    .replace(TYPE_TOKEN, "")
    .replace(PROJECT_TOKEN, "")
    .replace(PRIORITY_TOKEN, "")
    .replace(DUE_TOKEN, "")
    .replace(TAG_TOKEN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
    .trim();
  if (!title) title = "Untitled capture";

  return {
    type,
    title,
    dueAt,
    priority,
    confidence,
    projectName,
    tags,
    needsSynthesis: confidence < 0.7,
  };
}

export function planDayFallback(
  items: Array<{ id: string; title: string; priority: number; dueAt?: number; type: string }>
): { schedule: Array<{ itemId: string; timeSlot: string; reason: string }>; summary: string } {
  const sorted = [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ad = a.dueAt ?? Number.MAX_SAFE_INTEGER;
    const bd = b.dueAt ?? Number.MAX_SAFE_INTEGER;
    return ad - bd;
  });
  const schedule = sorted.slice(0, 8).map((it, i) => ({
    itemId: it.id,
    timeSlot: `${String(9 + i).padStart(2, "0")}:00`,
    reason: it.dueAt ? `Due soon (p${it.priority})` : `Priority p${it.priority} ${it.type}`,
  }));
  const summary = sorted.length === 0
    ? "No due items. Inbox is clear."
    : `Top focus: ${sorted[0].title}. ${sorted.length} item(s) ordered by priority and due date.`;
  return { schedule, summary };
}
