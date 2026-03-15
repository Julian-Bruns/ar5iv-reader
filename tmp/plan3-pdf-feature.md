# Plan 3 Prompt

Copy everything in the block below into the Plan 3 model.

```text
Repo: /Users/julian/.t3/worktrees/ar5iv-reader/t3code-09de8198

You are implementing Plan 3 of a larger feature. Follow the frozen contract exactly. Do not redesign the feature. Do not modify the frozen contract. If the contract is insufficient, stop and report the gap instead of inventing a new interface.

Plan 1 and Plan 2 are already complete. Use their outputs as the source of truth for existing interfaces.

Your task is limited to the owned files for Plan 3:
- src/App.jsx
- src/lib/readerTabs.js if needed

You may add tightly-scoped helper modules under `src/lib/` only if they are internal to Plan 3 and you list them in the final summary.

You must not edit UI files or Plan 1/2/4 ownership files unless there is an unavoidable compile break and you explicitly call it out in your final summary.

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
- `buildPdfFallbackPaper()` in `src/lib/fetchPaper.js` now guarantees the exact initial `pdfState` shape.

### From Plan 2
- `src/lib/pdfMathService.js` exists and exposes:
  - `status()`
  - `prefetch()`
  - `acquire()`
  - `release()`
  - `detectAndRecognize()`
- `prefetch()` is deduped and persists capability / benchmark / model revision diagnostics.
- `db.js` already contains DB v5 and local-only PDF math settings.
- `pdfMathWorker.js` keeps the protocol exact, but `LOAD_MODELS` currently reports `models_load_failed` until a concrete runtime is later implemented by contract.

Treat those outputs as fixed. Do not rename them.

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

### `pdfMathService` API and lifecycle relevant to Plan 3
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

- `prefetch(): Promise<StatusSnapshot>`
  - Idempotent across concurrent callers.
  - Does not change `refCount`.
- `acquire(): Promise<StatusSnapshot>`
  - Increments `refCount`.
  - Ensures the worker is alive.
- `release(): void`
  - Decrements `refCount`.
  - When `refCount` reaches `0` and no recognition request is in flight, disposes the worker.

### User-visible messages relevant to Plan 3
- No toast and no banner are shown for capability-gated disablement.
- Capability-gated disablement appears only in PDF status UI in later plans.
- Plan 3 may continue to use existing toasts for fallback-open events already present in `App.jsx`.

### File ownership
- Plan 3 owns:
  - `src/App.jsx`
  - `src/lib/readerTabs.js` if needed
- Responsibility:
  - own fallback-entry integration
  - own blob preload
  - own `prefetch()` kickoff
  - own tab/reader `pdfState` patching
  - own blob URL revocation

### Dependency graph relevant to Plan 3
```text
Plan 1 -> Plan 3
Plan 2 -> Plan 3
Plan 3 -> Plan 4
Plan 3 -> Plan 5

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

## Plan 3 Objectives
- Add `primePdfFallbackPaper(tabKey, paper)` to `src/App.jsx` and route both existing PDF fallback branches through it.
- Start PDF blob fetch and `pdfMathService.prefetch()` immediately and non-blockingly from that one helper.
- Patch tab and reader state so PDF tabs move through the frozen `pdfState` transitions correctly.
- Integrate `pdfMathService.status()` into App-owned PDF paper state updates where appropriate.
- Manage object URL lifetime safely:
  - revoke old blob URLs when superseded
  - revoke blob URLs when PDF tabs close
  - revoke blob URLs when a PDF tab is replaced
- Manage `pdfMathService.acquire()` / `release()` against open PDF tab lifecycle in App, not in UI files.

## Required implementation details
- `primePdfFallbackPaper(tabKey, paper)` must be the single entrypoint for PDF fallback hydration from both existing fallback branches in `App.jsx`.
- It must insert the paper into state first with `pdfState.loadStatus = "loading"` before starting asynchronous work.
- Blob fetch and service prefetch must be kicked off without blocking reader rendering.
- On blob fetch success:
  - create an object URL
  - write `pdfState.blobUrl`
  - write `pdfState.relay`
  - leave `loadStatus` as `"loading"`
- On blob fetch failure:
  - clear `pdfState.blobUrl`
  - set `loadStatus = "error"`
- `prefetch()` result mapping:
  - if service becomes ready, set `mathCopyStatus = "ready"` and clear `mathCopyReason`
  - if service disables itself, set `mathCopyStatus = "disabled"` and set the exact reason
  - if service reports an infrastructure error, map to `mathCopyStatus = "disabled"` or `"error"` only if that matches the frozen contract
- App must not attempt to call `detectAndRecognize()` in this plan.
- App may call `acquire()` / `release()` to keep the service alive for open PDF tabs, but this must be lifecycle-only, not UI-triggered.

## Constraints from Plan 2 summary
- The service currently does not truly load models yet; `prefetch()` may resolve into a disabled/error path because `LOAD_MODELS` currently reports `models_load_failed`.
- Plan 3 must handle that cleanly and persist the resulting `pdfState` for later UI rendering.
- Do not try to solve the missing runtime in this plan.

## Deliverables
- `src/App.jsx` updated with:
  - one canonical `primePdfFallbackPaper(tabKey, paper)` helper
  - shared PDF fallback hydration path
  - PDF blob fetch lifecycle management
  - `pdfMathService.prefetch()` integration
  - service acquire/release integration tied to PDF tab lifecycle if implemented here
- `src/lib/readerTabs.js` only if a small helper is truly necessary
- Tests for:
  - both existing PDF fallback entrypoints using the same preload helper
  - blob URL revocation behavior
  - service prefetch state mapping
  - release behavior when no PDF tab remains, if you implement acquire/release here

## Non-goals
- Do not implement `pdf.js`.
- Do not edit `ReaderView.jsx`.
- Do not add new PDF UI.
- Do not change `pdfMathService` interfaces.
- Do not change `pdfFallbackState` constants or reason codes.
- Do not implement OCR runtime details.

## Acceptance criteria
- Both existing PDF fallback entrypoints in `App.jsx` call the same preload path.
- `primePdfFallbackPaper()` updates reader/tab state with the frozen `pdfState` semantics.
- Blob fetch and `prefetch()` are both started immediately and non-blockingly.
- Blob URLs are revoked on replacement, close, and supersede.
- Plan 3 cleanly handles the current Plan 2 behavior where model load may fail with `models_load_failed`.
- No UI files are changed.

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
