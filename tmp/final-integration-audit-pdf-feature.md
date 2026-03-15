# Final Integration Audit Prompt

Copy everything in the block below into the final integration model.

```text
Repo: /Users/julian/.t3/worktrees/ar5iv-reader/t3code-09de8198

You are doing the final integration audit and minimal cross-plan fixes for a multi-step PDF formula copy feature. Follow the frozen contract exactly. Do not redesign the feature. Do not invent missing runtime behavior. Fix only cross-plan integration gaps and contract drift.

You may edit:
- src/App.jsx
- tests as needed
- any file only if required to resolve a concrete cross-plan integration issue, and you must justify it in the final summary

You must not:
- change the frozen contract
- invent the OCR/model runtime that is still intentionally incomplete
- change reason codes, status strings, DB schema, or worker protocol unless you find a proven contract break and explicitly report it

## Current state from completed plans

### Plan 1
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
- `buildPdfFallbackPaper()` in `src/lib/fetchPaper.js` returns the exact frozen `pdfState` shape and notice.

### Plan 2
- `src/lib/pdfMathService.js` exists and exposes:
  - `status()`
  - `prefetch()`
  - `acquire()`
  - `release()`
  - `detectAndRecognize()`
- `src/lib/pdfMathWorker.js` implements the frozen worker protocol.
- `src/lib/pdfMathCommon.js` exists as an internal helper.
- `src/lib/db.js` is already on DB v5 with:
  - `mlModels`
  - `mlModelMeta`
  - local-only settings:
    - `pdfMathCopyDisableNoticeShown`
    - `pdfMathCopyCapability`
    - `pdfMathCopyBenchmark`
    - `pdfMathCopyModelRevision`
- Important limitation that remains intentionally unresolved:
  - `LOAD_MODELS` currently reports `models_load_failed` until a concrete runtime is later defined by contract.

### Plan 3
- `src/App.jsx` owns fallback hydration through one `primePdfFallbackPaper(tabKey, paper)` path.
- App already:
  - inserts PDF papers with `pdfState.loadStatus = "loading"`
  - starts `fetchBlobWithFallback(paper.pdfUrl)` immediately and non-blockingly
  - starts `pdfMathService.prefetch()` immediately and non-blockingly
  - patches `paper.pdfState.blobUrl`, `relay`, `mathCopyStatus`, and `mathCopyReason`
  - revokes blob URLs on supersede, replacement, and close
  - manages `pdfMathService.status()/prefetch()/acquire()/release()` lifecycle

### Plan 4
- `ReaderView.jsx` replaced the iframe branch with `PdfReaderSurface.jsx`.
- Internal helpers added:
  - `pdfSurfaceStatus.js`
  - `pdfJsClient.js`
- `PdfReaderSurface.jsx`:
  - renders frozen PDF status text
  - gates recognition on `loadStatus === "ready"` and `mathCopyStatus === "ready"`
  - uses `pdfMathService.detectAndRecognize()` for the copy path
- `ReaderView` now accepts optional:
  - `onPdfFirstPageRender`
  - `onPdfRenderFailure`
- Important open gap from Plan 4:
  - App was not updated to wire those callbacks back into `paper.pdfState`

### Plan 5
- `pdfjs-dist` is now installed in `package.json`
- tests were expanded and build/test pass
- Important open gap still remains:
  - `ReaderView` exposes `onPdfFirstPageRender` / `onPdfRenderFailure`, but `App.jsx` still does not wire them back into `paper.pdfState`
- The OCR/model runtime is still intentionally incomplete and tests lock in current `models_load_failed` behavior

## Frozen Contract

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

### `pdfMathService` API
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

### Worker protocol and DB schema
- Treat both as frozen and already implemented.
- Audit only for drift. Do not redesign them.

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

## Objective
- Perform a final cross-plan audit and apply the minimal code changes needed to make the implemented feature coherent against the frozen contract.

## Required work
1. Audit the current implementation for cross-plan drift.
2. Fix the known `App.jsx` integration gap so the UI callbacks from `ReaderView` / `PdfReaderSurface` actually patch App-owned `paper.pdfState`:
   - first-page render success must set `pdfState.loadStatus = "ready"`
   - PDF render/document failure must set `pdfState.loadStatus = "error"` and clear blob usage if required by the current code path
3. Verify the callback wiring does not break the existing App-owned preload and blob lifecycle.
4. Re-run tests/build and report any remaining gaps.

## Non-goals
- Do not implement the missing OCR/model runtime.
- Do not change `models_load_failed` behavior that is already intentionally locked in.
- Do not redesign PDF state ownership away from `App.jsx`.
- Do not change reason codes, worker protocol, or DB schema unless you find an actual contract mismatch.

## Acceptance criteria
- `ReaderView` callbacks are wired into `App.jsx` so `paper.pdfState.loadStatus` can actually transition from `"loading"` to `"ready"` and `"error"` end-to-end.
- Existing preload behavior and blob URL lifecycle remain correct.
- Tests/build pass.
- Final response clearly separates:
  - issues fixed
  - issues intentionally left unresolved
  - residual risks

## Final response format
Present findings first if any remain. Then include:
- Fixes applied
- Files changed
- Contract deviations found
- Tests/build run
- Remaining gaps

If there are no contract deviations, explicitly say:
`Contract deviations found: none`
```
