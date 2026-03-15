# Plan 4 Prompt

Copy everything in the block below into the Plan 4 model.

```text
Repo: /Users/julian/.t3/worktrees/ar5iv-reader/t3code-09de8198

You are implementing Plan 4 of a larger feature. Follow the frozen contract exactly. Do not redesign the feature. Do not modify the frozen contract. If the contract is insufficient, stop and report the gap instead of inventing a new interface.

Plans 1, 2, and 3 are already complete. Use their outputs as the source of truth for existing interfaces and app lifecycle.

Your task is limited to the owned files for Plan 4:
- src/components/ReaderView.jsx
- src/components/PdfReaderSurface.jsx
- src/styles/app.css

You may add tightly-scoped helper modules under `src/components/` only if they are internal to Plan 4 and you list them in the final summary.

You must not edit App/state/runtime/schema files unless there is an unavoidable compile break and you explicitly call it out in your final summary.

## Inputs from prior plans

### From Plan 1
- `src/lib/pdfFallbackState.js` is the source of truth for:
  - `PDF_FALLBACK_NOTICE`
  - `INITIAL_PDF_FALLBACK_STATE`
  - `createInitialPdfFallbackState()`
  - `PDF_LOAD_STATUSES`
  - `PDF_MATH_COPY_STATUSES`
  - `PDF_MATH_COPY_REASONS`
  - `isPdfLoadStatus()`
  - `isPdfMathCopyStatus()`
  - `isPdfMathCopyReason()`
  - `PDF_MATH_COPY_DISABLE_NOTICE_SHOWN_KEY`
- `buildPdfFallbackPaper()` in `src/lib/fetchPaper.js` guarantees the exact initial `pdfState` shape.

### From Plan 2
- `src/lib/pdfMathService.js` exists and exposes:
  - `status()`
  - `prefetch()`
  - `acquire()`
  - `release()`
  - `detectAndRecognize()`
- `pdfMathWorker.js` keeps the frozen protocol exact.
- Important current limitation from Plan 2 summary:
  - `LOAD_MODELS` currently reports `models_load_failed` until a concrete runtime is later defined by contract.
  - Plan 4 must not try to solve that. It must render status and wire the surface against the existing service API cleanly.

### From Plan 3
- `src/App.jsx` now owns fallback hydration through a single `primePdfFallbackPaper(tabKey, paper)` path.
- `primePdfFallbackPaper()` already:
  - inserts PDF papers with `pdfState.loadStatus = "loading"`
  - starts `fetchBlobWithFallback(paper.pdfUrl)` immediately and non-blockingly
  - starts `pdfMathService.prefetch()` immediately and non-blockingly
  - patches `paper.pdfState.blobUrl`, `relay`, `mathCopyStatus`, and `mathCopyReason`
  - revokes blob URLs on supersede, replacement, and close
  - manages `pdfMathService.status()/prefetch()/acquire()/release()` lifecycle
- Important current limitation from Plan 3 summary:
  - `pdfState.loadStatus` stays `"loading"` after blob fetch success
  - it cannot reach `"ready"` until Plan 4 provides the `pdf.js` first-page render callback

Treat those outputs as fixed. Do not rename them.

## Frozen Contract

### Summary
- Replace the PDF fallback `<iframe>` in `src/components/ReaderView.jsx` with an in-app `pdf.js` surface.
- Preserve the existing fallback entrypoints in `src/lib/fetchPaper.js` and `src/App.jsx`.
- User clarifications that amend ambiguous frozen wording:
  - No separate desktop/mobile heuristic. Enablement is exactly the listed capability checks.
  - No once-only warning surface. Disabled reasons appear only in PDF status UI.
  - `pdfMathCopyDisableNoticeShown` stays in schema as a reserved no-op key.

### PDF paper shape
```js
{
  id: string,
  sourceUrl: string,
  pdfUrl: string,
  titleHint: string,
  title?: string,
  view: "pdf",
  notice: "Showing the PDF because this paper does not currently have a usable HTML view.",
  pdfState: {
    blobUrl: string,
    relay: string,
    loadStatus: "idle" | "loading" | "ready" | "error",
    mathCopyStatus: "pending" | "disabled" | "ready" | "running" | "error",
    mathCopyReason:
      "" |
      "insecure_context" |
      "worker_unsupported" |
      "gpu_unavailable" |
      "device_memory_too_low" |
      "hardware_concurrency_too_low" |
      "storage_free_too_low" |
      "models_load_failed" |
      "benchmark_too_slow" |
      "benchmark_failed" |
      "worker_error" |
      "pdf_not_ready" |
      "no_formula_detected" |
      "ocr_empty" |
      "copy_failed"
  }
}
```

### Preload timing and state transitions
- `src/lib/fetchPaper.js` only constructs the initial PDF paper. It does no async preload work.
- `src/App.jsx` owns PDF fallback hydration through one helper, `primePdfFallbackPaper(tabKey, paper)`, called from both existing fallback branches.
- `primePdfFallbackPaper()` does this, in order:
  1. Insert the PDF paper into tab/reader state with `loadStatus: "loading"`.
  2. Start `fetchBlobWithFallback(paper.pdfUrl)` immediately and non-blockingly.
  3. Start `pdfMathService.prefetch()` immediately and non-blockingly.
- Blob fetch success updates:
  - `pdfState.blobUrl = URL.createObjectURL(blob)`
  - `pdfState.relay = relay`
  - `pdfState.loadStatus` stays `"loading"` until `pdf.js` finishes first-page render.
- `pdf.js` first-page render success updates `pdfState.loadStatus = "ready"`.
- Blob fetch failure or `pdf.js` document/render failure updates:
  - `pdfState.blobUrl = ""`
  - `pdfState.loadStatus = "error"`
- `pdfState.mathCopyStatus` updates:
  - `"pending"` while capability/model/benchmark work is running
  - `"disabled"` when any gate fails
  - `"ready"` when all gates pass and the service is warm
  - `"running"` during one click-to-recognize request
  - `"error"` for a completed click that produced `no_formula_detected`, `ocr_empty`, or `copy_failed`
- PDF blob object URLs are revoked when a PDF tab is replaced, closed, or its blob URL is superseded.
- `detectAndRecognize()` is only callable when both `loadStatus === "ready"` and `mathCopyStatus === "ready"`.

### `pdfMathService` API relevant to Plan 4
- `status()` returns synchronously:

```js
{
  phase: "idle" | "checking" | "disabled" | "ready" | "error",
  enabled: boolean,
  reason: "" | /* same capability/infra reason codes as pdfState.mathCopyReason */,
  benchmarkMs: number | null,
  modelRevision: "breezedeus-pix2text-v1",
  refCount: number
}
```

- `detectAndRecognize({ imageBitmap, clickPoint, cropRect }): Promise<DetectResult>`

```js
{
  status: "ok" | "no-match",
  latex: string,
  confidence: number | null,
  bounds: { x: number, y: number, width: number, height: number } | null,
  reason: "" | "no_formula_detected" | "ocr_empty"
}
```

- `detectAndRecognize()` rejects only for infrastructure failures, with the same reason codes used by `status()`.

### User-visible messages
- Fallback notice banner text: `Showing the PDF because this paper does not currently have a usable HTML view.`
- PDF surface status text:
  - `loadStatus: "loading"`: `Loading PDF…`
  - `loadStatus: "error"`: `PDF failed to load.`
  - `mathCopyStatus: "pending"`: `Preparing PDF math copy…`
  - `mathCopyStatus: "ready"`: `Click an equation to copy LaTeX.`
  - `mathCopyStatus: "running"`: `Recognizing equation…`
  - `mathCopyReason: "insecure_context"`: `PDF math copy requires a secure context.`
  - `mathCopyReason: "worker_unsupported"`: `PDF math copy requires Web Workers.`
  - `mathCopyReason: "gpu_unavailable"`: `PDF math copy requires navigator.gpu.`
  - `mathCopyReason: "device_memory_too_low"`: `PDF math copy requires at least 8 GB of device memory.`
  - `mathCopyReason: "hardware_concurrency_too_low"`: `PDF math copy requires at least 8 CPU threads.`
  - `mathCopyReason: "storage_free_too_low"`: `PDF math copy requires at least 1 GB of free storage.`
  - `mathCopyReason: "models_load_failed"` or `"worker_error"`: `PDF math copy could not be prepared on this device.`
  - `mathCopyReason: "benchmark_too_slow"`: `PDF math copy was disabled because setup exceeded 5 seconds.`
  - `mathCopyReason: "benchmark_failed"`: `PDF math copy benchmark failed.`
  - `mathCopyReason: "no_formula_detected"`: `No formula was detected at that location.`
  - `mathCopyReason: "ocr_empty"`: `The equation could not be recognized.`
- Action toasts remain allowed for interaction results only:
  - success: `Copied!`
  - clipboard failure: `Clipboard copy failed.`
- No toast and no banner are shown for capability-gated disablement.

### File ownership
- Plan 4 owns:
  - `src/components/ReaderView.jsx`
  - `src/components/PdfReaderSurface.jsx`
  - `src/styles/app.css`
- Responsibility:
  - replace the iframe with `pdf.js`
  - render PDF status UI
  - wire click-to-recognize
  - keep HTML math copy untouched

### Dependency graph relevant to Plan 4
```text
Plan 1 -> Plan 4
Plan 2 -> Plan 4
Plan 3 -> Plan 4
Plan 4 -> Plan 5

Runtime graph:
fetchPaper/buildPdfFallbackPaper
  -> App primePdfFallbackPaper
  -> ReaderView/PdfReaderSurface
  -> pdfMathService
  -> pdfMathWorker
pdfMathService <-> IndexedDB (db.js)
App -> fetchBlobWithFallback -> pdfState.blobUrl/relay
```

### Assumptions and defaults
- `desktop-only in v1` is not implemented as a separate heuristic; the listed capability checks are the full enablement contract.
- `pdfMathCopyDisableNoticeShown` is retained only because the frozen schema listed it; v1 does not use it.
- Saved-library behavior is unchanged: PDF fallback sessions are still not saved offline in v1.

## Plan 4 Objectives
- Replace the current PDF iframe in `ReaderView.jsx` with a dedicated `PdfReaderSurface` component.
- Render PDFs from `paper.pdfState.blobUrl`, not directly from `paper.pdfUrl`.
- Use `pdf.js` in the UI layer to render the PDF.
- Update PDF UI so first-page render success transitions `paper.pdfState.loadStatus` from `"loading"` to `"ready"`.
- Show the frozen PDF status messages based on `paper.pdfState`.
- Wire click-to-recognize through `pdfMathService.detectAndRecognize()` only when `loadStatus === "ready"` and `mathCopyStatus === "ready"`.
- Keep existing HTML article rendering and `installMathCopy()` behavior untouched.

## Required implementation details
- `ReaderView.jsx` must continue to render HTML papers exactly as before.
- For PDF papers, replace the iframe branch with `PdfReaderSurface`.
- `PdfReaderSurface` must accept all data it needs from props. Do not move App-owned lifecycle into the UI.
- The UI must provide callbacks upward for:
  - first-page render success
  - PDF render/document failure
  - copy success / copy failure if needed for existing `showToast`
- If `paper.pdfState.blobUrl` is empty, show status UI instead of trying to render a document.
- On successful first-page render:
  - notify parent so `paper.pdfState.loadStatus` becomes `"ready"`
- On PDF render/document failure:
  - notify parent so `paper.pdfState.loadStatus` becomes `"error"` and blob usage stops
- Click handling:
  - do not call `detectAndRecognize()` unless both frozen readiness conditions are met
  - if allowed, construct the request expected by the service
  - if service returns `status: "ok"` with non-empty `latex`, copy it and show `Copied!`
  - if service returns `status: "no-match"` or `reason: "ocr_empty"`, reflect that in PDF status UI, not as a toast
  - if clipboard write fails, show `Clipboard copy failed.`
- Because Plan 2 currently leaves model loading unresolved, the UI must correctly render disabled/error/pending states and remain usable even if recognition never becomes available.

## Constraints and assumptions for this plan
- Do not solve missing OCR runtime behavior from Plan 2.
- If `pdf.js` dependency/build wiring is required and the repo does not already have it, you may note that as a dependency for Plan 5 rather than editing package/build files here.
- Prefer implementing the component contract and UI wiring cleanly even if some runtime pieces remain disabled.

## Deliverables
- `src/components/PdfReaderSurface.jsx`
- `src/components/ReaderView.jsx` updated to use it
- `src/styles/app.css` updated for PDF surface layout and status presentation
- Tests for:
  - PDF fallback no longer rendering an iframe
  - HTML math copy path staying unchanged
  - status text rendering from `paper.pdfState`
  - first-page render callback transitioning the UI contract
  - disabled/error math-copy states being status-only, not toast-driven

## Non-goals
- Do not edit `App.jsx` unless there is an unavoidable compile break and you clearly call it out.
- Do not change `pdfMathService` interfaces.
- Do not change `pdfFallbackState` constants or reason codes.
- Do not change DB/schema logic.
- Do not invent new status text.

## Acceptance criteria
- PDF fallback uses `PdfReaderSurface` and no longer renders an iframe.
- HTML math copy behavior from `src/lib/mathCopy.js` is unchanged.
- PDF status UI reflects `loadStatus`, `mathCopyStatus`, and `mathCopyReason` using the exact frozen messages.
- The UI is prepared to move `loadStatus` from `"loading"` to `"ready"` on first-page `pdf.js` render success.
- Disabled capability states remain status-only and do not surface as toasts or banners.
- The UI remains stable even when Plan 2 currently yields `models_load_failed`.

## Final summary format
End your response with these exact sections:
- Implemented contract sections
- Files changed
- Public/frozen interfaces touched
- Deviations from Plan 0
- Dependencies for later plans
- Tests added or updated
- Open risks or unresolved gaps

If there are no contract changes, explicitly write:
`Deviations from Plan 0: none`
```
