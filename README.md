# Roll Game

## Local development

Use Node.js 24 or newer. From the repository root, run:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). Vite hot-reloads the React, TypeScript, and CSS in `client/`. Node watches the API in `server/` and restarts it on edits. Ctrl+C stops both processes.

The client loads `levels/test.json` through the level API at startup. Edit that file and reload the page to see the scene. Use relative `/api` URLs from the client. Vite forwards them to the Node server on `127.0.0.1:3001`.

## Controls

Press P or Esc to pause or resume. Open the level editor from the pause menu.

Move with WASD or the arrow keys. Hold Space to charge a jump and release to launch. Full charge takes 0.30 seconds.

Left-click or press F to fire at the center pip, even while moving or jumping. When the gun is ready, the four marks grow around the pip and turn pale green over a reachable gem or bright red over an exposed opponent in range. The marks spread as the shot extends. When the claw latches onto terrain or a gem, they close in and turn amber. The robot’s TV shows a crosshair while the shot is out. Both heads extend up to 540 world units from the gun mount, slow as the cable pays out, and retract automatically on a miss.

In the test arena, you have red feet and the computer rival has turquoise feet. Line up your opponent with fungus behind them. If the opponent is the first target in the shot’s path, the gun launches a boxing glove. On contact it punches them along the shot direction and retracts. The claw pulls you to terrain and reels in gems.

Both robots start with 100 HP. Living fungus drains 36 HP per second until you escape. A direct, close-range glove hit against a stationary robot deals about 30 damage. Knockback scales with closing speed along the contact normal, and damage scales with its square. Glancing hits and contacts near full extension are weaker. Moving into the glove can make a hit harder.

Each gem scores one point. In a duel, every knockout gives the opposing robot ten points, including when a robot falls into fungus on its own. The defeated robot respawns near its start after two seconds with full health. An amber shield and a BOOT readout on the TV mark 0.75 seconds of protection. If a robot has to respawn inside fungus, the countdown starts once it gets clear. When the final gem is reeled in, the higher score wins. Equal scores draw.

## Level files

Each level lives in `levels/<id>.json` and can be committed to Git. IDs start with a lowercase letter or digit and can contain lowercase letters, digits, underscores, and hyphens, up to 100 characters.

The game reads `playerStart` as an `[x, y]` pair in world units (positive Y points down). Each entry in `ground` has a `vertices` array tracing a simple polygon in either winding order. The last vertex connects to the first.

Add a `rivalStart` coordinate pair to enable a duel. Levels that omit it use the solo rules.

| Request | Result |
| --- | --- |
| `GET /api/levels` | A sorted JSON array of level IDs |
| `GET /api/levels/<id>` | The stored JSON document, or 404 if missing |
| `PUT /api/levels/<id>` | Creates or replaces the file and returns 204 |

Send a JSON object with `Content-Type: application/json` when saving (up to 4 MiB per request). The server writes indented JSON with a trailing newline and replaces the file atomically.

## Builds

`npm run typecheck` checks the client, server, and Vite config. `npm run build` also bundles the client into `dist/`. To try the build locally with persistence, run `npm run dev:server` in one terminal and `npm run preview` in another.
