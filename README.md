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

## Routes

- `/` shows the local library dashboard
- `/receive?url=<url>&title=<title>&text=<text>` handles bookmarklet and Share Target ingress
- `/?paper=<id>` opens a saved offline paper

## Notes

- ar5iv HTML fetches go through a configurable relay list because `ar5iv.labs.arxiv.org` does not expose permissive CORS headers.
- The service worker only caches the app shell. Saved paper HTML and figure blobs are stored in IndexedDB.
- Deployment should use HTTPS and SPA fallback so `/receive` resolves to the app shell.
