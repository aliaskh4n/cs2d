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
- Recorded voice is included in cloud archives by default. The voice checkbox
  disables it for subsequent imports if space needs to be saved. The original `.dem` is discarded;
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

Companion 1.2.1 uses Chrome scripting in a provider tab, so an already-open
FACEIT page does not need a previously injected API message listener. Steam
checks all three histories in one reused, inactive tab. Automatic checking and
queueing run on sign-in and every five minutes while the cloud page is visible;
the Auto switch disables new automatic imports. This is browser-session sync,
not a server cron job. Expired sessions show a Steam sign-in link. Demo processing
waits for an explicit offscreen readiness reply. The offscreen document retrieves
its cloud configuration through a runtime message restricted to that document,
because Chrome offscreen documents do not expose the storage API.

Steam history is requested using `/my/gcpd/730`, including the Premier,
per-map Competitive and Wingman tabs. The reader follows Steam's AJAX
continuation while replays remain available. Logged-out application configuration,
account mismatches and public-profile redirects are recognized instead of being
reported as a successful empty history. Mode counts and unavailable rows are
shown separately. Session IDs and continuation tokens stay inside Steam.

New archives record whether voice is present, omitted by preference, or absent
from the source demo. Older provider imports have a Restore recorded voice action.
It re-fetches and parses an available source demo, then atomically replaces the
compact archive under its existing ID, preserving the title and comments. Failed
or incomplete restores leave the original replay accessible. Restoration cannot
recover voice absent from the source, or download an expired source demo.

Match history groups games by date and displays map, mode, source, final score,
personal result, K/D/A, ADR, HS and Deagle records. Personal results use the
player's side at the end of the replay, including side changes and overtime.
Game dates and results are saved alongside new cloud archives. Older archives
without that metadata show their final CT/T score and are labelled with the
date they were added, rather than an invented match date or personal result.

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
`PLAYWRIGHT_BROWSERS_PATH=… node scripts/smoke-matchroom.mjs` additionally checks
the installed extension against isolated provider fixtures: existing FACEIT tabs,
all Steam history modes, automatic queueing, expired demo errors, login recovery,
populated history filters and responsive layouts. It requires Playwright Chromium.
These fixtures do not verify the owner's live Steam/FACEIT session or change
their cloud library.
`node scripts/smoke-voice.mjs` encodes a short synthetic tone to real Opus,
checks exact packet preservation through the archive codec, decodes the packets
to nonzero audio samples, and loads the archive through an isolated cloud response
to verify the player's visible Voice control. It does not record anyone's speech.

No FACEIT rating is invented. ADR and KAST are calculated from the recorded demo;
highlights are recorded multi-kills, Deagle sequences and surviving clutch wins.
