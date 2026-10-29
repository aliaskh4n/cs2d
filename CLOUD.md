# CS2d Cloud

This is a personal fork of [zenojunior/cs2d](https://github.com/zenojunior/cs2d).
The original WASM parser, 2D/3D viewer, grenades, economy, voices and replay
export remain available. The fork adds a match report, per-player weapon
statistics, seekable highlights, cloud history and a provider companion.

## Storage

- GitHub Pages serves the Vue application. No personal demos are committed to Git.
- `apps/cloud` is a Cloudflare Worker with a SQLite Durable Object. Replays are
  gzip-compressed `.cs2dv` archives split into 512 KiB database chunks. An archive
  is visible only after all parts commit. Incomplete uploads expire after an hour.
- The configured library limit is 512 MiB, with a maximum of 64 MiB per replay.
  The application refuses additional imports when full; it does not silently
  delete personal matches. Change `MAX_STORAGE_BYTES` in the Worker to adjust it.
- No replay IndexedDB or persistent raw-demo cache is created. Download,
  decompression and parsing use browser memory. Without a cloud login, a replay
  exists in the current tab only. The app shell itself may be cached by the PWA.
- Voice is omitted from cloud archives by default to save space. Enable the
  voice checkbox before import to include it. The original `.dem` is discarded;
  the cloud archive retains the 2D replay and analysis, not a native CS2 demo.

## Identity and provider imports

Steam OpenID verifies identity on `steamcommunity.com`. The Worker validates the
signed Steam assertion and restricts access to `OWNER_STEAM_ID`. A short-lived
bearer token lives in the site's sessionStorage and the companion's session
storage. Provider passwords and browser cookies are never uploaded to the Worker.

The companion reads FACEIT history and resolves authorized signed demo URLs
through the user's logged-in FACEIT session. It reads actual GOTV links from
Steam Personal Game Data (Premier, Competitive and Wingman). Downloads are
parsed in an extension offscreen document; only the compressed archive and its
statistics go to the cloud. The raw file is not saved to Downloads.

Provider web endpoints and page layouts can change. Expired demos and denied
downloads are reported as failures, not fabricated replays. Connecting now
cannot reconstruct unavailable historical demos. Weapon leaderboards cover
the successfully analyzed demos in the library, not unseen match history.

## Setup

1. Run `pnpm install` using Node.js 24+.
2. Set `APP_URL`, `OWNER_STEAM_ID` and the storage cap in
   `apps/cloud/wrangler.jsonc`. Deploy with `pnpm --filter cs2d-cloud deploy`.
3. Set a random `SESSION_SECRET` with `wrangler secret put SESSION_SECRET` from
   `apps/cloud`. Never put that secret in Git or the frontend environment.
4. Set the public Worker URL in `apps/app/.env.production` and
   `apps/extension/.env.production`. Update the companion's Pages match pattern
   and cloud host permission when changing the deployment address.
5. Build the companion, ZIP the contents of `.output/chrome-mv3`, and put the ZIP
   at `apps/app/public/cs2d-companion.zip`. Build the app afterwards.
6. Publish with the included GitHub Pages workflow. Hash routing and base-aware
   radar, weapon and WASM paths support the `/cs2d/` project path.

The site includes companion installation instructions. Use Chrome or another
compatible Chromium browser for provider imports. Viewing cloud replays needs
no extension; sign in with Steam on the new device.

## Verification

`pnpm test` checks weapon/HS statistics, side changes, non-duel deaths, clutches,
private access, multipart cloud round trips, quota rejection and invalid OpenID
assertions. `node scripts/smoke-browser.mjs` checks the production UI, moment
seeking, the real WASM bzip2 decoder, mobile layout and absence of local replay
databases against a running preview on port 4174. Set `CHROME_PATH` on Linux.

No FACEIT rating is invented. ADR and KAST are calculated from the recorded demo;
highlights are recorded multi-kills, Deagle sequences and surviving clutch wins.
