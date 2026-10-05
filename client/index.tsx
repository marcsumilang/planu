import {
  canAccessApp,
  createClient,
  getIdentity,
  Link,
  retryAuth,
  Route,
  Router,
  Routes,
  SignInWithGoogle,
  signOut,
  useAuth,
  useParams,
} from "lakebed/client";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type app from "../server/index";
import { extractTasksFromMarkdown, routeCapture } from "../shared/jev";
import { dayKeyFromMs } from "../shared/habits";

const client = createClient<typeof app>();

type PaneSpec = string;

function getQueryParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function setQueryParamsMerge(patch: Record<string, string | null>): void {
  const sp = getQueryParams();
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) sp.delete(k);
    else sp.set(k, v);
  }
  const qs = sp.toString();
  window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
}

function parsePanes(): { left: PaneSpec | null; right: PaneSpec | null } {
  const sp = getQueryParams();
  return { left: sp.get("left"), right: sp.get("right") };
}

function PriorityBadge({ p }: { p: number }) {
  const label = p === 1 ? "P1" : p === 3 ? "P3" : "P2";
  const cls =
    p === 1 ? "bg-red-950 text-red-300 border-red-800" : p === 3 ? "bg-neutral-900 text-neutral-400 border-neutral-700" : "bg-blue-950 text-blue-300 border-blue-800";
  return <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] ${cls}`}>{label}</span>;
}

function DueBadge({ dueAt }: { dueAt?: number }) {
  if (!dueAt) return null;
  const overdue = dueAt < Date.now();
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] ${overdue ? "border-amber-700 bg-amber-950 text-amber-300" : "border-neutral-700 bg-neutral-900 text-neutral-300"}`}>
      {new Date(dueAt).toLocaleDateString()}
    </span>
  );
}

function QuickCapturePalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createItem = client.useMutation("items_create");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (text.trim() ? routeCapture(text, Date.now()) : null), [text]);

  useEffect(() => {
    if (open) {
      setText("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose ]);

  if (!open) return null;

  async function submit(e?: Event) {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createItem({ rawText: text.slice(0, 2000) });
      setText("");
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Capture failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Quick capture">
      <div className="w-full max-w-xl rounded-lg border border-neutral-700 bg-neutral-950 p-4 shadow-2xl">
        <form onSubmit={(e) => void submit(e)}>
          <input
            ref={inputRef}
            className="w-full border border-neutral-700 bg-black px-3 py-2 text-white outline-none focus:border-white"
            placeholder="Capture: Draft report @Finance !p1 due:friday #tags type:task"
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="font-mono text-xs text-neutral-400">
              {preview ? `${preview.type} · p${preview.priority}${preview.dueAt ? " · " + new Date(preview.dueAt).toLocaleDateString() : ""}${preview.projectName ? " · @" + preview.projectName : ""} · ${(preview.confidence * 100).toFixed(0)}%` : "Jev parses locally, no network needed"}
            </p>
            <div className="flex gap-2">
              <button type="button" className="border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300" onClick={onClose}>Esc</button>
              <button type="submit" className="border border-white px-3 py-1.5 text-sm font-medium" disabled={busy}>Capture</button>
            </div>
          </div>
        </form>
        {error ? <p role="alert" className="mt-2 text-sm text-red-400">{error}</p> : null}
        <p className="mt-2 text-xs text-neutral-500">Syntax: @project !p1 !p2 !p3 due:tomorrow due:friday due:2026-12-01 #tag type:habit</p>
      </div>
    </div>
  );
}

function TodayPage() {
  const data = client.useQuery("today");
  const setStatus = client.useMutation("items_setStatus");
  const toggleCheckin = client.useMutation("checkin_toggle");
  const [selected, setSelected] = useState(0);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...(data.dueTasks ?? []), ...(data.habitsDue ?? []).slice(0, 10)];
  }, [data ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "j" || e.key === "J" || e.key === "k" || e.key === "K") {
        if (rows.length === 0) return;
        setSelected((s) => (e.key.toLowerCase() === "j" ? Math.min(rows.length - 1, s + 1) : Math.max(0, s - 1)));
      } else if ((e.key === "x" || e.key === "X") && rows[selected]) {
        const it: any = rows[selected];
        void setStatus({ id: it.id, status: it.status === "done" ? "active" : "done" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected, setStatus ]);

  if (data === undefined) return <p className="text-neutral-400">Loading today…</p>;

  async function checkHabit(id: string) {
    const at = Date.now();
    await toggleCheckin({ itemId: id, dayKey: dayKeyFromMs(at), at });
  }

  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Today</h1>
      <p className="mb-4 text-sm text-neutral-400">{data.plan.summary}</p>
      {data.plan.schedule.length > 0 ? (
        <ol className="mb-6 divide-y divide-neutral-800 border-y border-neutral-800">
          {data.plan.schedule.map((s: any) => (
            <li key={s.itemId} className="py-2 font-mono text-sm text-neutral-300">
              <span className="mr-3 text-neutral-500">{s.timeSlot}</span>{s.reason}
            </li>
          ))}
        </ol>
      ) : null}
      <h2 className="mb-2 text-lg font-semibold">Due & habits ({rows.length})</h2>
      {rows.length === 0 ? <p className="text-sm text-neutral-500">No due items. Capture with Ctrl+K.</p> : (
        <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
          {rows.map((it: any, i: number) => (
            <li key={it.id} className={`flex items-center gap-3 py-2 ${i === selected ? "bg-neutral-900" : ""}`}>
              <span className="font-mono text-xs text-neutral-600">{i === selected ? ">" : " "}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{it.title}</p>
                <p className="font-mono text-xs text-neutral-500">{it.type} · {it.status}</p>
              </div>
              <PriorityBadge p={it.priority ?? 2} />
              <DueBadge dueAt={it.dueAt} />
              {it.type === "habit" ? (
                <button className="border border-green-700 px-2 py-1 text-xs text-green-300" type="button" onClick={() => void checkHabit(it.id)}>Check in{typeof it.streakCount === "number" && it.streakCount > 0 ? ` (${it.streakCount})` : ""}</button>
              ) : (
                <button className="border border-neutral-700 px-2 py-1 text-xs text-neutral-200" type="button" onClick={() => void setStatus({ id: it.id, status: it.status === "done" ? "active" : "done" })}>{it.status === "done" ? "Reopen" : "Done"}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <h2 className="mb-2 mt-6 text-lg font-semibold">Inbox ({data.inboxCount})</h2>
      <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
        {(data.inbox ?? []).slice(0, 10).map((it: any) => (
          <li key={it.id} className="py-2 text-sm text-neutral-300">{it.title}</li>
        ))}
      </ul>
    </section>
  );
}

function DumpPage() {
  const inboxRes = client.useQuery("items_list", { status: "inbox", limit: 100 });
  const createItem = client.useMutation("items_create");
  const promote = client.useMutation("promoteIdea");
  const setStatus = client.useMutation("items_setStatus");
  const del = client.useMutation("items_delete");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const rows = inboxRes?.rows ?? [];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "j" || e.key === "J") setSelected((s) => Math.min(rows.length - 1, s + 1));
      else if (e.key === "k" || e.key === "K") setSelected((s) => Math.max(0, s - 1));
      else if ((e.key === "x" || e.key === "X") && rows[selected]) {
        void setStatus({ id: rows[selected].id, status: "done" });
      } else if ((e.key === "e" || e.key === "E") && rows[selected]) {
        document.getElementById(`dump-title-${rows[selected].id}`)?.scrollIntoView({ block: "nearest" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, selected, setStatus ]);

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      await createItem({ rawText: text.slice(0, 2000) });
      setText("");
    } catch (err: any) {
      setError(err?.message ?? "Capture failed");
    }
  }

  if (inboxRes === undefined) return <p className="text-neutral-400">Loading inbox…</p>;

  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Idea Dump</h1>
      <p className="mb-4 text-sm text-neutral-400">Capture in under 3 seconds. J/K move, X completes, E jumps to item.</p>
      <form className="mb-4 flex gap-3" onSubmit={(e) => void onSubmit(e)}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-white outline-none focus:border-white" value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="Draft report @Finance !p1 due:friday" />
        <button className="border border-white px-4 py-2 font-medium" type="submit">Dump</button>
      </form>
      {error ? <p role="alert" className="mb-3 text-sm text-red-400">{error}</p> : null}
      {rows.length === 0 ? <p className="text-sm text-neutral-500">Capture your first idea (Ctrl+K).</p> : (
        <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
          {rows.map((it: any, i: number) => (
            <li key={it.id} className={`py-3 ${i === selected ? "bg-neutral-900" : ""}`}>
              <p id={`dump-title-${it.id}`} className="text-sm text-white">{it.title}</p>
              <p className="mt-1 font-mono text-xs text-neutral-500">{it.type} · {it.status}{it.dueAt ? " · " + new Date(it.dueAt).toLocaleDateString() : ""}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["task", "habit", "goal", "note"] as const).map((t) => (
                  <button key={t} type="button" className="border border-neutral-700 px-2 py-1 text-xs text-neutral-200 hover:border-white" onClick={() => void promote({ id: it.id, newType: t })}>To {t}</button>
                ))}
                <button type="button" className="border border-neutral-700 px-2 py-1 text-xs text-neutral-400" onClick={() => void setStatus({ id: it.id, status: "archived" })}>Archive</button>
                <button type="button" className="border border-red-900 px-2 py-1 text-xs text-red-300" onClick={() => void del({ id: it.id })}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NotesPage() {
  const notesRes = client.useQuery("items_list", { type: "note", limit: 50 });
  const createItem = client.useMutation("items_create");
  const updateItem = client.useMutation("items_update");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [saved, setSaved] = useState("");
  const notes = notesRes?.rows ?? [];
  const active = notes.find((n: any) => n.id === activeId) ?? notes[0] ?? null;

  useEffect(() => {
    if (active) {
      setTitle(active.title ?? "");
      setDraft(active.body ?? "");
    }
  }, [active?.id]);

  useEffect(() => {
    if (!active) return;
    if (title === (active.title ?? "") && draft === (active.body ?? "")) return;
    const h = setTimeout(() => {
      void (async () => {
        try {
          if (title !== active.title && title.trim()) await updateItem({ id: active.id, title: title.slice(0, 160) });
          if (draft !== (active.body ?? "")) await updateItem({ id: active.id, body: draft.slice(0, 20000) });
          setSaved(new Date().toLocaleTimeString());
        } catch {
          // keep draft in form state on failure
        }
      })();
    }, 500);
    return () => clearTimeout(h);
  }, [title, draft, active?.id ]);

  async function makeNote(e: SubmitEvent) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const t = String(data.get("title") ?? "").trim() || "Untitled note";
    const created: any = await createItem({ title: t.slice(0, 160), type: "note", body: "" });
    const item = (created as any)?.item ?? created;
    if (item?.id) setActiveId(item.id);
    form.reset();
  }

  async function extractTasks() {
    if (!active) return;
    const found = extractTasksFromMarkdown(draft);
    for (const t of found.tasks.slice(0, 10)) {
      await createItem({ title: t.title, type: "task", parentId: undefined });
    }
  }

  if (notesRes === undefined) return <p className="text-neutral-400">Loading notes…</p>;

  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Notes</h1>
      <form className="mb-4 flex gap-2" onSubmit={(e) => void makeNote(e)}>
        <input name="title" className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-white outline-none focus:border-white" placeholder="New note title" />
        <button className="border border-white px-3 py-2 text-sm" type="submit">New</button>
      </form>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
          {notes.map((n: any) => (
            <li key={n.id}>
              <button type="button" onClick={() => setActiveId(n.id)} className={`block w-full truncate px-2 py-2 text-left text-sm ${active?.id === n.id ? "bg-neutral-900 text-white" : "text-neutral-300"}`}>{n.title}</button>
            </li>
          ))}
        </ul>
        <div>
          {!active ? <p className="text-sm text-neutral-500">No notes yet.</p> : (
            <>
              <input className="mb-2 w-full border border-neutral-700 bg-black px-3 py-2 text-white outline-none focus:border-white" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
              <textarea className="h-64 w-full border border-neutral-700 bg-black px-3 py-2 font-mono text-sm text-white outline-none focus:border-white" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} placeholder="Markdown-lite. - [ ] tasks extract below." />
              <div className="mt-2 flex items-center gap-3">
                <button type="button" className="border border-neutral-700 px-3 py-1.5 text-sm" onClick={() => void extractTasks()}>Extract tasks</button>
                {saved ? <span className="font-mono text-xs text-neutral-500">saved {saved}</span> : <span className="font-mono text-xs text-neutral-600">autosave 500ms</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function GoalNode({ id, depth }: { id: string; depth: number }) {
  const item = client.useQuery("items_get", { id });
  const childrenRes = client.useQuery("items_list", { limit: 100 });
  const setStatus = client.useMutation("items_setStatus");
  const createItem = client.useMutation("items_create");
  const [childTitle, setChildTitle] = useState("");
  if (item === undefined) return <p className="font-mono text-xs text-neutral-600">…</p>;
  if (item === null) return null;
  const it: any = item;
  const kids = ((childrenRes?.rows ?? []) as any[]).filter((c) => c.parentId === id && !c.deletedAt);
  return (
    <div className="border-l border-neutral-800 pl-3" style={{ marginLeft: depth * 8 }}>
      <div className="flex items-center gap-2 py-1">
        <span className="font-mono text-[11px] text-neutral-500">{it.type}</span>
        <span className={`text-sm ${it.status === "done" ? "text-neutral-500 line-through" : "text-white"}`}>{it.title}</span>
        <button type="button" className="border border-neutral-700 px-1.5 py-0.5 text-[11px] text-neutral-300" onClick={() => void setStatus({ id, status: it.status === "done" ? "active" : "done" })}>{it.status === "done" ? "Reopen" : "Done"}</button>
      </div>
      {kids.map((k) => <GoalNode key={k.id} id={k.id} depth={depth + 1} />)}
      {depth < 2 ? (
        <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!childTitle.trim()) return; void createItem({ title: childTitle.slice(0, 160), type: depth === 0 ? "milestone" : "task", parentId: id }).then(() => setChildTitle("")); }}>
          <input className="min-w-0 flex-1 border border-neutral-800 bg-black px-2 py-1 text-xs text-white outline-none" value={childTitle} onInput={(e) => setChildTitle(e.currentTarget.value)} placeholder={depth === 0 ? "New milestone" : "New task"} />
          <button className="border border-neutral-700 px-2 py-1 text-[11px]" type="submit">Add</button>
        </form>
      ) : null}
    </div>
  );
}

function GoalsPage() {
  const goalsRes = client.useQuery("items_list", { type: "goal", limit: 50 });
  const createItem = client.useMutation("items_create");
  const [title, setTitle] = useState("");
  if (goalsRes === undefined) return <p className="text-neutral-400">Loading goals…</p>;
  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Goals</h1>
      <p className="mb-4 text-sm text-neutral-400">Goal → milestone → task. Progress comes from summary rows, never table scans.</p>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; void createItem({ title: title.slice(0, 160), type: "goal" }).then(() => setTitle("")); }}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-white outline-none focus:border-white" value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="New goal" />
        <button className="border border-white px-3 py-2 text-sm" type="submit">Add goal</button>
      </form>
      <div className="space-y-4">
        {(goalsRes.rows ?? []).filter((g: any) => !g.deletedAt).map((g: any) => <GoalNode key={g.id} id={g.id} depth={0} />)}
      </div>
    </section>
  );
}

function HabitsPage() {
  const habitsRes = client.useQuery("items_list", { type: "habit", limit: 50 });
  const createItem = client.useMutation("items_create");
  const toggle = client.useMutation("checkin_toggle");
  const updateItem = client.useMutation("items_update");
  const [title, setTitle] = useState("");
  const [rule, setRule] = useState("daily");
  if (habitsRes === undefined) return <p className="text-neutral-400">Loading habits…</p>;
  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Habits</h1>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; void createItem({ title: title.slice(0, 160), type: "habit", repeatRule: rule }).then(() => setTitle("")); }}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-white outline-none focus:border-white" value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="New habit" />
        <select className="border border-neutral-700 bg-black px-2 py-2 text-sm text-white" value={rule} onChange={(e) => setRule(e.currentTarget.value)}>
          <option value="daily">daily</option>
          <option value="weekdays">weekdays</option>
          <option value="weekly:mon,thu">weekly:mon,thu</option>
        </select>
        <button className="border border-white px-3 py-2 text-sm" type="submit">Add</button>
      </form>
      <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
        {(habitsRes.rows ?? []).filter((h: any) => !h.deletedAt).map((h: any) => (
          <li key={h.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white">{h.title}</p>
              <p className="font-mono text-xs text-neutral-500">streak {h.streakCount ?? 0} · {h.repeatRule ?? "daily"}</p>
            </div>
            <select className="border border-neutral-800 bg-black px-1 py-1 font-mono text-xs text-neutral-300" value={h.repeatRule ?? "daily"} onChange={(e) => void updateItem({ id: h.id, repeatRule: e.currentTarget.value })}>
              <option value="daily">daily</option>
              <option value="weekdays">weekdays</option>
              <option value="weekly:mon,thu">weekly:mon,thu</option>
            </select>
            <button type="button" className="border border-green-700 px-3 py-1.5 text-sm text-green-300" onClick={() => { const at = Date.now(); void toggle({ itemId: h.id, dayKey: dayKeyFromMs(at), at }); }}>Check in</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BoardView({ projectId }: { projectId: string }) {
  const cardsRes = client.useQuery("items_list", { projectId, limit: 100 });
  const move = client.useMutation("card_move");
  const createItem = client.useMutation("items_create");
  const setStatus = client.useMutation("items_setStatus");
  const [title, setTitle] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [grabId, setGrabId] = useState<string | null>(null);
  const cols = ["todo", "doing", "done"];
  const list = ((cardsRes?.rows ?? []) as any[]).filter((c) => !c.deletedAt);

  function cardsIn(col: string) {
    return list.filter((c) => (c.kanbanColumn ?? "todo") === col).sort((a, b) => (a.kanbanOrder ?? 1000) - (b.kanbanOrder ?? 1000));
  }

  async function dropOn(col: string, target?: any) {
    if (!dragId && !grabId) return;
    const id = (dragId ?? grabId) as string;
    const colCards = cardsIn(col).filter((c) => c.id !== id);
    let prev: number | undefined;
    let next: number | undefined;
    if (!target) {
      prev = colCards.length > 0 ? colCards[colCards.length - 1].kanbanOrder : undefined;
    } else {
      const idx = colCards.findIndex((c) => c.id === target.id);
      next = target.kanbanOrder;
      prev = idx > 0 ? colCards[idx - 1].kanbanOrder : undefined;
    }
    await move({ id, toColumn: col, prevOrder: prev, nextOrder: next });
    setDragId(null);
    setGrabId(null);
  }

  if (cardsRes === undefined) return <p className="text-neutral-400">Loading board…</p>;

  return (
    <div>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; void createItem({ title: title.slice(0, 160), type: "task", projectId, kanbanColumn: "todo" }).then(() => setTitle("")); }}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-white" value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="New card" />
        <button className="border border-white px-3 py-2 text-sm" type="submit">Add card</button>
      </form>
      <div className="grid gap-3 md:grid-cols-3">
        {cols.map((col) => (
          <div key={col} className="rounded border border-neutral-800 bg-neutral-950 p-2" onDragOver={(e) => e.preventDefault()} onDrop={() => void dropOn(col)}>
            <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-neutral-400">{col} ({cardsIn(col).length})</h3>
            <div className="space-y-2">
              {cardsIn(col).map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => setDragId(c.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.stopPropagation(); void dropOn(col, c); }}
                  className={`rounded border p-2 ${grabId === c.id ? "border-yellow-500" : "border-neutral-700"} bg-black`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") { e.preventDefault(); setGrabId(grabId === c.id ? null : c.id); }
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      const i = cols.indexOf(col);
                      const nc = cols[i + (e.key === "ArrowRight" ? 1 : -1)];
                      if (nc && grabId === c.id) { e.preventDefault(); void dropOn(nc); }
                    }
                  }}
                >
                  <p className="text-sm text-white">{c.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <PriorityBadge p={c.priority ?? 2} />
                    <DueBadge dueAt={c.dueAt} />
                    <span className="font-mono text-[11px] text-neutral-600">{c.kanbanOrder ?? 1000}</span>
                  </div>
                  <div className="mt-1 flex gap-2">
                    <button type="button" className="text-[11px] text-neutral-400 hover:text-white" onClick={() => void setStatus({ id: c.id, status: c.status === "done" ? "active" : "done" })}>Toggle done</button>
                    <span className="font-mono text-[10px] text-neutral-600">Space grab, arrows move</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects = client.useQuery("projects_list");
  const createProject = client.useMutation("project_create");
  const [name, setName] = useState("");
  if (projects === undefined) return <p className="text-neutral-400">Loading boards…</p>;
  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Boards</h1>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void createProject({ name: name.slice(0, 80) }).then(() => setName("")); }}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-sm text-white outline-none focus:border-white" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="New project (e.g. Finance)" />
        <button className="border border-white px-3 py-2 text-sm" type="submit">Create</button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2">
        {((projects ?? []) as any[]).map((p) => (
          <Link key={p.id} to={`/boards/${p.id}`} className={`border px-3 py-1.5 text-sm ${projectId === p.id ? "border-white text-white" : "border-neutral-700 text-neutral-300"}`}>{p.name}</Link>
        ))}
      </div>
      {!projectId ? <p className="text-sm text-neutral-500">Select a board. Capture with @ProjectName to auto-attach.</p> : <BoardView projectId={projectId} />}
    </section>
  );
}

function TeamsPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const teams = client.useQuery("teams_list");
  const createTeam = client.useMutation("team_create");
  const createInvite = client.useMutation("team_invite_create");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  if (teams === undefined) return <p className="text-neutral-400">Loading teams…</p>;
  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Teams</h1>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void createTeam({ name: name.slice(0, 80) }).then(() => setName("")); }}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-sm text-white outline-none" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="New team" />
        <button className="border border-white px-3 py-2 text-sm" type="submit">Create</button>
      </form>
      <div className="mb-3 flex flex-wrap gap-2">
        {(teams ?? []).map((t: any) => (
          <Link key={t.id} to={`/teams/${t.id}`} className={`border px-3 py-1.5 text-sm ${teamId === t.id ? "border-white text-white" : "border-neutral-700 text-neutral-300"}`}>{t.name} ({t.role})</Link>
        ))}
      </div>
      {teamId ? (
        <button type="button" className="border border-neutral-700 px-3 py-1.5 text-sm" onClick={() => void createInvite({ teamId }).then((r: any) => setInvite(`${window.location.origin}/join?token=${r.token}`))}>Create invite link</button>
      ) : <p className="text-sm text-neutral-500">Select a team to invite.</p>}
      {invite ? <p className="mt-2 break-all font-mono text-xs text-green-300">{invite}</p> : null}
    </section>
  );
}

function JoinPage() {
  const redeem = client.useMutation("team_invite_redeem");
  const [token, setToken] = useState(() => getQueryParams().get("token") ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Join team</h1>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setMsg(null); void redeem({ token }).then((r: any) => setMsg(`Joined team ${r.teamId} as ${r.role}`)).catch((err: any) => setMsg(err?.message ?? "Redeem failed")); }}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 font-mono text-sm text-white" value={token} onInput={(e) => setToken(e.currentTarget.value)} placeholder="planu_inv_…" />
        <button className="border border-white px-3 py-2 text-sm" type="submit">Redeem</button>
      </form>
      {msg ? <p className="mt-2 font-mono text-sm text-neutral-300">{msg}</p> : null}
    </section>
  );
}

function TokensPage() {
  const create = client.useMutation("agentToken_create");
  const revoke = client.useMutation("agentToken_revoke");
  const [name, setName] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState("");
  return (
    <section>
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Agent tokens</h1>
      <p className="mb-3 text-sm text-neutral-400">Bearer planu_pat_… for /api/agent/* . Raw secret shown once, only SHA-256 stored.</p>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void create({ name: name || "cli", scopes: ["items:read", "items:write", "ai:execute"] }).then((r: any) => { setLast(r.token); setName(""); }); }}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-sm text-white" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Token name" />
        <button className="border border-white px-3 py-2 text-sm" type="submit">Create</button>
      </form>
      {last ? <p className="break-all border border-green-800 bg-green-950 p-2 font-mono text-xs text-green-300">{last}</p> : null}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (revokeId) void revoke({ id: revokeId }).then(() => setRevokeId("")); }}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 font-mono text-sm text-white" value={revokeId} onInput={(e) => setRevokeId(e.currentTarget.value)} placeholder="Token row id to revoke" />
        <button className="border border-red-800 px-3 py-2 text-sm text-red-300" type="submit">Revoke</button>
      </form>
    </section>
  );
}

function StatusPage() {
  const [status, setStatus] = useState("not checked");
  async function checkStatus() {
    const token = getIdentity().token;
    const response = await fetch("api/status", { headers: token ? { "X-Lakebed-Token": token } : {} });
    setStatus(response.ok ? await response.text() : "error " + response.status);
  }
  return (
    <section>
      <h1 className="mb-4 text-4xl font-bold tracking-tight">Status</h1>
      <button className="border border-white px-4 py-2 font-medium" type="button" onClick={() => void checkStatus()}>Check endpoint</button>
      <p className="mt-4 font-mono text-sm text-neutral-400">endpoint: {status}</p>
    </section>
  );
}

function PaneRenderer({ spec }: { spec: PaneSpec }) {
  if (spec === "personal:today") return <TodayPage />;
  if (spec === "personal:dump") return <DumpPage />;
  if (spec.startsWith("board:")) return <BoardView projectId={spec.slice("board:".length)} />;
  if (spec.startsWith("item:")) return <NoteDetail id={spec.slice("item:".length)} />;
  if (spec.startsWith("team:")) return <p className="text-sm text-neutral-400">Team pane {spec} — open /teams/* for full view.</p>;
  return <p className="font-mono text-sm text-neutral-500">Unknown pane: {spec}</p>;
}

function NoteDetail({ id }: { id: string }) {
  const item = client.useQuery("items_get", { id });
  if (item === undefined) return <p className="text-neutral-400">Loading…</p>;
  if (item === null) return <p className="text-neutral-500">Not found.</p>;
  const it: any = item;
  return (
    <div>
      <h2 className="text-2xl font-bold">{it.title}</h2>
      <p className="mt-1 font-mono text-xs text-neutral-500">{it.type} · {it.status}</p>
      <pre className="mt-3 whitespace-pre-wrap font-mono text-sm text-neutral-300">{it.body ?? ""}</pre>
    </div>
  );
}

function SessionGate({ children }: { children: ComponentChildren }) {
  const auth = useAuth();
  if (auth.isLoading) return <p>Checking session</p>;
  if (canAccessApp()) return <>{children}</>;
  return (
    <section>
      {auth.error ? <p role="alert">{auth.error}</p> : <p>Sign in to use this app.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {auth.error ? <button className="border border-white px-4 py-2" type="button" onClick={() => void retryAuth()}>Retry</button> : null}
        <SignInWithGoogle className="border border-white px-4 py-2" />
        {!auth.requireSignIn && auth.userId === null ? (
          <button className="border border-white px-4 py-2" type="button" onClick={() => { if (window.confirm("Start a new guest session? Guest data that has not moved to an account stays inaccessible.")) void signOut(); }}>Start a new guest session</button>
        ) : null}
      </div>
    </section>
  );
}

export function App() {
  const auth = useAuth();
  const [palette, setPalette] = useState(false);
  const [splitTick, setSplitTick] = useState(0);
  const panes = parsePanes();
  const splitOn = Boolean(panes.left || panes.right);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((v) => !v); }
      else if (mod && e.key === "\\") {
        e.preventDefault();
        if (splitOn) { setQueryParamsMerge({ left: null, right: null }); }
        else { setQueryParamsMerge({ left: "personal:today", right: "personal:dump" }); }
        setSplitTick((t) => t + 1);
      } else if (mod && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const paths = ["/", "/dump", "/boards", "/goals"];
        window.history.pushState(null, "", paths[Number(e.key) - 1] + window.location.search);
        window.dispatchEvent(new PopStateEvent("popstate"));
        window.location.pathname = paths[Number(e.key) - 1];
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [splitOn ]);

  const authLabel = auth.displayName;
  const authStatus = auth.isLoading ? "Checking session" : auth.isSignedIn ? "Signed in as " + authLabel : auth.isGuest ? "Using this browser" : "Signed out";

  return (
    <Router>
      <QuickCapturePalette open={palette} onClose={() => setPalette(false)} />
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <section className="mx-auto max-w-5xl" key={splitTick}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate font-mono text-sm">{authStatus}</p>
            {auth.isSignedIn ? <button className="shrink-0 text-sm text-neutral-400 hover:text-white" type="button" onClick={() => void signOut()}>Sign out</button>
              : auth.isGuest ? <SignInWithGoogle className="shrink-0 border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-200 hover:border-white hover:text-white" /> : null}
          </div>
          <nav className="mb-8 flex flex-wrap gap-4 text-sm text-neutral-400">
            <Link className="hover:text-white" to="/">Today</Link>
            <Link className="hover:text-white" to="/dump">Dump</Link>
            <Link className="hover:text-white" to="/notes">Notes</Link>
            <Link className="hover:text-white" to="/goals">Goals</Link>
            <Link className="hover:text-white" to="/habits">Habits</Link>
            <Link className="hover:text-white" to="/boards">Boards</Link>
            <Link className="hover:text-white" to="/status">Status</Link>
            <button type="button" className="hover:text-white" onClick={() => { if (splitOn) setQueryParamsMerge({ left: null, right: null }); else setQueryParamsMerge({ left: "personal:today", right: "personal:dump" }); setSplitTick((t) => t + 1); }}>Split (Ctrl+\\)</button>
            <button type="button" className="hover:text-white" onClick={() => setPalette(true)}>Capture (Ctrl+K)</button>
          </nav>
          <SessionGate>
            {splitOn ? (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded border border-neutral-800 p-4">{panes.left ? <PaneRenderer spec={panes.left} /> : <p className="text-sm text-neutral-500">No left pane</p>}</div>
                <div className="rounded border border-neutral-800 p-4">{panes.right ? <PaneRenderer spec={panes.right} /> : <p className="text-sm text-neutral-500">No right pane</p>}</div>
              </div>
            ) : (
              <Routes>
                <Route path="/" element={<TodayPage />} />
                <Route path="/dump" element={<DumpPage />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/goals" element={<GoalsPage />} />
                <Route path="/habits" element={<HabitsPage />} />
                <Route path="/boards" element={<BoardsPage />} />
                <Route path="/boards/:projectId" element={<BoardsPage />} />
                <Route path="/teams/:teamId" element={<TeamsPage />} />
                <Route path="/teams" element={<TeamsPage />} />
                <Route path="/join" element={<JoinPage />} />
                <Route path="/settings/tokens" element={<TokensPage />} />
                <Route path="/status" element={<StatusPage />} />
                <Route path="*" element={<section><h1 className="mb-4 text-4xl font-bold">Not found</h1><Link className="text-neutral-300 hover:text-white" to="/">Back to today</Link></section>} />
              </Routes>
            )}
          </SessionGate>
        </section>
      </main>
    </Router>
  );
}
