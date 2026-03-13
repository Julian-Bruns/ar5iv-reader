# ar5iv Reader

A Preact + Vite PWA for reading ar5iv papers, copying LaTeX from rendered math, saving papers for offline use, and nearby-syncing the same library across paired devices on the same network.

## What Changed

- Long papers scroll more smoothly on mobile.
- Display math and wide tabular layouts can scroll horizontally on mobile instead of clipping off-screen.
- Library export/import is a full backup, not only paper IDs.
- Cross-device sync is now nearby-only:
  - pair devices once with a short code plus an in-app QR scanner
  - later syncs reuse the remembered pairing
  - actual library data stays local on each device
  - the relay is used only for presence and WebRTC signaling
- The deployment target is now Cloudflare Pages + a Cloudflare Worker Durable Object instead of a cloud snapshot backend.

## Local Development

```bash
bun install
bun run dev
```

If `bun` is installed but not on your shell path yet:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

## Local Production Build

```bash
bun run build
bun run preview
```

The frontend builds locally without the nearby relay. To use nearby sync outside local testing, deploy the Worker and set `VITE_NEARBY_SIGNAL_URL`.

## Nearby Sync Model

- Each install creates a persistent local device identity.
- Pairing uses a one-time code or an in-app QR scan.
- After pairing, later launches automatically look for already-paired devices that are open on the same network.
- If a paired device is found, the app uses the Worker for signaling and a WebRTC data channel for the actual transfer.
- Paper HTML, assets, and the library database are never stored on the relay.
- Nearby sync only works while both apps are open or foregrounded.
- The first version is optimized for Chromium desktop and Android Chrome. iPhone support is best-effort.

## Cloudflare Deployment

### 1. Install dependencies

```bash
bun install
```

### 2. Log in to Cloudflare from the terminal

```bash
bunx wrangler login
```

### 3. Deploy the nearby signal Worker

The Worker code lives in [`worker/src/index.ts`](worker/src/index.ts).

```bash
bun run cf:worker:deploy
```

When deploy finishes, note the Worker hostname. The websocket endpoint is:

```text
wss://<your-worker-subdomain>.workers.dev/ws
```

### 4. Create a Cloudflare Pages project for the PWA

Use the Cloudflare dashboard:

- Workers & Pages
- Create
- Pages
- Connect to Git
- select this repo

Recommended Pages settings:

- Framework preset: `Vite`
- Build command: `bun run cf:pages:build`
- Build output directory: `dist`
- Root directory: repo root

### 5. Add the required Pages environment variable

In the Pages project settings, add:

```text
VITE_NEARBY_SIGNAL_URL=wss://<your-worker-subdomain>.workers.dev/ws
```

Then redeploy the Pages project.

### 6. Public URL

After Pages finishes deploying, the shareable link is:

```text
https://<your-project>.pages.dev
```

No paid services should be required for low-volume usage on the Cloudflare free tier.

## Quick Command List

```bash
bun install
bunx wrangler login
bun run cf:worker:deploy
```

Optional local relay test:

```bash
bun run cf:worker:dev
```

Optional local frontend build check:

```bash
bun run build
```

## Install and Launch From arXiv

1. Open the deployed app over HTTPS.
2. Install it from the browser menu.
3. On phones, you can use the browser share sheet and choose `ar5iv Reader`.
4. On desktop, open `Bookmark Setup` in the app and drag `Open in ar5iv Reader` into the bookmarks bar once.
5. Later, use the share target or bookmark to open the paper in the reader.

## Nearby Pairing Flow

1. On Device A, open `Nearby Sync`.
2. Tap `Add Device`.
3. On Device B, open `Nearby Sync`, then type the shown code or scan the QR code inside the app.
4. Keep both apps open until pairing completes.
5. After that, nearby syncs reuse the remembered pairing automatically.

## Release Checklist

Before sending the link to friends, test:

1. Pair two devices.
2. Save a paper on Device A and confirm Device B receives it.
3. Delete a paper on Device A and confirm Device B removes it after sync.
4. Close both apps, reopen both, and confirm sync still works without re-pairing.
5. Import a backup on one device and confirm it syncs to the other.

## Backups

- `Export Backup` downloads the full offline library, including cached assets.
- `Import Backup` merges that backup into the current library using per-paper revision metadata.
- `Export URLs` downloads a lightweight recovery manifest of saved paper URLs and metadata.
- `Import URLs` refetches those papers and rebuilds the local library without requiring an account or server snapshot.
- `Keep Recovery File Updated` is a Chromium-only option that mirrors the URL manifest to a user-chosen JSON file outside browser-managed storage.
- `Export HTML` still downloads the raw saved HTML for a single paper.

## Routes

- `/` shows the local library dashboard
- `/?url=<url>&title=<title>&text=<text>` and `/receive?url=<url>&title=<title>&text=<text>` handle share/bookmarklet ingress
- `/?paper=<id>` opens a saved offline paper
- `/?pair=<inviteId>` handles one-time nearby device pairing

## Notes

- Live paper fetches prefer `arxiv.org/html/<id>` and fall back to `ar5iv.labs.arxiv.org/html/<id>`, both through a configurable relay list when the browser cannot fetch them directly.
- If neither HTML path yields a usable rendered paper, the reader opens the arXiv PDF instead and disables math copy for that session.
- The service worker caches the app shell. Saved paper HTML, figure blobs, pairing metadata, and revision metadata are stored in IndexedDB.
- Storage persistence is requested through the Storage API, but browser-managed data can still be cleared by the user or browser policies.
- OPFS is not used for library persistence because it is still origin-scoped like IndexedDB and Cache Storage.
- `public/_redirects` is included so Cloudflare Pages serves `/receive` as SPA content instead of returning a direct-route 404.
- Nearby sync is same-network-first and does not use TURN in v1, so it is not guaranteed to work across different networks or restrictive NAT setups.
