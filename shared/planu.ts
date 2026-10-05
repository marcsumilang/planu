export type ItemType = "note" | "plan" | "goal" | "milestone" | "habit" | "task" | "idea";
export type ItemStatus = "inbox" | "active" | "done" | "archived";
export type ScopeKind = "personal" | "team";
export type TeamRole = "owner" | "admin" | "member" | "guest";
export type InviteStatus = "active" | "invited" | "declined";

export interface Item {
  id: string;
  ownerId: string;
  scopeKind: ScopeKind;
  teamId?: string;
  projectId?: string;
  type: ItemType;
  title: string;
  body: string;
  status: ItemStatus;
  priority: 1 | 2 | 3;
  dueAt?: number;
  repeatRule?: string;
  streakCount: number;
  lastCheckedAt?: number;
  parentId?: string;
  kanbanColumn?: string;
  kanbanOrder: number;
  aiSummary?: string;
  aiNextAction?: string;
  mtime: number;
  deletedAt?: number;
}

export interface Project {
  id: string;
  ownerId: string;
  teamId?: string;
  name: string;
  description: string;
  boardColumns: string[];
  color: string;
  mtime: number;
}

export interface Summary {
  refKind: "goal" | "milestone" | "project" | "habit";
  refId: string;
  doneCount: number;
  totalCount: number;
  streakCount: number;
  mtime: number;
}

export interface Checkin {
  id: string;
  itemId: string;
  userId: string;
  dayKey: string;
  at: number;
  value: number;
}

export const ITEM_TYPES: ItemType[] = ["note", "plan", "goal", "milestone", "habit", "task", "idea"];
export const ITEM_STATUSES: ItemStatus[] = ["inbox", "active", "done", "archived"];
export const SCOPE_KINDS: ScopeKind[] = ["personal", "team"];
export const TEAM_ROLES: TeamRole[] = ["owner", "admin", "member", "guest"];

const MIN_EPOCH = Date.parse("2000-01-01T00:00:00Z");
const MAX_EPOCH = Date.parse("2100-01-01T00:00:00Z");

export function isItemType(v: unknown): v is ItemType {
  return typeof v === "string" && (ITEM_TYPES as string[]).includes(v);
}

export function isItemStatus(v: unknown): v is ItemStatus {
  return typeof v === "string" && (ITEM_STATUSES as string[]).includes(v);
}

export function isScopeKind(v: unknown): v is ScopeKind {
  return typeof v === "string" && (SCOPE_KINDS as string[]).includes(v);
}

export function isTeamRole(v: unknown): v is TeamRole {
  return typeof v === "string" && (TEAM_ROLES as string[]).includes(v);
}

export function cleanTitle(value: unknown): string {
  if (typeof value !== "string") throw new Error("Validation failed: title");
  const t = value.trim().slice(0, 160).trim();
  if (!t) throw new Error("Validation failed: title");
  return t;
}

export function cleanOptionalTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 160);
}

export function cleanBody(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error("Validation failed: body");
  if (value.length > 20000) throw new Error("Validation failed: body");
  return value;
}

export function cleanPriority(value: unknown): 1 | 2 | 3 {
  if (value === undefined || value === null) return 2;
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error("Validation failed: priority");
}

export function cleanDueAt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Validation failed: dueAt");
  const ms = Math.floor(value);
  if (ms < MIN_EPOCH || ms > MAX_EPOCH) throw new Error("Validation failed: dueAt");
  return ms;
}

export function cleanAt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Validation failed: at");
  const ms = Math.floor(value);
  if (ms < MIN_EPOCH || ms > MAX_EPOCH) throw new Error("Validation failed: at");
  return ms;
}

export function cleanKanbanOrder(value: unknown): number {
  if (value === undefined || value === null) return 1000;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Validation failed: kanbanOrder");
  return value;
}

export function cleanKanbanColumn(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("Validation failed: kanbanColumn");
  const t = value.trim().slice(0, 40);
  if (!t) return undefined;
  return t;
}

export function cleanRepeatRule(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("Validation failed: repeatRule");
  const t = value.trim().slice(0, 80);
  if (!t) return undefined;
  if (t === "daily" || t === "weekdays") return t;
  if (t.startsWith("weekly:")) {
    const days = t.slice("weekly:".length).split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
    const valid = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    if (days.length === 0 || days.length > 7 || !days.every((d) => valid.includes(d))) {
      throw new Error("Validation failed: repeatRule");
    }
    return "weekly:" + days.join(",");
  }
  throw new Error("Validation failed: repeatRule");
}

export function cleanProjectName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Validation failed: name");
  const t = value.trim().slice(0, 80).trim();
  if (!t) throw new Error("Validation failed: name");
  return t;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDayKey(s: string): boolean {
  if (!DAY_KEY_RE.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t);
}

export function assertDayKey(s: unknown): string {
  if (typeof s !== "string" || !isValidDayKey(s)) throw new Error("Validation failed: dayKey");
  return s;
}

export function cleanLimit(value: unknown, def = 50): number {
  if (value === undefined || value === null) return def;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Validation failed: limit");
  const n = Math.floor(value);
  if (n < 1 || n > 100) throw new Error("Validation failed: limit");
  return n;
}
