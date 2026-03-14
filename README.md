# ar5iv Reader

Try it here: [ar5iv-reader.pages.dev](https://ar5iv-reader.pages.dev)

ar5iv Reader is a PWA for reading arXiv papers in a cleaner cross-platform interface, copying LaTeX directly from rendered math, saving papers to a personal library, and syncing that library across paired devices on the same network.

## Install It

Open the app over HTTPS and install it from your browser:

- On desktop, use the browser's install action in the address bar or app menu.
- On mobile, use the browser's add-to-home-screen or install flow.

Once installed, the app behaves like a standalone reader instead of just another browser tab.

## Open Papers

There are two main ways to open a paper:

- Paste an arXiv or ar5iv URL into the app.
- Use the bookmarklet so you can send the current paper straight into ar5iv Reader from your browser.

## Copy TeX

Rendered math is interactive. Click an equation to copy its underlying TeX.

## Save Papers

You can save papers into your library for later reading and offline access.

## Sync Across Devices

You can pair devices and sync your library between them on the same network by scanning a QR-code or entering a code, so saved papers are available on more than one machine.

## Local Development

```bash
bun install
bun run dev
```

For a production build:

```bash
bun run build
bun run preview
```

## Contributing

I am not accepting pull requests right now except for 1-5 line bug fixes.

If you have a suggestion on what should be changed, open an issue and include:

- why the change should exist
- what behavior you want changed or added in the form of a prompt i can give to an AI
