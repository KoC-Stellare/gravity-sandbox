# Tests

Browser tests for the game. They need Node.js 22 and [Playwright](https://playwright.dev) with Chromium
(`npm install playwright && npx playwright install chromium`; both are already there in Claude cloud sessions).
Nothing here is loaded by the game.

| Command (from the repository root) | Checks |
| --- | --- |
| `node tests/run.mjs` | solo play and every power, player movement at 10/30/60/144 fps, malformed commands and maps, HUD, editor, feedback panel, a two-player room (host + client in two tabs) with hostile messages |
| `node tests/offline.mjs` | the offline cache: the game starts and plays with the server switched off |

Both start their own local server that applies `_redirects` and `_headers` like Netlify. On a branch where the
game page is not `/` (the `website` branch), pass its path: `node tests/run.mjs /play`.

Supabase is replaced by `supabase-stub.js`: a fake login, fake tables, and Realtime carried between tabs by
`BroadcastChannel`, so the two tabs really connect to each other over WebRTC. No test touches the real database.
