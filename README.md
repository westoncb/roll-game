# Roll Game

## Local development

Use Node.js 24 or newer. From the repository root, run:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). Vite hot-reloads the React, TypeScript, and CSS in `client/`. Node watches the API in `server/` and restarts it on edits. Ctrl+C stops both processes.

The client loads `levels/test.json` through the level API at startup. Edit that file and reload the page to see the scene. Use relative `/api` URLs from the client. Vite forwards them to the Node server on `127.0.0.1:3001`.

## Level files

Each level lives in `levels/<id>.json` and can be committed to Git. IDs start with a lowercase letter or digit and can contain lowercase letters, digits, underscores, and hyphens, up to 100 characters.

The game reads `playerStart` as an `[x, y]` pair in world units (positive Y points down). Each entry in `ground` has a `vertices` array tracing a simple polygon in either winding order. The last vertex connects to the first. The optional `gravityScale` defaults to 1.

| Request | Result |
| --- | --- |
| `GET /api/levels` | A sorted JSON array of level IDs |
| `GET /api/levels/<id>` | The stored JSON document, or 404 if missing |
| `PUT /api/levels/<id>` | Creates or replaces the file and returns 204 |

Send a JSON object with `Content-Type: application/json` when saving (up to 4 MiB per request). The server writes indented JSON with a trailing newline and replaces the file atomically.

## Builds

`npm run typecheck` checks the client, server, and Vite config. `npm run build` also bundles the client into `dist/`. To try the build locally with persistence, run `npm run dev:server` in one terminal and `npm run preview` in another.
