# Gravity SandBox

A first-person physics sandbox for desktop browsers: change gravity for single objects, whole maps, your own body and bubble zones, and move anything with telekinesis. Play alone or with up to 4 friends.

This folder is the complete, ready-to-upload website. There is no build step.

---

## 1. Put it online (Netlify)

1. Go to <https://app.netlify.com> → **Add new site → Deploy manually**.
2. Drag this whole folder (`gravity-sandbox`) onto the upload box.
3. When it finishes, Netlify shows your address, e.g. `https://something.netlify.app`.
   You can rename it in **Site configuration → Change site name**.

To update later, open the site in Netlify → **Deploys** → drag the folder again.

The files `_redirects` and `_headers` are Netlify settings. Keep them: they make invite links (`/join/CODE`) and map links (`/map/TOKEN`) work.

## 2. Connect Supabase to your address (one time)

In <https://supabase.com/dashboard> → project **gravity-sanbox**:

1. **Authentication → URL Configuration**
   - **Site URL**: your Netlify address, e.g. `https://something.netlify.app`
   - **Redirect URLs**: add `https://something.netlify.app/**`
2. **Authentication → Sign In / Providers → Email**
   - While testing you can turn **Confirm email** off, so new accounts work instantly.
   - Turn it back on before you share the game publicly (it reduces spam accounts).

The database (tables, security rules) is already set up. Nothing else to configure.

## 3. Install it like an app

Open the site in Chrome or Edge on your PC → click the **Install** icon at the right of the address bar. It opens in its own window, like any app.

## 4. Desktop app (Windows .exe)

The same game also ships as a real Windows program (Electron), in the `desktop/` folder. It contains its own browser engine, so it runs exactly like the website, starts without internet (singleplayer), and online play uses the same accounts and rooms as the website.

**Get the .exe (no installs needed):** on GitHub open **Actions → Desktop app → Run workflow**. After about 5 minutes the finished run has a download called **GravitySandBox-windows** containing:
- `GravitySandBox-<version>-win-x64.exe`: the installer (Start menu + desktop shortcut)
- `GravitySandBox-<version>-win-x64.zip`: the same app without installer (unzip and run `Gravity SandBox.exe`)

Pushing a tag like `v1.1.0` builds the same files and attaches them to a GitHub Release.

Windows shows "Windows protected your PC" for the installer because it is not code-signed: click **More info → Run anyway**.

**Run it from source** (needs [Node.js](https://nodejs.org) 22): `cd desktop`, `npm install`, `npm start`. `npm run dist` builds the Windows files into `desktop/dist/`.

In the app: **F11** or **Alt+Enter** toggles fullscreen (remembered for next time). Invite and map links point to the website (`SITE_URL` in `js/config.js`).

The `desktop/` folder is not part of the website. When uploading to Netlify by drag and drop, it does no harm, but don't drag it after running `npm install` (its `node_modules` folder is large).

---

## Learning the game

- **Tutorial**: Play → *Start tutorial* (or Settings → Start tutorial). 17 short tasks in The Lab that teach every power; each task completes when you do it. Esc lets you skip a step or exit.
- **How to play**: a menu page with every power, a small diagram, how to use it, and all the controls.
- **First-time tips**: the first time you play and the first time you use each power, a tip appears on the right. Turn them off or show them again in Settings → Help.

## Controls (all keys can be changed in Settings)

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Space / C | Jump / crouch (in zero-g: up / down) |
| Shift | Sprint |
| 1–7 or mouse wheel | Choose a power |
| Left click | Use the power |
| Right click | Undo / alternate (reset, throw, delete bubble…) |
| Q | Power settings (direction, strength, mass, presets) |
| F | Apply current settings to the aimed bubble or object |
| R (hold) + mouse | Rotate the object you are holding |
| Z / X | Crush / expand (shrink / grow; mass follows size) |
| G | Go limp (ragdoll) / stand up |
| Backspace (hold 1 s) | Reset all gravity in the room |
| Tab (hold) | Players and room code |
| Enter | Chat (multiplayer) |
| Esc | Pause menu |

### Powers

1. **Object gravity**: change one object's gravity direction, strength (0–10 g) and mass (×0.1–×100).
2. **Area scan**: hold to grow a sphere, release to apply the settings to everything inside.
3. **World gravity**: set the whole map's "down" to where you look; 0 g, Moon, Mars, Earth, 3 g, 10 g presets.
4. **Body gravity**: walk on the wall or ceiling you aim at. The turn is faster when gravity is stronger.
5. **Bubble**: place a sphere with its own gravity (zero-g, a direction, toward or away from its center). Bubbles have no gravity themselves but drift when objects hit them.
6. **Attraction**: link two objects (or an object and a point); they pull each other with F = G·m₁·m₂/d².
7. **Telekinesis**: grab, carry, throw, push, pull, rotate, crush and expand. Lifts up to **350 kg** of effective weight (mass × gravity). Too heavy? Lower its gravity or mass first.

### Build Map

Menu → **Build Map** → start from *Flat Plain* or *Closed Room*.
Tools: Spawn, Delete, Move, Rotate, Scale (keys 1–5). **B** opens the spawn menu, **P** tests the map, **N** toggles grid snap.
Right mouse + drag looks around; W A S D flies. Save stores the map in your account (max 100 physics objects). From **Play → My maps** you can share a map by link or with friends.

### Multiplayer

Choose a map → **Host room**. Share the 6-letter code, copy the invite link from the Esc menu, or invite friends from the Friends list. Up to 5 players. The host's browser runs the physics for everyone, so the host should have the best PC and connection. If the host leaves, the room closes.

---

## Good to know

- **Supabase free plan pauses after about a week with no activity.** If logins stop working, open the Supabase dashboard and click **Restore project**. Singleplayer keeps working offline.
- Multiplayer connects players directly (WebRTC). A few strict networks (some schools, offices, mobile hotspots) block this; if a friend can't join, try another network.
- Supported browsers: recent Chrome, Edge or Firefox on a desktop computer.

## Folder contents

```
index.html             the page
css/style.css          all styles
js/                    the game (plain JavaScript modules)
  main.js              start-up, navigation
  game.js              play session, multiplayer sync
  physics/             world, gravity simulation, object catalog
  player/              first-person controller, mannequin + ragdoll
  powers/              the 7 powers and their visuals
  maps/defaults.js     The Lab, The Apartment, The Yard, The Atrium + templates
  editor/editor.js     Build Map
  net/                 accounts, friends, maps (Supabase), rooms (WebRTC)
  ui/                  HUD, menus, chat, power settings, help + tutorial
  config.js            game constants (limits, Supabase address)
lib/                   three.js r170 and Rapier physics (bundled, works offline)
icons/, manifest.webmanifest, sw.js   install-as-app support
_redirects, _headers   Netlify settings
desktop/               Windows desktop app (Electron wrapper around the same files)
.github/workflows/     builds the desktop app on GitHub
supabase/schema.sql    the database setup, for reference
```

Tuning lives in `js/config.js` (object limit, telekinesis limit, player speed, network rate).

## Credits

- [three.js](https://threejs.org) — MIT License
- [Rapier](https://rapier.rs) physics by Dimforge — Apache License 2.0 (bundled build from [lo-th/phy](https://github.com/lo-th/phy), MIT)
- [Supabase JS](https://github.com/supabase/supabase-js) — MIT License
- [Electron](https://www.electronjs.org) — MIT License (desktop app)
- Fonts: Space Grotesk and Inter via Google Fonts — SIL Open Font License
