# Plan 5 Prompt

Copy everything in the block below into the Plan 5 model.

```text
Repo: /Users/julian/.t3/worktrees/ar5iv-reader/t3code-09de8198

You are implementing Plan 5 of a larger feature. Follow the frozen contract exactly. Do not redesign the feature. Do not modify the frozen contract. If the contract is insufficient, stop and report the gap instead of inventing a new interface.

Plans 1, 2, 3, and 4 are already complete. Use their outputs as the source of truth for existing interfaces and current gaps.

Your task is limited to the owned files for Plan 5:
- package.json
- vite.config.js if required
- new `*.test.*` files

You may update existing test files if needed to keep the regression suite coherent. Do not edit App/runtime/UI files unless there is an unavoidable compile or test harness break and you explicitly call it out in your final summary.

## Inputs from prior plans

### From Plan 1
- `src/lib/pdfFallbackState.js` is now the source of truth for:
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
- `src/lib/pdfMathWorker.js` implements the frozen worker protocol surface.
- `src/lib/pdfMathCommon.js` exists as an internal helper for fixed revision/model ids and protocol normalization.
- `db.js` is already on DB v5 with `mlModels`, `mlModelMeta`, and the local-only PDF math settings.
- Important current limitation from Plan 2 summary:
  - `LOAD_MODELS` currently reports `models_load_failed` until a concrete runtime is later defined by contract.

### From Plan 3
- `src/App.jsx` now owns fallback hydration through a single `primePdfFallbackPaper(tabKey, paper)` path.
- App already:
  - inserts PDF papers with `pdfState.loadStatus = "loading"`
  - starts `fetchBlobWithFallback(paper.pdfUrl)` immediately and non-blockingly
  - starts `pdfMathService.prefetch()` immediately and non-blockingly
  - patches `paper.pdfState.blobUrl`, `relay`, `mathCopyStatus`, and `mathCopyReason`
  - revokes blob URLs on supersede, replacement, and close
  - manages `pdfMathService.status()/prefetch()/acquire()/release()` lifecycle
- Important current limitation from Plan 3 summary:
  - `pdfState.loadStatus` cannot reach `"ready"` until Plan 4 callbacks are wired back into App-owned state

### From Plan 4
- `ReaderView.jsx` replaced the iframe branch with `PdfReaderSurface.jsx`.
- Added internal helpers:
  - `pdfSurfaceStatus.js`
  - `pdfJsClient.js`
- `PdfReaderSurface.jsx` now:
  - renders frozen PDF status text
  - gates recognition on `loadStatus === "ready"` and `mathCopyStatus === "ready"`
  - uses `pdfMathService.detectAndRecognize()` for copy flow
- Important current limitations from Plan 4 summary:
  - `pdfjs-dist` is not yet installed; `pdfJsClient.js` lazy-loads it so the build stays green
  - `ReaderView` now accepts optional `onPdfFirstPageRender` and `onPdfRenderFailure` props, but App was not updated in Plan 4 to wire those callbacks into `paper.pdfState`

Treat all those outputs as fixed unless a test/build issue forces a minimal compatibility adjustment, and if that happens, report it explicitly.

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

### `pdfMathService` API relevant to Plan 5 verification
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

- `prefetch()` is idempotent across concurrent callers.
- `release()` disposes when `refCount` reaches `0` and no recognition request is in flight.
- `detectAndRecognize()` returns:

```js
{
  status: "ok" | "no-match",
  latex: string,
  confidence: number | null,
  bounds: { x: number, y: number, width: number, height: number } | null,
  reason: "" | "no_formula_detected" | "ocr_empty"
}
```

### Worker protocol relevant to Plan 5 verification
```js
// Requests
{ type: "INIT", requestId: string, payload: { modelRevision: "breezedeus-pix2text-v1" } }
{ type: "LOAD_MODELS", requestId: string, payload: {
    modelRevision: "breezedeus-pix2text-v1",
    models: [
      { role: "detector", modelId: "breezedeus/pix2text-mfd" },
      { role: "recognizer", modelId: "breezedeus/pix2text-mfr" }
    ]
} }
{ type: "RUN_BENCHMARK", requestId: string, payload: { thresholdMs: 5000 } }
{ type: "DETECT_AND_RECOGNIZE", requestId: string, payload: {
    imageBitmap: ImageBitmap,
    clickPoint: { x: number, y: number },
    cropRect: { x: number, y: number, width: number, height: number }
} }
{ type: "DISPOSE", requestId: string, payload: {} }

// Responses
{ type: "READY", requestId: string, payload: { stage: "init" | "models" } }
{ type: "PROGRESS", requestId: string, payload: {
    stage: "download" | "load",
    modelId: string,
    loadedBytes: number,
    totalBytes: number | null
} }
{ type: "BENCHMARK_RESULT", requestId: string, payload: {
    durationMs: number,
    passed: boolean,
    thresholdMs: 5000
} }
{ type: "RESULT", requestId: string, payload: {
    status: "ok" | "no-match",
    latex: string,
    confidence: number | null,
    bounds: { x: number, y: number, width: number, height: number } | null,
    reason: "" | "no_formula_detected" | "ocr_empty"
} }
{ type: "ERROR", requestId: string, payload: {
    code: string,
    message: string,
    fatal: boolean
} }
```

### Enablement gates
Feature is enabled only if all of these pass:
1. `window.isSecureContext === true`
2. `typeof Worker === "function"`
3. `navigator.gpu` exists
4. `Number(navigator.deviceMemory) >= 8`
5. `Number(navigator.hardwareConcurrency) >= 8`
6. `navigator.storage.estimate()` exists and `quota - usage >= 1_000_000_000`
7. `LOAD_MODELS` succeeds
8. `RUN_BENCHMARK` returns `durationMs <= 5000`

### IndexedDB plan relevant to Plan 5 verification
- `db.js` is on `DB_VERSION = 5`.
- Stores:
  - `mlModels`
  - `mlModelMeta`
- Local-only settings keys:
  - `pdfMathCopyDisableNoticeShown`
  - `pdfMathCopyCapability`
  - `pdfMathCopyBenchmark`
  - `pdfMathCopyModelRevision`
- `SYNCABLE_SETTINGS` remains unchanged.
- Backup/export/import stays unchanged.

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
- Plan 5 owns:
  - `package.json`
  - `vite.config.js` if required
  - new `*.test.*` files
- Responsibility:
  - add dependency/build wiring
  - add regression tests for fetch contract, IDB upgrade, service protocol, preload flow, and PDF UI behavior

### Dependency graph relevant to Plan 5
```text
Plan 1/2/3/4 -> Plan 5

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

## Plan 5 Objectives
- Add the build dependency/wiring needed for real `pdf.js` loading in the current repo.
- Strengthen automated coverage around the frozen contract across Plans 1-4.
- Keep Plan 5 focused on dependency/build/test work.
- Do not silently fix the open App callback wiring gap unless it is absolutely necessary to make the build or tests coherent. If it remains out of scope, call it out clearly.

## Required implementation details
- Add the dependency required by `pdfJsClient.js` so real PDF rendering can be wired in by the existing UI code.
- If `vite.config.js` needs adjustment for worker/assets used by `pdfjs-dist`, do the minimal required change.
- Add or update tests to cover:
  - `buildPdfFallbackPaper()` exact `pdfState` shape and notice
  - IDB v4 -> v5 upgrade preserving old stores and adding `mlModels` / `mlModelMeta`
  - `pdfMathService.prefetch()` dedupe and diagnostic persistence
  - service gate failure mapping
  - worker protocol request/response contract shape
  - both PDF fallback entrypoints routing through the shared preload path
  - blob URL revocation lifecycle
  - ReaderView using `PdfReaderSurface` instead of an iframe
  - HTML math copy behavior remaining unchanged
  - PDF status text rendering
  - disabled/error math-copy states staying status-only
- If a test cannot be made meaningful because of the known App callback gap or unresolved OCR runtime, test the highest stable contract surface and explicitly note the remaining integration gap in the final summary.

## Constraints from current state
- The OCR/model runtime is still intentionally incomplete; do not invent or implement it here.
- The current open gap is:
  - `onPdfFirstPageRender` / `onPdfRenderFailure` exist in UI contract but are not yet wired back into App-owned `paper.pdfState`
- Because Plan 5 does not own `App.jsx`, prefer documenting and testing around that gap rather than editing App unless absolutely necessary.

## Deliverables
- `package.json` updated with required dependency wiring
- `vite.config.js` updated only if necessary
- New or updated test files giving coherent coverage across Plans 1-4
- A clear note in the final summary about whether the App callback wiring gap remains and why

## Non-goals
- Do not change `pdfMathService` interfaces.
- Do not change `pdfFallbackState` constants or reason codes.
- Do not change DB/schema contracts.
- Do not invent new UI strings.
- Do not implement the missing OCR runtime.
- Do not silently absorb App ownership work into this plan.

## Acceptance criteria
- The repo has the dependency/build wiring needed for actual `pdf.js` loading.
- Automated tests cover the frozen contract surfaces introduced by Plans 1-4.
- Existing build and test commands pass.
- Any remaining integration gap is explicitly called out rather than hidden.

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
