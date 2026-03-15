# Plan 2 Prompt

Copy everything in the block below into the Plan 2 model.

```text
Repo: /Users/julian/.t3/worktrees/ar5iv-reader/t3code-09de8198

You are implementing Plan 2 of a larger feature. Follow the frozen contract exactly. Do not redesign the feature. Do not modify the frozen contract. If the contract is insufficient, stop and report the gap instead of inventing a new interface.

Your task is limited to the owned files for Plan 2:
- src/lib/db.js
- src/lib/pdfMathService.js
- src/lib/pdfMathWorker.js

You may add tightly-scoped helper modules under `src/lib/` only if they are internal to Plan 2 and you list them in the final summary.

You must not edit UI files or Plan 1/3/4 ownership files unless there is an unavoidable compile break and you explicitly call it out in your final summary.

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

### `pdfMathService` API and lifecycle
- Singleton module path: `src/lib/pdfMathService.js`
- Fixed model revision string: `"breezedeus-pix2text-v1"`
- Fixed model ids:
  - detector: `"breezedeus/pix2text-mfd"`
  - recognizer: `"breezedeus/pix2text-mfr"`

`status()` returns synchronously:

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

Method semantics:
- `prefetch(): Promise<StatusSnapshot>`
  - Idempotent across concurrent callers.
  - Does not change `refCount`.
  - Runs the full warm path once per app lifetime: live capability checks, `INIT`, `LOAD_MODELS`, `RUN_BENCHMARK`.
- `acquire(): Promise<StatusSnapshot>`
  - Increments `refCount`.
  - Ensures the worker is alive.
  - If prefetch already completed, it reuses that result.
  - If prefetch has not run yet, it runs the same initialization path.
- `release(): void`
  - Decrements `refCount`.
  - When `refCount` reaches `0` and no recognition request is in flight, sends `DISPOSE` and terminates the worker.
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

### Worker protocol
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

- `DISPOSE` is fire-and-forget and does not require a response.

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

### IndexedDB plan
- Bump `src/lib/db.js` from `DB_VERSION = 4` to `5`.
- Add store `mlModels`, keyPath `"key"`, indexes `"revision"` and `"modelId"`.
- `mlModels` record shape:

```js
{
  key: `${revision}::${modelId}::${filename}`,
  revision: string,
  modelId: string,
  filename: string,
  blob: Blob,
  size: number,
  updatedAt: string
}
```

- Add store `mlModelMeta`, keyPath `"key"`, index `"revision"`.
- `mlModelMeta` record shape:

```js
{
  key: modelId,
  revision: string,
  modelId: string,
  files: string[],
  updatedAt: string
}
```

- Add `SETTING_KEYS`:
  - `pdfMathCopyDisableNoticeShown`
  - `pdfMathCopyCapability`
  - `pdfMathCopyBenchmark`
  - `pdfMathCopyModelRevision`
- Setting values:

```js
pdfMathCopyDisableNoticeShown: boolean // reserved in v1, never read or written
pdfMathCopyCapability: { enabled: boolean, reason: string, checkedAt: string }
pdfMathCopyBenchmark: { durationMs: number | null, thresholdMs: 5000, passed: boolean, checkedAt: string }
pdfMathCopyModelRevision: "breezedeus-pix2text-v1"
```

- `SYNCABLE_SETTINGS` stays unchanged.
- Backup/export/import schema stays unchanged. New stores and new settings are local-only and are not included in snapshots or manifests.

### User-visible message mapping relevant to Plan 2
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
- No toast and no banner are shown for capability-gated disablement.

### File ownership
- Plan 2 owns:
  - `src/lib/db.js`
  - `src/lib/pdfMathService.js`
  - `src/lib/pdfMathWorker.js`
- Responsibility:
  - implement IDB v5
  - implement the singleton service
  - implement worker lifecycle
  - implement model cache
  - implement benchmark flow
  - implement the frozen worker protocol

### Dependency graph relevant to Plan 2
```text
Plan 2 -> Plan 3
Plan 2 -> Plan 4
Plan 2 -> Plan 5

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

## Plan 2 Objectives
- Implement the frozen `pdfMathService` API exactly.
- Implement the frozen worker request/response protocol exactly.
- Add the IndexedDB v5 schema changes exactly.
- Make `prefetch()` dedupe concurrent calls.
- Persist capability, benchmark, and model revision diagnostics.
- Keep this plan UI-agnostic. It should expose state and errors for later plans to render.

## Deliverables
- `src/lib/pdfMathService.js`
- `src/lib/pdfMathWorker.js`
- `src/lib/db.js` upgraded to v5 with the new stores and settings keys
- Any internal helper modules under `src/lib/` that are strictly necessary for Plan 2
- Tests for service protocol, IDB upgrade, and gate/benchmark behavior if you can add them without needing UI work

## Non-goals
- Do not implement `pdf.js`.
- Do not edit `App.jsx`.
- Do not edit `ReaderView.jsx`.
- Do not add PDF click handling UI.
- Do not invent new reason codes.
- Do not alter snapshot/export/import behavior.
- Do not add a separate mobile heuristic.

## Acceptance criteria
- IDB upgrade from v4 to v5 preserves papers/assets/settings and creates `mlModels` and `mlModelMeta`.
- `pdfMathService.prefetch()` dedupes concurrent calls and records capability, benchmark, and model revision settings.
- Each gate failure maps to the exact disabled reason code.
- Benchmark pass/fail behavior follows the frozen contract exactly.
- `status()` shape exactly matches the contract.
- `detectAndRecognize()` return shape exactly matches the contract.
- `DISPOSE` occurs when `refCount` reaches `0` and no recognition request is in flight.

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
