# Gravity SandBox: development and deployment

The repository root is the complete website. There is no build step: plain JavaScript modules plus an import map in `play.html`.

The website has three pages: `/` (`index.html`, presentation), `/download` (`download.html`) and `/play` (`play.html`, the game). Invite links (`/join/CODE`) and map links (`/map/TOKEN`) also open the game.

## Run it locally

Any static web server works, for example:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/play.html> for the game (the `/play` address needs Netlify's `_redirects`). Online features (accounts, friends, multiplayer, feedback) use the Supabase project configured in `js/config.js`; if Supabase can't be reached the game runs offline in singleplayer.

## Website hosting (Netlify)

The Netlify site **sandbox-gravity** is connected to this GitHub repository: every push to `main` is deployed to <https://sandbox-gravity.netlify.app>, and every pull request gets a deploy preview.

To deploy by hand instead: Netlify → **Add new site → Deploy manually** → drag the repository folder (without `desktop/node_modules`).

The files `_redirects` and `_headers` are Netlify settings. Keep them: they make invite links (`/join/CODE`) and map links (`/map/TOKEN`) work and control caching.

## Supabase

Project **gravity-sanbox** (ref `mhtxnmknuexraimyrjtq`, region eu-central-1). The full schema with all security rules is in `supabase/schema.sql`; later changes are in `supabase/migrations/`.

One-time settings in the Supabase dashboard:

1. **Authentication → URL Configuration**: Site URL = `https://sandbox-gravity.netlify.app`, Redirect URLs include `https://sandbox-gravity.netlify.app/**`.
2. **Authentication → Sign In / Providers → Email**: keep **Confirm email** on for public use (it reduces spam accounts).

**The free plan pauses after about a week with no activity.** If logins stop working, open the Supabase dashboard and click **Restore project**. Singleplayer keeps working offline.

### Feedback table

`public.feedback` stores the messages sent with the in-game **Send feedback** panel (migration `supabase/migrations/20261106_feedback.sql`):

- Players (roles `anon` and `authenticated`) may only **insert** the columns `message` (5–1000 characters) and `category` (`bug`, `idea`, `altro`). They can never read, change or delete feedback.
- Row Level Security is on, with insert-only policies that also require `status = 'new'` and empty handling fields.
- A trigger rejects new messages when 30 already arrived in the last 60 minutes (error `feedback_rate_limited`). The game also allows one message per player every 20 seconds.
- `status` (`new`, `in_progress`, `in_review`, `done`, `rejected`, `needs_review`), `result_note`, `pr_url` and `handled_at` are for whoever processes the feedback later. That process must use a server-side key (service role), never the public key.

## Desktop app (`desktop/`)

An Electron wrapper around the same website files: it serves them on a private `app://gravity/` address, bundles Supabase JS and the fonts so it starts offline, and checks GitHub for a newer release at startup.

| Command (in `desktop/`, needs Node.js 22) | Result |
| --- | --- |
| `npm install` | install Electron and the build tools |
| `npm start` | run the app from source |
| `npm run dist` | Windows: `dist/GravitySandBox-Setup.exe` + `dist/GravitySandBox-Windows.zip` |
| `npm run dist:linux` | Linux: `dist/GravitySandBox-Linux.AppImage` |

The GitHub workflow **Desktop app** (`.github/workflows/desktop.yml`) builds Windows and Linux on GitHub's machines. Run it from **Actions → Desktop app → Run workflow** to get the files as downloads.

### Publishing a release

1. Bump the version in `js/config.js` (`VERSION`), `sw.js` (`VERSION`, so the offline cache refreshes) and `desktop/package.json` (`version`).
2. Merge to `main`, then push a tag with the same version: `git tag v1.2.0 && git push origin v1.2.0` (or GitHub → Releases → *Draft a new release* → new tag).
3. The workflow builds both platforms and attaches all files to the GitHub Release. Download links of the form `releases/latest/download/GravitySandBox-Setup.exe` always point to the newest release, and installed apps offer the update.

The installer is not code-signed, so Windows SmartScreen shows a warning on first run.

## Folder contents

```
index.html             presentation page (/)
download.html          download page (/download)
play.html              the game (/play)
css/site.css, js/site.js   styles + script for the two website pages
img/, video/           screenshots and gameplay clips for the website
css/style.css          all styles
js/                    the game (plain JavaScript modules)
  main.js              start-up, navigation
  game.js              play session, multiplayer sync
  physics/             world, gravity simulation, object catalog
  player/              first-person controller, mannequin + ragdoll
  powers/              the 7 powers and their visuals
  maps/defaults.js     The Lab, The Apartment, The Yard, The Atrium + templates
  editor/editor.js     Build Map
  net/                 accounts, friends, maps, feedback (Supabase), rooms (WebRTC)
  ui/                  HUD, menus, chat, power settings, feedback, help + tutorial
  config.js            game constants (limits, Supabase address, version)
lib/                   three.js r170 and Rapier physics (bundled, works offline)
icons/, manifest.webmanifest, sw.js   install-as-app support
_redirects, _headers   Netlify settings
desktop/               desktop app for Windows and Linux (Electron)
.github/workflows/     builds the desktop app on GitHub
supabase/              database schema and migrations
docs/                  this guide and README screenshots
```

Tuning lives in `js/config.js` (object limit, telekinesis limit, player speed, network rate).
