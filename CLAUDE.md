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
- Database schema + RLS: `supabase/schema.sql` (tables profiles, friendships, maps, map_links, map_shares; helpers in schema `private`; `get_map_by_token` RPC for link sharing). Auto-expose of new tables is OFF: grant explicitly.

## Testing
No network in the cloud container besides git. Tests used headless Chromium (Playwright is preinstalled) against a local `python3 -m http.server`-style server, replacing the Supabase import with a stub (offline, or a BroadcastChannel fake of Realtime for two-tab multiplayer tests). Physics/aim checks via `window.__gs` (the App: `__gs.game`, `__gs.editor`).

## Deploy
Drag the folder onto Netlify (or connect this repo). `_redirects` makes `/join/CODE` and `/map/TOKEN` work. Supabase Auth Site URL + redirect URL must be the Netlify address. Bump `VERSION` in `sw.js` and `js/config.js` on each release so the PWA cache refreshes.
