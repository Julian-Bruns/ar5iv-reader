# Plan 1 Prompt

Copy everything in the block below into the Plan 1 model.

```text
Repo: /Users/julian/.t3/worktrees/ar5iv-reader/t3code-09de8198

You are implementing Plan 1 of a larger feature. Follow the frozen contract exactly. Do not redesign the feature. Do not modify the frozen contract. If the contract is insufficient, stop and report the gap instead of inventing a new interface.

Your task is limited to the owned files for Plan 1:
- src/lib/fetchPaper.js
- src/lib/pdfFallbackState.js

You must not edit files owned by later plans unless there is an unavoidable compile break and you explicitly call it out in your final summary.

## Frozen Contract

### Summary
- Replace the PDF fallback `<iframe>` in `src/components/ReaderView.jsx` with an in-app `pdf.js` surface in later plans.
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

- `buildPdfFallbackPaper()` initial value is exactly:

```js
pdfState: {
  blobUrl: "",
  relay: "",
  loadStatus: "idle",
  mathCopyStatus: "pending",
  mathCopyReason: ""
}
```

- HTML papers are unchanged and do not get `pdfState`.

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

### User-visible messages relevant to Plan 1
- Fallback notice banner text: `Showing the PDF because this paper does not currently have a usable HTML view.`

### File ownership
- Plan 1 owns:
  - `src/lib/fetchPaper.js`
  - `src/lib/pdfFallbackState.js`
- Responsibility:
  - define the canonical PDF paper shape
  - define initial `pdfState`
  - define reason-code constants
  - define the updated fallback notice string

### Dependency graph relevant to Plan 1
```text
Plan 1 -> Plan 2
Plan 1 -> Plan 3
Plan 1 -> Plan 4

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
- `pdfMathCopyCapability` and `pdfMathCopyBenchmark` are diagnostic caches, not authoritative forever; live checks rerun on first `prefetch()` after each page load.
- Saved-library behavior is unchanged: PDF fallback sessions are still not saved offline in v1.

## Plan 1 Objectives
- Update `buildPdfFallbackPaper()` so every PDF fallback paper has the exact frozen `pdfState` shape.
- Centralize PDF fallback state helpers and constants in `src/lib/pdfFallbackState.js`.
- Ensure the fallback notice string exactly matches the contract.
- Keep `fetchPaper.js` free of preload or async hydration behavior.
- Keep all HTML paper behavior unchanged.

## Deliverables
- `src/lib/pdfFallbackState.js` exporting the canonical initial `pdfState`, allowed reason codes, and any tiny helpers needed by later plans.
- `src/lib/fetchPaper.js` updated to use that canonical shape.
- Any tests needed for the PDF paper-shape contract in existing or new test files, if test ownership can be done without stepping on later plan scope. If you choose not to add tests here, explain why in the final summary.

## Non-goals
- Do not implement `pdf.js`.
- Do not implement `pdfMathService`.
- Do not edit `App.jsx`.
- Do not edit `ReaderView.jsx`.
- Do not add IndexedDB schema changes.
- Do not add new UI.

## Acceptance criteria
- `buildPdfFallbackPaper()` returns the exact `pdfState` shape from the contract.
- The fallback notice text exactly matches the contract.
- HTML papers remain unchanged and do not get `pdfState`.
- There is a reusable source of truth for PDF fallback state and reason codes for later plans.
- No preload logic is added to `fetchPaper.js`.

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
