# planu

AI-first productivity workspace (Lakebed capsule). See `spec.md` §15 for implementation status.

Run this Lakebed capsule:

```sh
npx lakebed dev
```

Client routes:

- `/`: Today dashboard (agenda, habits due, inbox, AI day-plan fallback).
- `/dump`: Idea Dump (sub-3s capture, Jev `routeCapture`, promote to task/habit/goal/note).
- `/notes`: Notes workspace (autosave 500ms, checkbox task extraction).
- `/goals`: Goals & milestones tree (recursive `summaries` rollups).
- `/habits`: Habit tracker (idempotent `dayKey` check-ins, streaks).
- `/boards/:projectId`: Kanban board (fractional midpoint ordering).
- `/teams/:teamId`: Team space (roles, invite links).
- `/join`: Team invite redemption (`?token=planu_inv_…`).
- `/settings/tokens`: Developer & agent API tokens (`planu_pat_…`).
- `/status`: page that calls the `GET /api/status` endpoint.

Keyboard: `Ctrl/Cmd+K` capture palette, `Ctrl/Cmd+\` split view, `Ctrl/Cmd+1..4` nav,
`J`/`K`/`X`/`E` in lists, `Space`+arrows for board cards.

Each browser session gets its own data (`ownerId: userId()`). Sign in with Google to
keep it with your account; Lakebed transfers `userId()` references on guest upgrade.
Local data resets when the dev server restarts.

```sh
curl http://localhost:3000/api/status
npx lakebed logs --port 3000
npx lakebed db dump --port 3000
```

Test tenant isolation with `?lakebed_guest=alice` vs `?lakebed_guest=bob`.

Agent API (`Authorization: Bearer planu_pat_…`, mint via `/settings/tokens`):

- `GET /api/agent/items?type=&status=&projectId=&limit=&cursorMtime=&cursorId=` → `{rows,nextCursor?}`
- `POST /api/agent/items` `{title|rawText,type,body,status,priority,dueAt}` → `{item}`
- `PATCH /api/agent/items?id=<id>` (or `{"id",…patch}`) → `{item}`
- `DELETE /api/agent/items?id=<id>` → `{ok:true}` (soft-delete, tombstoned for sync)
- `POST /api/agent/ai/triage` `{limit}` → `{triaged:[routeCapture…]}` (Jev-only)

`items_list` takes the same cursor envelope (`{limit,cursor:{mtime,id}}` →
`{rows,nextCursor?}`); the unfiltered cursor pushes an `lt/eq` range into
`by_owner_updated`. Pagination helpers live in `shared/pagination.ts`.

Lakebed reserves `createdAt`/`updatedAt` as metadata: this app stores its own
write timestamp in `mtime` and relies on implicit creation metadata (see `spec.md` §15).
No outbound `fetch` in MVP — all AI parsing is the local Jev engine (`shared/jev.ts`).
