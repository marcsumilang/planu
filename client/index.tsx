import { canAccessApp, createClient, getIdentity, Link, retryAuth, Route, Router, Routes, SignInWithGoogle, signOut, useAuth } from "lakebed/client";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type app from "../server";
import { cleanTodoText } from "../shared/todo";

const client = createClient<typeof app>();

function AuthAvatar({ label, picture }: { label: string; picture?: string }) {
  const initial = label.trim().slice(0, 1).toUpperCase() || "?";

  if (picture) {
    return (
      <img
        alt=""
        className="h-7 w-7 shrink-0 rounded-full border border-neutral-800 bg-neutral-900 object-cover"
        referrerPolicy="no-referrer"
        src={picture}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-xs font-medium text-neutral-300"
    >
      {initial}
    </span>
  );
}

function TodoPage() {
  const todos = client.useQuery("todos");
  const addTodo = client.useMutation("addTodo");

  async function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const text = cleanTodoText(String(data.get("text") ?? ""));
    if (!text) {
      return;
    }

    await addTodo(text);
    form.reset();
  }

  return (
    <section>
      <h1 className="mb-8 text-5xl font-bold tracking-tight">{ "planu" }</h1>
      <form className="mb-8 flex gap-3" onSubmit={(event) => void onSubmit(event)}>
        <input className="min-w-0 flex-1 border border-neutral-700 bg-black px-3 py-2 text-white outline-none focus:border-white" name="text" placeholder="Add a todo" />
        <button className="border border-white px-4 py-2 font-medium" type="submit">Add</button>
      </form>
      <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
        {(todos ?? []).map((todo) => (
          <li className="py-3" key={todo.id}>{todo.text}</li>
        ))}
      </ul>
    </section>
  );
}

function StatusPage() {
  const [status, setStatus] = useState("not checked");

  async function checkStatus() {
    const token = getIdentity().token;
    const response = await fetch("api/status", {
      headers: token ? { "X-Lakebed-Token": token } : {}
    });
    setStatus(response.ok ? await response.text() : "error " + response.status);
  }

  return (
    <section>
      <h1 className="mb-4 text-4xl font-bold tracking-tight">Status</h1>
      <p className="mb-6 text-neutral-400">This route calls the server endpoint at /api/status.</p>
      <button className="border border-white px-4 py-2 font-medium" type="button" onClick={() => void checkStatus()}>
        Check endpoint
      </button>
      <p className="mt-4 font-mono text-sm text-neutral-400">endpoint: {status}</p>
    </section>
  );
}

function SessionGate({ children }: { children: ComponentChildren }) {
  const auth = useAuth();
  if (auth.isLoading) {
    return <p>Checking session</p>;
  }
  if (canAccessApp()) {
    return <>{children}</>;
  }
  return (
    <section>
      {auth.error ? <p role="alert">{auth.error}</p> : <p>Sign in to use this app.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {auth.error ? (
          <button className="border border-white px-4 py-2" type="button" onClick={() => void retryAuth()}>
            Retry
          </button>
        ) : null}
        <SignInWithGoogle className="border border-white px-4 py-2" />
        {!auth.requireSignIn && auth.userId === null ? (
          <button
            className="border border-white px-4 py-2"
            type="button"
            onClick={() => {
              if (window.confirm("Start a new guest session? Guest data that has not moved to an account stays inaccessible.")) {
                void signOut();
              }
            }}
          >
            Start a new guest session
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function App() {
  const auth = useAuth();
  const authLabel = auth.displayName;
  const authStatus = auth.isLoading
    ? "Checking session"
    : auth.isSignedIn
      ? "Signed in as " + authLabel
      : auth.isGuest
        ? "Using this browser"
        : "Signed out";

  return (
    <Router>
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <section className="mx-auto max-w-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {auth.isSignedIn ? <AuthAvatar label={authLabel} picture={auth.picture} /> : null}
              <p className="min-w-0 truncate font-mono text-sm">{authStatus}</p>
            </div>
            {auth.isSignedIn ? (
              <button className="shrink-0 text-sm text-neutral-400 hover:text-white" type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            ) : auth.isGuest ? (
              <SignInWithGoogle className="shrink-0 border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-200 hover:border-white hover:text-white" />
            ) : null}
          </div>
          {auth.isGuest ? (
            <p className="mb-6 text-sm">Sign in to keep your todos. Clearing browser data ends guest access.</p>
          ) : null}
          <nav className="mb-8 flex gap-4 text-sm text-neutral-400">
            <Link className="hover:text-white" to="/">Todos</Link>
            <Link className="hover:text-white" to="/status">Status</Link>
          </nav>
          <SessionGate>
            <Routes>
              <Route path="/" element={<TodoPage />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="*" element={<section><h1 className="mb-4 text-4xl font-bold">Not found</h1><Link className="text-neutral-300 hover:text-white" to="/">Back to todos</Link></section>} />
            </Routes>
          </SessionGate>
        </section>
      </main>
    </Router>
  );
}
