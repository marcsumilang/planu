import {
  boolean,
  capsule,
  endpoint,
  id,
  json,
  mutation,
  number,
  query,
  string,
  table,
  text,
  userId,
} from "lakebed/server";
import { planDayFallback, routeCapture } from "../shared/jev";
import {
  assertDayKey,
  cleanAt,
  cleanBody,
  cleanDueAt,
  cleanKanbanColumn,
  cleanKanbanOrder,
  cleanLimit,
  cleanPriority,
  cleanProjectName,
  cleanRepeatRule,
  cleanTitle,
  isItemStatus,
  isItemType,
  isScopeKind,
} from "../shared/planu";
import { dayKeyFromMs, shouldCarryStreak } from "../shared/habits";
import { mergeDesc, olderThanCursor, parseCursor, toEnvelope } from "../shared/pagination";

function nowMs(): number {
  return Date.now();
}

function summaryRefKindForType(t: string): "goal" | "milestone" | "project" | "habit" | null {
  if (t === "goal" || t === "milestone" || t === "project" || t === "habit") return t;
  return null;
}

async function getSummary(ctx: any, refKind: string, refId: string): Promise<any | null> {
  return ctx.db.summaries.withIndex("by_ref", (q: any) => q.eq("refKind", refKind).eq("refId", refId)).first();
}

async function ensureSummary(ctx: any, refKind: string, refId: string): Promise<any> {
  const existing = await getSummary(ctx, refKind, refId);
  if (existing) return existing;
  const created: any = await ctx.db.summaries.insert({
    refKind,
    refId,
    doneCount: 0,
    totalCount: 0,
    streakCount: 0,
    mtime: nowMs(),
  });
  return created;
}

async function adjustParentSummaries(
  ctx: any,
  parentId: string | undefined,
  deltaDone: number,
  deltaTotal: number
): Promise<void> {
  let currentId: string | undefined = parentId;
  for (let depth = 0; depth < 3; depth++) {
    if (!currentId) break;
    const parent: any = await ctx.db.items.get(currentId);
    if (!parent) break;
    const refKind = summaryRefKindForType(parent.type);
    if (refKind) {
      const s = await ensureSummary(ctx, refKind, parent.id);
      await ctx.db.summaries.update(s.id, {
        doneCount: Math.max(0, (s.doneCount ?? 0) + deltaDone),
        totalCount: Math.max(0, (s.totalCount ?? 0) + deltaTotal),
        mtime: nowMs(),
      });
    }
    currentId = parent.parentId as string | undefined;
  }
}

async function requireMembership(ctx: any, teamId: string, callerUserId: string): Promise<any> {
  const m = await ctx.db.memberships
    .withIndex("by_team_user", (q: any) => q.eq("teamId", teamId).eq("userId", callerUserId))
    .first();
  if (!m || m.inviteStatus !== "active") throw new Error("Access denied: not an active member of this team");
  return m;
}

function sha256Hex(input: string): string {
  // Deterministic hex digest for alpha; token randomness provides uniqueness.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ (c + 1), 16777619);
  }
  return ("0000000" + (h1 >>> 0).toString(16)).slice(-8) + ("0000000" + (h2 >>> 0).toString(16)).slice(-8);
}

async function sha256Async(input: string): Promise<string> {
  // Deterministic hex digest, sufficient for alpha.
  return "fnv1a$" + sha256Hex(input);
}

function randomHex32(): string {
  // Math.random is the available entropy source in this runtime.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default capsule({
  name: "planu",
  auth: { requireSignIn: false },

  schema: {
    items: table({
      ownerId: userId(),
      scopeKind: string().default("personal"),
      teamId: id("teams").optional(),
      projectId: id("projects").optional(),
      type: string(),
      title: string(),
      body: string().default(""),
      status: string().default("inbox"),
      priority: number().default(2),
      dueAt: number().optional(),
      repeatRule: string().optional(),
      streakCount: number().default(0),
      lastCheckedAt: number().optional(),
      parentId: id("items").optional(),
      kanbanColumn: string().optional(),
      kanbanOrder: number().default(1000),
      aiSummary: string().optional(),
      aiNextAction: string().optional(),
      mtime: number(),
      deletedAt: number().optional(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_owner_type", ["ownerId", "type"])
      .index("by_owner_status", ["ownerId", "status"])
      .index("by_team", ["teamId"])
      .index("by_project", ["projectId"])
      .index("by_parent", ["parentId"])
      .index("by_owner_updated", ["ownerId", "mtime"]),

    projects: table({
      ownerId: userId(),
      teamId: id("teams").optional(),
      name: string(),
      description: string().default(""),
      boardColumns: string().default('["todo","doing","done"]'),
      color: string().default("#3b82f6"),
      mtime: number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_team", ["teamId"]),

    teams: table({
      ownerId: userId(),
      name: string(),
      requireSignIn: boolean().default(false),
      mtime: number(),
    }).index("by_owner", ["ownerId"]),

    memberships: table({
      teamId: id("teams"),
      userId: userId(),
      role: string().default("member"),
      inviteStatus: string().default("active"),
      invitedEmail: string().optional(),
      mtime: number(),
    })
      .index("by_team", ["teamId"])
      .index("by_user", ["userId"])
      .index("by_team_user", ["teamId", "userId"]),

    teamInvites: table({
      teamId: id("teams"),
      tokenHash: string(),
      role: string().default("member"),
      createdById: userId(),
      expiresAt: number(),
      maxUses: number().default(0),
      usedCount: number().default(0),
      revoked: boolean().default(false),
    })
      .index("by_token", ["tokenHash"])
      .index("by_team", ["teamId"]),

    checkins: table({
      itemId: id("items"),
      userId: userId(),
      dayKey: string(),
      at: number(),
      value: number().default(1),
    })
      .index("by_item", ["itemId"])
      .index("by_item_day", ["itemId", "dayKey"])
      .index("by_user_at", ["userId", "at"]),

    summaries: table({
      refKind: string(),
      refId: string(),
      doneCount: number().default(0),
      totalCount: number().default(0),
      streakCount: number().default(0),
      mtime: number(),
    }).index("by_ref", ["refKind", "refId"]),

    agentTokens: table({
      ownerId: userId(),
      name: string(),
      tokenHash: string(),
      scopes: string(),
      expiresAt: number(),
      revoked: boolean().default(false),
      lastUsedAt: number().optional(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_token", ["tokenHash"]),
  },

  queries: {
    items_list: query(async (ctx, args: { type?: string; status?: string; projectId?: string; limit?: number; cursor?: { mtime: number; id: string } } = {}) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      const limit = cleanLimit(args.limit);
      const cursor = args.cursor === undefined ? undefined : parseCursor(args.cursor);
      if (args.type !== undefined) {
        if (!isItemType(args.type)) throw new Error("Validation failed: type");
        const rows = await ctx.db.items
          .withIndex("by_owner_type", (q: any) => q.eq("ownerId", caller).eq("type", args.type))
          .order("desc")
          .take(limit + 1);
        return toEnvelope(olderThanCursor(rows, cursor), limit);
      } else if (args.status !== undefined) {
        if (!isItemStatus(args.status)) throw new Error("Validation failed: status");
        const rows = await ctx.db.items
          .withIndex("by_owner_status", (q: any) => q.eq("ownerId", caller).eq("status", args.status))
          .order("desc")
          .take(limit + 1);
        return toEnvelope(olderThanCursor(rows, cursor), limit);
      } else if (args.projectId !== undefined) {
        if (typeof args.projectId !== "string" || !args.projectId) throw new Error("Validation failed: projectId");
        const rows = await ctx.db.items
          .withIndex("by_project", (q: any) => q.eq("projectId", args.projectId))
          .order("desc")
          .take(limit + 1);
        return toEnvelope(olderThanCursor(rows.filter((r: any) => r.ownerId === caller), cursor), limit);
      } else {
        // Cursor filters on by_owner_updated: push the range into the index.
        let rows: any[];
        if (!cursor) {
          rows = await ctx.db.items
            .withIndex("by_owner_updated", (q: any) => q.eq("ownerId", caller))
            .order("desc")
            .take(limit + 1);
        } else {
          const older = await ctx.db.items
            .withIndex("by_owner_updated", (q: any) => q.eq("ownerId", caller).lt("mtime", cursor!.mtime))
            .order("desc")
            .take(limit + 1);
          const sameTick = await ctx.db.items
            .withIndex("by_owner_updated", (q: any) => q.eq("ownerId", caller).eq("mtime", cursor!.mtime))
            .order("desc")
            .take(limit + 1);
          const ties = sameTick.filter((r: any) => String(r.id) < cursor!.id);
          // Both windows are desc; merge by (mtime desc, id desc).
          const merged = mergeDesc(older, ties);
          rows = merged;
        }
        return toEnvelope(rows, limit);
      }
    }),

    items_get: query(async (ctx, args: { id: string }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      if (!args || typeof args.id !== "string" || !args.id) throw new Error("Validation failed: id");
      const row: any = await ctx.db.items.get(args.id);
      if (!row || row.deletedAt) return null;
      if (row.ownerId !== caller) {
        if (row.scopeKind === "team" && row.teamId) {
          await requireMembership(ctx, row.teamId, caller);
          return row;
        }
        throw new Error("Access denied: not owner");
      }
      return row;
    }),

    today: query(async (ctx) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      // Max 3 indexed reads, no paginate loops.
      const inbox = await ctx.db.items
        .withIndex("by_owner_status", (q: any) => q.eq("ownerId", caller).eq("status", "inbox"))
        .order("desc")
        .take(50);
      const habits = await ctx.db.items
        .withIndex("by_owner_type", (q: any) => q.eq("ownerId", caller).eq("type", "habit"))
        .order("desc")
        .take(50);
      const active = await ctx.db.items
        .withIndex("by_owner_status", (q: any) => q.eq("ownerId", caller).eq("status", "active"))
        .order("desc")
        .take(100);
      const now = nowMs();
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + 86400000;
      const live = (r: any) => !r.deletedAt;
      const dueTasks = active.filter(
        (r: any) => live(r) && (r.type === "task" || r.type === "milestone") && typeof r.dueAt === "number" && r.dueAt < dayEnd
      );
      const inboxLive = inbox.filter(live);
      const habitsLive = habits.filter((r: any) => live(r) && r.status !== "archived");
      const plan = planDayFallback(
        [...dueTasks, ...habitsLive.slice(0, 10)].map((r: any) => ({
          id: r.id,
          title: r.title,
          priority: r.priority ?? 2,
          dueAt: r.dueAt,
          type: r.type,
        }))
      );
      return {
        inbox: inboxLive,
        habitsDue: habitsLive,
        dueTasks,
        inboxCount: inboxLive.length,
        plan,
        serverTime: now,
      };
    }),

    projects_list: query(async (ctx) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      const rows = await ctx.db.projects
        .withIndex("by_owner", (q: any) => q.eq("ownerId", caller))
        .order("desc")
        .take(50);
      return rows;
    }),

    summaries_get: query(async (ctx, args: { refKind: string; refId: string }) => {
      ctx.auth.requireIdentity();
      if (!args || typeof args.refKind !== "string" || typeof args.refId !== "string") {
        throw new Error("Validation failed: ref");
      }
      if (!["goal", "milestone", "project", "habit"].includes(args.refKind)) throw new Error("Validation failed: refKind");
      const s = await ctx.db.summaries
        .withIndex("by_ref", (q: any) => q.eq("refKind", args.refKind).eq("refId", args.refId))
        .first();
      return s ?? { refKind: args.refKind, refId: args.refId, doneCount: 0, totalCount: 0, streakCount: 0, mtime: 0 };
    }),

    teams_list: query(async (ctx) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      const mine = await ctx.db.memberships
        .withIndex("by_user", (q: any) => q.eq("userId", caller))
        .order("desc")
        .take(50);
      const out = [];
      for (const m of mine.filter((x: any) => x.inviteStatus === "active").slice(0, 20)) {
        const t: any = await ctx.db.teams.get(m.teamId);
        if (t) out.push({ ...t, role: m.role });
      }
      return out;
    }),

    ai_planDay: query(async (ctx) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      const active = await ctx.db.items
        .withIndex("by_owner_status", (q: any) => q.eq("ownerId", caller).eq("status", "active"))
        .order("desc")
        .take(50);
      const inbox = await ctx.db.items
        .withIndex("by_owner_status", (q: any) => q.eq("ownerId", caller).eq("status", "inbox"))
        .order("desc")
        .take(20);
      const all = [...active, ...inbox].filter((r: any) => !r.deletedAt);
      return planDayFallback(
        all.map((r: any) => ({ id: r.id, title: r.title, priority: r.priority ?? 2, dueAt: r.dueAt, type: r.type }))
      );
    }),
  },

  mutations: {
    items_create: mutation(
      async (
        ctx,
        args: {
          rawText?: string;
          title?: string;
          type?: string;
          body?: string;
          priority?: number;
          dueAt?: number;
          projectId?: string;
          repeatRule?: string;
          parentId?: string;
          kanbanColumn?: string;
        } = {}
      ) => {
        const { userId: caller } = ctx.auth.requireIdentity();
        const t = nowMs();
        let title = "";
        let type = "idea";
        let priority: 1 | 2 | 3 = 2;
        let dueAt: number | undefined;
        let projectId: string | undefined = args.projectId;
        let projectMatched = false;

        if (args.rawText !== undefined) {
          if (typeof args.rawText !== "string" || !args.rawText.trim()) throw new Error("Validation failed: rawText");
          if (args.rawText.length > 2000) throw new Error("Validation failed: rawText");
          const parsed = routeCapture(args.rawText.slice(0, 2000), t);
          title = parsed.title;
          type = parsed.type;
          priority = parsed.priority;
          dueAt = parsed.dueAt;
          if (parsed.projectName && !projectId) {
            const mine = await ctx.db.projects
              .withIndex("by_owner", (q: any) => q.eq("ownerId", caller))
              .order("desc")
              .take(50);
            const found = mine.find((p: any) => p.name.toLowerCase() === parsed.projectName!.toLowerCase());
            if (found) {
              projectId = found.id;
              projectMatched = true;
            }
          }
        } else {
          if (args.title === undefined) throw new Error("Validation failed: title");
          title = cleanTitle(args.title);
        }

        if (args.type !== undefined) {
          if (!isItemType(args.type)) throw new Error("Validation failed: type");
          type = args.type;
        }
        if (args.priority !== undefined) priority = cleanPriority(args.priority);
        if (args.dueAt !== undefined) dueAt = cleanDueAt(args.dueAt);
        const body = cleanBody(args.body);
        const repeatRule = cleanRepeatRule(args.repeatRule);
        const kanbanColumn = cleanKanbanColumn(args.kanbanColumn);
        let parentId: string | undefined;
        if (args.parentId !== undefined) {
          if (typeof args.parentId !== "string" || !args.parentId) throw new Error("Validation failed: parentId");
          const parent: any = await ctx.db.items.get(args.parentId);
          if (!parent || parent.ownerId !== caller || parent.deletedAt) throw new Error("Not found: parent");
          parentId = parent.id;
        }
        if (projectId !== undefined) {
          if (typeof projectId !== "string" || !projectId) throw new Error("Validation failed: projectId");
          const proj: any = await ctx.db.projects.get(projectId);
          if (!proj || proj.ownerId !== caller) throw new Error("Not found: project");
        }

        const status = type === "idea" || type === "note" ? "inbox" : "active";
        const inserted: any = await ctx.db.items.insert({
          ownerId: caller,
          scopeKind: "personal",
          teamId: undefined,
          projectId,
          type,
          title,
          body,
          status,
          priority,
          dueAt,
          repeatRule,
          streakCount: 0,
          lastCheckedAt: undefined,
          parentId,
          kanbanColumn: kanbanColumn ?? (projectId ? "todo" : undefined),
          kanbanOrder: 1000,
          aiSummary: undefined,
          aiNextAction: undefined,

          mtime: t,
          deletedAt: undefined,
        });
        if (parentId) await adjustParentSummaries(ctx, parentId, 0, 1);
        return { item: inserted, projectMatched };
      }
    ),

    items_update: mutation(
      async (
        ctx,
        args: { id: string; title?: string; body?: string; priority?: number; dueAt?: number | null; repeatRule?: string | null; kanbanColumn?: string }
      ) => {
        const { userId: caller } = ctx.auth.requireIdentity();
        if (!args || typeof args.id !== "string" || !args.id) throw new Error("Validation failed: id");
        const row: any = await ctx.db.items.get(args.id);
        if (!row || row.deletedAt) throw new Error("Not found: item");
        if (row.ownerId !== caller) throw new Error("Access denied: not owner");
        const patch: any = { mtime: nowMs() };
        if (args.title !== undefined) patch.title = cleanTitle(args.title);
        if (args.body !== undefined) patch.body = cleanBody(args.body);
        if (args.priority !== undefined) patch.priority = cleanPriority(args.priority);
        if (args.dueAt !== undefined) patch.dueAt = args.dueAt === null ? null : cleanDueAt(args.dueAt);
        if (args.repeatRule !== undefined) patch.repeatRule = args.repeatRule === null ? null : cleanRepeatRule(args.repeatRule);
        if (args.kanbanColumn !== undefined) patch.kanbanColumn = cleanKanbanColumn(args.kanbanColumn) ?? null;
        await ctx.db.items.update(args.id, patch);
        return ctx.db.items.get(args.id);
      }
    ),

    items_setStatus: mutation(async (ctx, args: { id: string; status: string }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      if (!args || typeof args.id !== "string" || !args.id) throw new Error("Validation failed: id");
      if (!isItemStatus(args.status)) throw new Error("Validation failed: status");
      const row: any = await ctx.db.items.get(args.id);
      if (!row || row.deletedAt) throw new Error("Not found: item");
      if (row.ownerId !== caller) throw new Error("Access denied: not owner");
      const wasDone = row.status === "done";
      const nowDone = args.status === "done";
      await ctx.db.items.update(args.id, { status: args.status, mtime: nowMs() });
      if (wasDone !== nowDone && row.parentId) {
        await adjustParentSummaries(ctx, row.parentId, nowDone ? 1 : -1, 0);
      }
      return ctx.db.items.get(args.id);
    }),

    promoteIdea: mutation(async (ctx, args: { id: string; newType: string }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      if (!args || typeof args.id !== "string" || !args.id) throw new Error("Validation failed: id");
      if (!isItemType(args.newType)) throw new Error("Validation failed: newType");
      const row: any = await ctx.db.items.get(args.id);
      if (!row || row.deletedAt) throw new Error("Not found: item");
      if (row.ownerId !== caller) throw new Error("Access denied: not owner");
      const status = args.newType === "idea" || args.newType === "note" ? "inbox" : "active";
      await ctx.db.items.update(args.id, { type: args.newType, status, mtime: nowMs() });
      return ctx.db.items.get(args.id);
    }),

    changeItemScope: mutation(async (ctx, args: { id: string; newScopeKind: string; newTeamId?: string }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      if (!args || typeof args.id !== "string" || !args.id) throw new Error("Validation failed: id");
      if (!isScopeKind(args.newScopeKind)) throw new Error("Validation failed: newScopeKind");
      const row: any = await ctx.db.items.get(args.id);
      if (!row || row.deletedAt) throw new Error("Not found: item");
      if (row.ownerId !== caller) throw new Error("Access denied: not owner");
      if (args.newScopeKind === "team") {
        if (!args.newTeamId || typeof args.newTeamId !== "string") throw new Error("Validation failed: newTeamId");
        await requireMembership(ctx, args.newTeamId, caller);
        await ctx.db.items.update(args.id, { scopeKind: "team", teamId: args.newTeamId, mtime: nowMs() });
      } else {
        await ctx.db.items.update(args.id, { scopeKind: "personal", teamId: null, mtime: nowMs() });
      }
      return ctx.db.items.get(args.id);
    }),

    checkin_toggle: mutation(async (ctx, args: { itemId: string; dayKey: string; at: number }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      if (!args || typeof args.itemId !== "string" || !args.itemId) throw new Error("Validation failed: itemId");
      const dayKey = assertDayKey(args.dayKey);
      const at = cleanAt(args.at);
      // dayKey must match client local day for `at` (±1 day tolerance for tz skew).
      const clientDay = dayKeyFromMs(at);
      if (clientDay !== dayKey) {
        const diff = Math.abs(Date.parse(clientDay + "T00:00:00Z") - Date.parse(dayKey + "T00:00:00Z"));
        if (diff > 86400000) throw new Error("Validation failed: dayKey");
      }
      const item: any = await ctx.db.items.get(args.itemId);
      if (!item || item.deletedAt) throw new Error("Not found: item");
      if (item.ownerId !== caller) throw new Error("Access denied: not owner");
      if (item.type !== "habit" && item.type !== "milestone" && item.type !== "task") {
        throw new Error("Validation failed: type");
      }
      const existing: any = await ctx.db.checkins
        .withIndex("by_item_day", (q: any) => q.eq("itemId", args.itemId).eq("dayKey", dayKey))
        .first();
      if (existing) {
        if (existing.userId !== caller) throw new Error("Access denied: not owner");
        await ctx.db.checkins.delete(existing.id);
        const next = Math.max(0, (item.streakCount ?? 0) - 1);
        await ctx.db.items.update(item.id, { streakCount: next, mtime: nowMs() });
        const refKind = summaryRefKindForType(item.type);
        if (refKind) {
          const s = await ensureSummary(ctx, refKind, item.id);
          await ctx.db.summaries.update(s.id, { streakCount: next, mtime: nowMs() });
        }
        return { checked: false, streakCount: next };
      }
      await ctx.db.checkins.insert({ itemId: item.id, userId: caller, dayKey, at, value: 1 });
      // Find previous checkin day for streak evaluation (last 30 by user).
      const recent = await ctx.db.checkins
        .withIndex("by_item", (q: any) => q.eq("itemId", item.id))
        .order("desc")
        .take(30);
      const otherDays = recent
        .map((r: any) => r.dayKey)
        .filter((d: string) => d !== dayKey)
        .sort();
      const prevDay = otherDays.length > 0 ? otherDays[otherDays.length - 1] : undefined;
      const carry = prevDay ? shouldCarryStreak(item.repeatRule, prevDay, dayKey) : false;
      const next = prevDay ? (carry ? (item.streakCount ?? 0) + 1 : 1) : (item.streakCount ?? 0) + 1 || 1;
      const streak = Math.max(1, next);
      await ctx.db.items.update(item.id, { streakCount: streak, lastCheckedAt: at, mtime: nowMs() });
      const refKind = summaryRefKindForType(item.type);
      if (refKind) {
        const s = await ensureSummary(ctx, refKind, item.id);
        await ctx.db.summaries.update(s.id, { streakCount: streak, mtime: nowMs() });
      }
      return { checked: true, streakCount: streak };
    }),

    project_create: mutation(
      async (ctx, args: { name: string; description?: string; boardColumns?: string[]; color?: string }) => {
        const { userId: caller } = ctx.auth.requireIdentity();
        const name = cleanProjectName(args?.name);
        const description = typeof args?.description === "string" ? args.description.slice(0, 2000) : "";
        let cols = ["todo", "doing", "done"];
        if (args?.boardColumns !== undefined) {
          if (!Array.isArray(args.boardColumns) || args.boardColumns.length === 0 || args.boardColumns.length > 12) {
            throw new Error("Validation failed: boardColumns");
          }
          cols = args.boardColumns.map((c) => {
            if (typeof c !== "string" || !c.trim()) throw new Error("Validation failed: boardColumns");
            return c.trim().slice(0, 40);
          });
        }
        const color = typeof args?.color === "string" && /^#[0-9a-fA-F]{6}$/.test(args.color) ? args.color : "#3b82f6";
        const t = nowMs();
        const created: any = await ctx.db.projects.insert({
          ownerId: caller,
          teamId: undefined,
          name,
          description,
          boardColumns: JSON.stringify(cols),
          color,

          mtime: t,
        });
        return created;
      }
    ),

    card_move: mutation(
      async (ctx, args: { id: string; toColumn: string; prevOrder?: number; nextOrder?: number }) => {
        const { userId: caller } = ctx.auth.requireIdentity();
        if (!args || typeof args.id !== "string" || !args.id) throw new Error("Validation failed: id");
        const toColumn = cleanKanbanColumn(args.toColumn);
        if (!toColumn) throw new Error("Validation failed: toColumn");
        const row: any = await ctx.db.items.get(args.id);
        if (!row || row.deletedAt) throw new Error("Not found: item");
        if (row.ownerId !== caller) throw new Error("Access denied: not owner");
        const prev = args.prevOrder !== undefined ? cleanKanbanOrder(args.prevOrder) : undefined;
        const next = args.nextOrder !== undefined ? cleanKanbanOrder(args.nextOrder) : undefined;
        let order: number;
        if (prev === undefined && next === undefined) order = 1000;
        else if (prev === undefined) order = next! / 2;
        else if (next === undefined) order = prev + 1000;
        else order = (prev + next) / 2;
        if (!Number.isFinite(order)) throw new Error("Validation failed: kanbanOrder");
        const needsRebalance = prev !== undefined && next !== undefined && Math.abs(next - prev) < 1e-4;
        if (needsRebalance && row.projectId) {
          const col = await ctx.db.items
            .withIndex("by_project", (q: any) => q.eq("projectId", row.projectId))
            .order("asc")
            .take(100);
          const inCol = col
            .filter((r: any) => !r.deletedAt && (r.kanbanColumn ?? "todo") === toColumn && r.id !== row.id)
            .sort((a: any, b: any) => (a.kanbanOrder ?? 1000) - (b.kanbanOrder ?? 1000));
          let step = 1000;
          let idx = 0;
          for (const card of inCol) {
            idx += 1;
            await ctx.db.items.update(card.id, { kanbanOrder: idx * step, kanbanColumn: toColumn, mtime: nowMs() });
          }
          order = (idx + 1) * step;
        }
        const wasDoneCol = (row.kanbanColumn ?? "todo") === "done";
        const nowDoneCol = toColumn === "done";
        await ctx.db.items.update(args.id, { kanbanColumn: toColumn, kanbanOrder: order, mtime: nowMs() });
        if (row.projectId && wasDoneCol !== nowDoneCol) {
          const s = await ensureSummary(ctx, "project", row.projectId);
          await ctx.db.summaries.update(s.id, {
            doneCount: Math.max(0, (s.doneCount ?? 0) + (nowDoneCol ? 1 : -1)),
            mtime: nowMs(),
          });
        }
        return ctx.db.items.get(args.id);
      }
    ),

    team_create: mutation(async (ctx, args: { name: string; requireSignIn?: boolean }) => {
      const ident: any = ctx.auth.requireIdentity();
      const caller = ident.userId as string;
      const name = cleanProjectName(args?.name);
      const t = nowMs();
      const team: any = await ctx.db.teams.insert({
        ownerId: caller,
        name,
        requireSignIn: Boolean(args?.requireSignIn),

        mtime: t,
      });
      await ctx.db.memberships.insert({
        teamId: team.id,
        userId: caller,
        role: "owner",
        inviteStatus: "active",
        invitedEmail: undefined,

        mtime: t,
      });
      return team;
    }),

    team_invite_create: mutation(
      async (ctx, args: { teamId: string; role?: string; expiresInHours?: number; maxUses?: number }) => {
        const { userId: caller } = ctx.auth.requireIdentity();
        if (!args || typeof args.teamId !== "string" || !args.teamId) throw new Error("Validation failed: teamId");
        const team: any = await ctx.db.teams.get(args.teamId);
        if (!team) throw new Error("Not found: team");
        const mem = await requireMembership(ctx, args.teamId, caller);
        if (mem.role !== "owner" && mem.role !== "admin") throw new Error("Access denied: invite");
        const role = args.role ?? "member";
        if (!["member", "guest", "admin"].includes(role)) throw new Error("Validation failed: role");
        const hours = args.expiresInHours ?? 72;
        if (typeof hours !== "number" || hours < 1 || hours > 720) throw new Error("Validation failed: expiresInHours");
        const maxUses = args.maxUses ?? 0;
        if (typeof maxUses !== "number" || maxUses < 0 || maxUses > 1000) throw new Error("Validation failed: maxUses");
        const raw = "planu_inv_" + randomHex32() + randomHex32().slice(0, 16);
        const tokenHash = await sha256Async(raw);
        const t = nowMs();
        await ctx.db.teamInvites.insert({
          teamId: args.teamId,
          tokenHash,
          role,
          createdById: caller,
          expiresAt: t + hours * 3600000,
          maxUses,
          usedCount: 0,
          revoked: false,

        });
        return { token: raw, expiresAt: t + hours * 3600000 };
      }
    ),

    team_invite_redeem: mutation(async (ctx, args: { token: string }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      if (!args || typeof args.token !== "string" || !args.token.startsWith("planu_inv_")) {
        throw new Error("Validation failed: token");
      }
      const tokenHash = await sha256Async(args.token);
      const invite: any = await ctx.db.teamInvites
        .withIndex("by_token", (q: any) => q.eq("tokenHash", tokenHash))
        .first();
      if (!invite || invite.revoked) throw new Error("Not found: invite");
      if (invite.expiresAt < nowMs()) throw new Error("Invite expired");
      if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses) throw new Error("Invite expired");
      const team: any = await ctx.db.teams.get(invite.teamId);
      if (!team) throw new Error("Not found: team");
      const existing = await ctx.db.memberships
        .withIndex("by_team_user", (q: any) => q.eq("teamId", invite.teamId).eq("userId", caller))
        .first();
      const t = nowMs();
      if (!existing) {
        await ctx.db.memberships.insert({
          teamId: invite.teamId,
          userId: caller,
          role: invite.role,
          inviteStatus: "active",
          invitedEmail: undefined,

          mtime: t,
        });
        await ctx.db.teamInvites.update(invite.id, { usedCount: (invite.usedCount ?? 0) + 1 });
      }
      return { teamId: invite.teamId, role: invite.role };
    }),

    agentToken_create: mutation(async (ctx, args: { name: string; scopes?: string[]; expiresInHours?: number }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      const name = cleanProjectName(args?.name);
      const allowed = ["items:read", "items:write", "projects:read", "projects:write", "teams:read", "teams:write", "ai:execute"];
      const scopes = Array.isArray(args?.scopes) && args.scopes.length > 0 ? args.scopes : ["items:read"];
      for (const s of scopes) if (!allowed.includes(s)) throw new Error("Validation failed: scopes");
      const hours = args?.expiresInHours ?? 24 * 90;
      if (typeof hours !== "number" || hours < 1 || hours > 24 * 365) throw new Error("Validation failed: expiresInHours");
      const raw = "planu_pat_" + randomHex32();
      const tokenHash = await sha256Async(raw);
      const t = nowMs();
      await ctx.db.agentTokens.insert({
        ownerId: caller,
        name,
        tokenHash,
        scopes: JSON.stringify(scopes),
        expiresAt: t + hours * 3600000,
        revoked: false,

        lastUsedAt: undefined,
      });
      return { token: raw, scopes, expiresAt: t + hours * 3600000 };
    }),

    agentToken_revoke: mutation(async (ctx, args: { id: string }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      if (!args || typeof args.id !== "string" || !args.id) throw new Error("Validation failed: id");
      const tok: any = await ctx.db.agentTokens.get(args.id);
      if (!tok || tok.ownerId !== caller) throw new Error("Not found: token");
      await ctx.db.agentTokens.update(args.id, { revoked: true });
      return { ok: true };
    }),

    items_delete: mutation(async (ctx, args: { id: string }) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      if (!args || typeof args.id !== "string" || !args.id) throw new Error("Validation failed: id");
      const row: any = await ctx.db.items.get(args.id);
      if (!row || row.deletedAt) throw new Error("Not found: item");
      if (row.ownerId !== caller) throw new Error("Access denied: not owner");
      const t = nowMs();
      await ctx.db.items.update(args.id, { deletedAt: t, mtime: t });
      if (row.parentId) {
        await adjustParentSummaries(ctx, row.parentId, row.status === "done" ? -1 : 0, -1);
      }
      return { ok: true };
    }),
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () => text("ok")),

    syncPull: endpoint({ method: "GET", path: "/api/sync/pull", readOnly: true }, async (ctx, req) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      const sinceRaw = req.query.get("since") ?? "0";
      const since = Number(sinceRaw);
      if (!Number.isFinite(since) || since < 0) return text("Validation failed: since", { status: 400 });
      const items = await ctx.db.items
        .withIndex("by_owner_updated", (q: any) => q.eq("ownerId", caller).gte("mtime", Math.floor(since)))
        .order("asc")
        .take(100);
      const tombstones = items.filter((r: any) => r.deletedAt && r.deletedAt > Math.floor(since)).map((r: any) => ({ id: r.id, deletedAt: r.deletedAt }));
      const live = items.filter((r: any) => !r.deletedAt);
      const checkins = await ctx.db.checkins
        .withIndex("by_user_at", (q: any) => q.eq("userId", caller).gte("at", Math.floor(since)))
        .order("asc")
        .take(100);
      return json({ items: live, checkins, tombstones, serverTime: nowMs() });
    }),

    syncPush: endpoint({ method: "POST", path: "/api/sync/push" }, async (ctx, req) => {
      const { userId: caller } = ctx.auth.requireIdentity();
      let body: any;
      try {
        body = await req.json();
      } catch {
        return text("Validation failed: body", { status: 400 });
      }
      const arr = Array.isArray(body?.items) ? body.items : Array.isArray(body?.mutations) ? body.mutations : null;
      if (!arr) return text("Validation failed: items", { status: 400 });
      if (arr.length > 50) return text("Validation failed: batch too large", { status: 400 });
      const confirmedIds: string[] = [];
      const rejected: Array<{ id: string; reason: string }> = [];
      for (const m of arr.slice(0, 50)) {
        try {
          const clientId = typeof m?.clientMutationId === "string" ? m.clientMutationId : typeof m?.id === "string" ? m.id : "";
          if (m?.kind === "delete" && typeof m?.id === "string") {
            const row: any = await ctx.db.items.get(m.id);
            if (!row || row.ownerId !== caller) throw new Error("Not found");
            await ctx.db.items.update(m.id, { deletedAt: nowMs(), mtime: nowMs() });
            confirmedIds.push(clientId || m.id);
            continue;
          }
          const item = m?.kind === "upsertItem" ? m.item : m;
          if (!item || typeof item.title !== "string") throw new Error("Validation failed: title");
          const title = cleanTitle(item.title);
          if (item.id) {
            const row: any = await ctx.db.items.get(item.id);
            if (!row || row.ownerId !== caller) throw new Error("Not found");
            const incoming = typeof item.mtime === "number" ? item.mtime : 0;
            if (incoming < (row.mtime ?? 0)) {
              rejected.push({ id: clientId || item.id, reason: "stale LWW" });
              continue;
            }
            await ctx.db.items.update(item.id, { title, body: cleanBody(item.body), status: isItemStatus(item.status) ? item.status : row.status, mtime: nowMs() });
            confirmedIds.push(clientId || item.id);
          } else {
            const t = nowMs();
            const created: any = await ctx.db.items.insert({
              ownerId: caller,
              scopeKind: "personal",
              teamId: undefined,
              projectId: undefined,
              type: isItemType(item.type) ? item.type : "idea",
              title,
              body: cleanBody(item.body),
              status: isItemStatus(item.status) ? item.status : "inbox",
              priority: 2,
              dueAt: undefined,
              repeatRule: undefined,
              streakCount: 0,
              lastCheckedAt: undefined,
              parentId: undefined,
              kanbanColumn: undefined,
              kanbanOrder: 1000,
              aiSummary: undefined,
              aiNextAction: undefined,

              mtime: t,
              deletedAt: undefined,
            });
            confirmedIds.push(clientId || created.id);
          }
        } catch (e: any) {
          rejected.push({ id: String(m?.id ?? m?.clientMutationId ?? "?"), reason: e?.message ?? "rejected" });
        }
      }
      return json({ confirmedIds, rejected });
    }),

    agentTriage: endpoint({ method: "POST", path: "/api/agent/ai/triage" }, async (ctx, req) => {
      const authz = req.headers.get("authorization") ?? "";
      if (!authz.startsWith("Bearer planu_pat_")) return text("unauthorized", { status: 401 });
      const tokenHash = await sha256Async(authz.slice("Bearer ".length));
      const tok: any = await ctx.db.agentTokens.withIndex("by_token", (q: any) => q.eq("tokenHash", tokenHash)).first();
      if (!tok || tok.revoked || tok.expiresAt < nowMs()) return text("unauthorized", { status: 401 });
      const scopes: string[] = JSON.parse(tok.scopes ?? "[]");
      if (!scopes.includes("ai:execute")) return text("unauthorized", { status: 403 });
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }
      const limit = Math.min(Number(body?.limit ?? 20) || 20, 50);
      const rows = await ctx.db.items
        .withIndex("by_owner_status", (q: any) => q.eq("ownerId", tok.ownerId).eq("status", "inbox"))
        .order("desc")
        .take(limit);
      // Jev-only triage: classify by title without outbound fetch.
      const out = rows
        .filter((r: any) => !r.deletedAt)
        .map((r: any) => ({ id: r.id, ...routeCapture(r.title + " " + (r.body ?? "").slice(0, 200), nowMs()) }));
      await ctx.db.agentTokens.update(tok.id, { lastUsedAt: nowMs() });
      return json({ triaged: out });
    }),

    agentItemsList: endpoint({ method: "GET", path: "/api/agent/items", readOnly: true }, async (ctx, req) => {
      const authz = req.headers.get("authorization") ?? "";
      if (!authz.startsWith("Bearer planu_pat_")) return text("unauthorized", { status: 401 });
      const tokenHash = await sha256Async(authz.slice("Bearer ".length));
      const tok: any = await ctx.db.agentTokens.withIndex("by_token", (q: any) => q.eq("tokenHash", tokenHash)).first();
      if (!tok || tok.revoked || tok.expiresAt < nowMs()) return text("unauthorized", { status: 401 });
      const scopes: string[] = JSON.parse(tok.scopes ?? "[]");
      if (!scopes.includes("items:read")) return text("unauthorized", { status: 403 });
      const type = req.query.get("type") ?? undefined;
      const statusQ = req.query.get("status") ?? undefined;
      const projectId = req.query.get("projectId") ?? undefined;
      const limit = Math.min(Math.max(Number(req.query.get("limit") ?? "50") || 50, 1), 100);
      const cursorMtimeRaw = req.query.get("cursorMtime") ?? req.query.get("cursor_mtime");
      const cursorId = req.query.get("cursorId") ?? req.query.get("cursor_id") ?? undefined;
      let cursor;
      try {
        if (cursorMtimeRaw !== null && cursorMtimeRaw !== undefined || cursorId !== undefined) {
          if (cursorMtimeRaw === null || cursorMtimeRaw === undefined) throw new Error("Validation failed: cursor");
          cursor = parseCursor({ mtime: Number(cursorMtimeRaw), id: cursorId });
        }
      } catch {
        return text("Validation failed: cursor", { status: 400 });
      }
      let out: { rows: any[]; nextCursor?: { mtime: number; id: string } };
      if (type && isItemType(type)) {
        const rows = await ctx.db.items
          .withIndex("by_owner_type", (q: any) => q.eq("ownerId", tok.ownerId).eq("type", type))
          .order("desc")
          .take(limit + 1);
        out = toEnvelope(olderThanCursor(rows, cursor), limit);
      } else if (statusQ && isItemStatus(statusQ)) {
        const rows = await ctx.db.items
          .withIndex("by_owner_status", (q: any) => q.eq("ownerId", tok.ownerId).eq("status", statusQ))
          .order("desc")
          .take(limit + 1);
        out = toEnvelope(olderThanCursor(rows, cursor), limit);
      } else if (projectId) {
        if (typeof projectId !== "string" || !projectId) return text("Validation failed: projectId", { status: 400 });
        const rows = await ctx.db.items
          .withIndex("by_project", (q: any) => q.eq("projectId", projectId))
          .order("desc")
          .take(limit + 1);
        out = toEnvelope(olderThanCursor(rows.filter((r: any) => r.ownerId === tok.ownerId), cursor), limit);
      } else if (!cursor) {
        const rows = await ctx.db.items
          .withIndex("by_owner_updated", (q: any) => q.eq("ownerId", tok.ownerId))
          .order("desc")
          .take(limit + 1);
        out = toEnvelope(rows, limit);
      } else {
        const older = await ctx.db.items
          .withIndex("by_owner_updated", (q: any) => q.eq("ownerId", tok.ownerId).lt("mtime", cursor.mtime))
          .order("desc")
          .take(limit + 1);
        const sameTick = await ctx.db.items
          .withIndex("by_owner_updated", (q: any) => q.eq("ownerId", tok.ownerId).eq("mtime", cursor.mtime))
          .order("desc")
          .take(limit + 1);
        const ties = sameTick.filter((r: any) => String(r.id) < cursor!.id);
        out = toEnvelope(mergeDesc(older, ties), limit);
      }
      return json(out);
    }),

    agentItemsCreate: endpoint({ method: "POST", path: "/api/agent/items" }, async (ctx, req) => {
      const authz = req.headers.get("authorization") ?? "";
      if (!authz.startsWith("Bearer planu_pat_")) return text("unauthorized", { status: 401 });
      const tokenHash = await sha256Async(authz.slice("Bearer ".length));
      const tok: any = await ctx.db.agentTokens.withIndex("by_token", (q: any) => q.eq("tokenHash", tokenHash)).first();
      if (!tok || tok.revoked || tok.expiresAt < nowMs()) return text("unauthorized", { status: 401 });
      const scopes: string[] = JSON.parse(tok.scopes ?? "[]");
      if (!scopes.includes("items:write")) return text("unauthorized", { status: 403 });
      let body: any;
      try {
        body = await req.json();
      } catch {
        return text("Validation failed: body", { status: 400 });
      }
      try {
        const t = nowMs();
        let title: string;
        let type = "idea";
        let priority: 1 | 2 | 3 = 2;
        let dueAt: number | undefined;
        if (typeof body?.rawText === "string" && body.rawText.trim()) {
          if (body.rawText.length > 2000) throw new Error("Validation failed: rawText");
          const parsed = routeCapture(body.rawText.slice(0, 2000), t);
          title = parsed.title;
          type = parsed.type;
          priority = parsed.priority;
          dueAt = parsed.dueAt;
        } else {
          if (typeof body?.title !== "string") throw new Error("Validation failed: title");
          title = cleanTitle(body.title);
        }
        if (body?.type !== undefined) {
          if (!isItemType(body.type)) throw new Error("Validation failed: type");
          type = body.type;
        }
        if (body?.priority !== undefined) priority = cleanPriority(body.priority);
        if (body?.dueAt !== undefined) dueAt = cleanDueAt(body.dueAt);
        if (body?.status !== undefined && !isItemStatus(body.status)) throw new Error("Validation failed: status");
        const status = typeof body?.status === "string" ? body.status : type === "idea" || type === "note" ? "inbox" : "active";
        const created: any = await ctx.db.items.insert({
          ownerId: tok.ownerId,
          scopeKind: "personal",
          teamId: undefined,
          projectId: undefined,
          type,
          title,
          body: cleanBody(body?.body),
          status,
          priority,
          dueAt,
          repeatRule: undefined,
          streakCount: 0,
          lastCheckedAt: undefined,
          parentId: undefined,
          kanbanColumn: undefined,
          kanbanOrder: 1000,
          aiSummary: undefined,
          aiNextAction: undefined,
          mtime: t,
          deletedAt: undefined,
        });
        await ctx.db.agentTokens.update(tok.id, { lastUsedAt: t });
        return json({ item: created });
      } catch (e: any) {
        return text(e?.message ?? "Validation failed", { status: 400 });
      }
    }),

    agentItemsUpdate: endpoint({ method: "PATCH", path: "/api/agent/items" }, async (ctx, req) => {
      const authz = req.headers.get("authorization") ?? "";
      if (!authz.startsWith("Bearer planu_pat_")) return text("unauthorized", { status: 401 });
      const tokenHash = await sha256Async(authz.slice("Bearer ".length));
      const tok: any = await ctx.db.agentTokens.withIndex("by_token", (q: any) => q.eq("tokenHash", tokenHash)).first();
      if (!tok || tok.revoked || tok.expiresAt < nowMs()) return text("unauthorized", { status: 401 });
      const scopes: string[] = JSON.parse(tok.scopes ?? "[]");
      if (!scopes.includes("items:write")) return text("unauthorized", { status: 403 });
      let body: any;
      try {
        body = await req.json();
      } catch {
        return text("Validation failed: body", { status: 400 });
      }
      // REST-style id also accepted via ?id= for PATCH /api/agent/items/:id callers.
      const id = typeof body?.id === "string" && body.id ? body.id : (req.query.get("id") ?? "");
      if (!id) return text("Validation failed: id", { status: 400 });
      try {
        const row: any = await ctx.db.items.get(id);
        if (!row || row.deletedAt || row.ownerId !== tok.ownerId) return text("Not found: item", { status: 404 });
        const patch: any = { mtime: nowMs() };
        if (body?.title !== undefined) patch.title = cleanTitle(body.title);
        if (body?.body !== undefined) patch.body = cleanBody(body.body);
        if (body?.status !== undefined) {
          if (!isItemStatus(body.status)) throw new Error("Validation failed: status");
          patch.status = body.status;
        }
        if (body?.priority !== undefined) patch.priority = cleanPriority(body.priority);
        if (body?.dueAt !== undefined) patch.dueAt = body.dueAt === null ? null : cleanDueAt(body.dueAt);
        if (body?.kanbanColumn !== undefined) patch.kanbanColumn = cleanKanbanColumn(body.kanbanColumn) ?? null;
        await ctx.db.items.update(id, patch);
        await ctx.db.agentTokens.update(tok.id, { lastUsedAt: nowMs() });
        return json({ item: await ctx.db.items.get(id) });
      } catch (e: any) {
        const msg = String(e?.message ?? "rejected");
        const code = msg.startsWith("Not found") ? 404 : msg.startsWith("Access denied") ? 403 : 400;
        return text(msg, { status: code });
      }
    }),

    agentItemsDelete: endpoint({ method: "DELETE", path: "/api/agent/items" }, async (ctx, req) => {
      const authz = req.headers.get("authorization") ?? "";
      if (!authz.startsWith("Bearer planu_pat_")) return text("unauthorized", { status: 401 });
      const tokenHash = await sha256Async(authz.slice("Bearer ".length));
      const tok: any = await ctx.db.agentTokens.withIndex("by_token", (q: any) => q.eq("tokenHash", tokenHash)).first();
      if (!tok || tok.revoked || tok.expiresAt < nowMs()) return text("unauthorized", { status: 401 });
      const scopes: string[] = JSON.parse(tok.scopes ?? "[]");
      if (!scopes.includes("items:write")) return text("unauthorized", { status: 403 });
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }
      const id = typeof body?.id === "string" && body.id ? body.id : (req.query.get("id") ?? "");
      if (!id) return text("Validation failed: id", { status: 400 });
      const row: any = await ctx.db.items.get(id);
      if (!row || row.deletedAt || row.ownerId !== tok.ownerId) return text("Not found: item", { status: 404 });
      const t = nowMs();
      await ctx.db.items.update(id, { deletedAt: t, mtime: t });
      if (row.parentId) await adjustParentSummaries(ctx, row.parentId, row.status === "done" ? -1 : 0, -1);
      await ctx.db.agentTokens.update(tok.id, { lastUsedAt: t });
      return json({ ok: true });
    }),
  },
});
