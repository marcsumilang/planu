# planu

Run this Lakebed capsule:

```sh
npx lakebed dev
```

The starter app includes two client routes:

- `/`: the todo list.
- `/status`: a page that calls the `GET /api/status` endpoint.

Each browser session gets its own todo list. Sign in with Google to keep the todos with your account. If the account already has todos, Lakebed combines the lists. Guest access is lost if the browser session is cleared or expires before sign-in. Local todos reset when the dev server restarts.

The server declares `ownerId: userId()`. It gets the caller with `ctx.auth.requireIdentity()` and filters their todos by that ID. Lakebed transfers those user references after a verified guest upgrade. It does not transfer IDs stored as plain strings or guess who owns old shared guest rows.

To require sign-in before any app data access, set `auth: { requireSignIn: true }` in `server/index.ts`. The app and sign-in screen can still load. See the [auth guide](https://docs.lakebed.dev/auth/) for per-operation guards and custom merge rules.

With the default `requireSignIn: false`, you can call the endpoint directly:

```sh
curl http://localhost:3000/api/status
```

The capsule includes `favicon.svg`. Replace it, add `favicon.ico`, or set `favicon: "assets/icon.svg"` in `server/index.ts`.
