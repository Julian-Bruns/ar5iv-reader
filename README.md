# ar5iv Reader

A lightweight Preact + Vite PWA for reading ar5iv papers, copying LaTeX from rendered math, and saving papers for offline use.

## Stack

- `preact`
- `dompurify`
- hand-written `manifest.webmanifest`
- hand-written `sw.js`
- IndexedDB for saved papers and figure blobs

## Local Development

```bash
bun install
bun run dev
```

If `bun` is installed but not on your shell path yet:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

## Build

```bash
bun run build
bun run preview
```

## Install and Launch From arXiv

1. Install the PWA from the app UI or your browser menu.
2. Open `Bookmark Setup` in the app.
3. Open a new tab. If the bookmarks bar is hidden, click the bookmarks bar area in the new tab to turn it on.
4. Drag `Open in ar5iv Reader` into the bookmarks bar once.

After that one-time setup, a single bookmark click from an arXiv abstract page opens the reader with that paper loaded.

### How the bookmarklet works

- The bookmarklet extracts only the arXiv ID from the current abstract, PDF, or ar5iv page.
- It opens `/receive` in this app with that ID.
- The existing reader workflow opens the rendered HTML paper when available, and falls back to the PDF when it is not.

Browsers do not provide a standard API for silently creating bookmarks, so the actual bookmark creation still has to be confirmed in the browser UI.

## Routes

- `/` shows the local library dashboard
- `/receive?url=<url>&title=<title>&text=<text>` handles bookmarklet ingress
- `/?paper=<id>` opens a saved offline paper

## Notes

- Live paper fetches prefer `arxiv.org/html/<id>` and fall back to `ar5iv.labs.arxiv.org/html/<id>`, both through a configurable relay list when the browser cannot fetch them directly.
- If neither HTML path yields a usable rendered paper, the reader opens the arXiv PDF instead and disables math copy for that session.
- The service worker only caches the app shell. Saved paper HTML and figure blobs are stored in IndexedDB.
- Deployment should use HTTPS and SPA fallback so `/receive` resolves to the app shell.
