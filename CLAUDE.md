# Gravity SandBox — project notes for Claude

First-person gravity + telekinesis sandbox, a static web app (PWA) for desktop browsers. English UI.
Hosting: Netlify (static, this folder is the site root). Backend: Supabase project `gravity-sanbox`
(ref `mhtxnmknuexraimyrjtq`, region eu-central-1). No build step: plain ES modules + an import map in `index.html`.

## Decisions agreed with the owner
- Sandbox, no levels. 4 default maps: The Lab + The Apartment (closed rooms), The Yard + The Atrium (open sky with an invisible ceiling/walls from `map.bounds`).
- Unlimited private maps from Build Map (spawn, delete, move, rotate, scale + static/dynamic switch), test in singleplayer, save to account, share by secret link or with friends.
- Max 100 dynamic objects per map, max 5 players per room, realistic gravity is the priority.
- Powers (keys 1–7): object gravity, area scan, world gravity, body gravity (wall walking; turn speed scales with gravity strength), bubbles (no gravity of their own, drift when hit), attraction (F = G·m1·m2/d²), telekinesis (hold, throw, push, pull, rotate, crush/expand = resize, mass follows volume). Telekinesis limit 350 kg effective weight (`TK_LIMIT_KG`).
- Everyone in a room can use every power, telekinesis works on players (they ragdoll).
- Colored mannequin ragdolls for players. Small chat bottom-left. Guests can play singleplayer without an account.
- Help: How to play page, first-time tips, guided tutorial in The Lab (`js/ui/help.js`, `js/ui/tutorial.js`).
- Visual style: clean flat-shaded low-poly, procedural grid materials, soft sky, navy/orange/cyan accents, no particles.

## Architecture
- `lib/`: three.js r170 (minified), Rapier 3D compat build (0.19.x, from lo-th/phy), BufferGeometryUtils. Supabase JS is loaded from jsDelivr (`@supabase/supabase-js@2.45.4`) dynamically; if it fails the game runs offline (singleplayer).
- `js/physics/sim.js`: authoritative simulation. Rapier's own gravity is 0; every fixed step (120 Hz) computes gravity per body: object override > bubble > world, plus attraction and telekinesis forces. All world changes go through `Sim.command(slot, cmd)`.
- `js/game.js`: session modes `solo`, `host` (runs Sim) and `client` (mirror world with kinematic bodies driven by snapshots, 100 ms interpolation).
- Multiplayer: Supabase Realtime only for signaling/presence (`js/net/room.js`, `js/net/social.js`); gameplay over WebRTC data channels (reliable JSON + unreliable Float32 snapshots at 20 Hz). Free Realtime limit is 100 msg/s for the whole project, so never route gameplay through Supabase. Host keeps ticking via a worker timer when its tab is hidden.
- `js/player/controller.js`: kinematic capsule with its own up-frame (Rapier character controller) + depenetration after rotating.
- Database schema + RLS: `supabase/schema.sql` (tables profiles, friendships, maps, map_links, map_shares; helpers in schema `private`; `get_map_by_token` RPC for link sharing). Auto-expose of new tables is OFF: grant explicitly. Later changes live in `supabase/migrations/` (additive only).
- Feedback: `public.feedback` (migration `20261106_feedback.sql`). anon + authenticated may only INSERT `message` (5–1000 chars, not blank) and `category` (`bug`/`idea`/`altro`); insert-only RLS policies requiring `status = 'new'` and empty `result_note`/`pr_url`/`handled_at`; no SELECT/UPDATE/DELETE for players. Trigger `private.feedback_rate_limit` (security definer, `search_path = ''`, advisory lock) rejects inserts once 30 arrived in the last 60 min (error `feedback_rate_limited`). Processing later needs a server-side key, never the public one.
- Feedback UI: `js/ui/feedback.js` (main menu link + pause menu button), `sendFeedback()` in `js/net/supa.js` (insert only, never `.select()`), honeypot field, 20 s client cooldown. `Input.suspend(on)` in `js/core/input.js` makes the game ignore keys/mouse and releases pointer lock while a form is open.

## Desktop app (`desktop/`)
- Electron wrapper, no changes to the game code needed: `desktop/main.js` serves the site folder on the private scheme `app://gravity/` (SPA fallback like `_redirects`) and rewrites `index.html` to use bundled copies of Supabase JS and the fonts (`desktop/scripts/vendor.mjs` → `desktop/vendor/`, generated, gitignored). Service worker is skipped (only registers on https).
- Links/auth redirects use `PUBLIC_URL` from `js/config.js` (= page origin on the web, `SITE_URL` in the app). Never use `location.origin` for shareable links.
- Builds via GitHub Actions (`.github/workflows/desktop.yml`): windows-latest (NSIS + zip) and ubuntu-latest (AppImage); runs on PRs touching `desktop/`, on demand (workflow_dispatch) and on `v*` tags, where a separate job publishes one Release with fixed file names `GravitySandBox-Setup.exe`, `GravitySandBox-Windows.zip`, `GravitySandBox-Linux.AppImage`. No Mac build (owner's decision). Steam integration not done yet (planned: steamworks.js).
- The packaged app checks `releases/latest` on GitHub at startup and offers the download when a newer version exists ("Skip this version" is saved in `window.json` in userData).
- Local test: `cd desktop && npm install && npm run dist:dir` then drive `dist/linux-unpacked/gravity-sandbox-desktop` with Playwright `_electron` under `xvfb-run` (`--no-sandbox --enable-unsafe-swiftshader`).

## Testing
Cloud sessions for this repo use the personal environment "gravity-sandbox", which allows the Supabase project API, `sandbox-gravity.netlify.app` and `cdn.jsdelivr.net` (plus package registries). Node's `fetch` needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`; Playwright needs `proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }` and `ignoreHTTPSErrors`. Headless Chromium grants pointer lock, so to reach the pause menu in a test call `__gs.input.unlock()` instead of `showPause(true)`. DELETE statements on Supabase ask the owner for approval. Tests used headless Chromium (Playwright is preinstalled) against a local `python3 -m http.server`-style server, replacing the Supabase import with a stub (offline, or a BroadcastChannel fake of Realtime for two-tab multiplayer tests). Physics/aim checks via `window.__gs` (the App: `__gs.game`, `__gs.editor`).

## Docs and branches
- `README.md` is the public presentation of the project; developer/deploy instructions are in `docs/DEVELOPMENT.md` (screenshots in `docs/`).
- Branch `website` (PR #2) holds the new website (presentation `index.html`, `download.html`, game moved to `play.html`, version 1.3.0). The owner wants it kept separate from `main` until they decide to publish; keep it merged up with `main`.

## Deploy
Drag the folder onto Netlify (or connect this repo). `_redirects` makes `/join/CODE` and `/map/TOKEN` work. Supabase Auth Site URL + redirect URL must be the Netlify address. Bump `VERSION` in `sw.js`, `js/config.js` and `version` in `desktop/package.json` on each release so the PWA cache refreshes.
