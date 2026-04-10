# ar5iv Reader

Try it here: [ar5iv-reader.pages.dev](https://ar5iv-reader.pages.dev)

ar5iv Reader is a PWA for reading arXiv papers in a cleaner mobile-friendly interface, copying LaTeX directly from rendered math, saving papers to a personal library, and syncing that library across paired devices on the same network.

## What It Does

- Install the app directly from your browser on desktop or mobile.
- Open papers by pasting an arXiv or ar5iv link into the app.
- Open papers from the web with a bookmarklet.
- Copy TeX from rendered math with a simple click.
- Dictate theorem notes with on-device Whisper transcription and browser-side LaTeX interpretation.
- Save papers to your local library for later reading.
- Sync your saved papers and library state to other paired devices on the same network.

## Install It

Open the app over HTTPS and install it from your browser:

- On desktop, use the browser's install action in the address bar or app menu.
- On mobile, use the browser's add-to-home-screen or install flow.

Once installed, the app behaves like a standalone reader instead of just another browser tab.

## Open Papers

There are two main ways to open a paper:

- Paste an arXiv or ar5iv URL into the app.
- Use the bookmarklet so you can send the current paper straight into ar5iv Reader from your browser.

The goal is to make getting a paper into the reader as close to one action as possible.

## Copy TeX

Rendered math is interactive. Click an equation to copy its underlying TeX without opening developer tools, inspecting the page, or manually reconstructing the source.

## Save Papers

You can save papers into your library for later reading. This keeps the papers you care about in one place and makes the reader useful as a lightweight personal archive rather than just a transient viewer.

## Dictate Notes

Inside the theorem note composer there is a `Dictate with Whisper` button. It records from the microphone, transcribes locally with a q4 Whisper Base model through `transformers.js`, and then runs a background WebLLM pass to turn spoken math into LaTeX. The transcript and LaTeX are both stored with the note and shown in the central notes directory.

The models are loaded lazily and do not participate in the initial PWA startup path.

## Sync Across Devices

You can pair devices and sync your library between them on the same network, so saved papers are available on more than one machine. The intended workflow is simple: save on one device, pick up reading on another.

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

## Hosting Note AI Models In R2

The dictation feature expects the note AI assets under a public root such as `/models/note-ai` or a public R2 URL wired through `VITE_NOTE_AI_MODEL_ROOT_URL`.

Upload the required model files with:

```bash
bun run cf:r2:upload:note-ai-models <bucket-name> [prefix]
```

By default the script uploads to `models/note-ai`. The selected asset set mirrors:

- Whisper Base q4 ONNX files needed for `transformers.js`
- `mlc-ai/DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC`
- the compatible WebLLM Qwen2 1.5B WebGPU wasm library

That remote footprint is about 1.18 GiB for the model weights plus the WebLLM wasm, which stays well below a 10 GiB ceiling.

## Contributing

I am not accepting pull requests right now except for very small changes in the 1-5 line range.

If you want a bug fix, UX change, or new feature, open an issue instead. Please include:

- why the change should exist
- what behavior you want changed or added
- a concrete prompt describing how you would build it

That issue is the right place to propose larger changes. Small typo fixes or similarly tiny edits are the only pull requests I expect to merge for now.
