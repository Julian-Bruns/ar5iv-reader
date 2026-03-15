export const PDF_FALLBACK_NOTICE =
  "Showing the PDF because this paper does not currently have a usable HTML view.";

export const PDF_LOAD_STATUSES = Object.freeze(["idle", "loading", "ready", "error"]);

export const PDF_MATH_COPY_STATUSES = Object.freeze([
  "pending",
  "disabled",
  "ready",
  "running",
  "error"
]);

export const PDF_MATH_COPY_REASONS = Object.freeze([
  "",
  "insecure_context",
  "worker_unsupported",
  "gpu_unavailable",
  "device_memory_too_low",
  "hardware_concurrency_too_low",
  "storage_free_too_low",
  "models_load_failed",
  "benchmark_too_slow",
  "benchmark_failed",
  "worker_error",
  "pdf_not_ready",
  "no_formula_detected",
  "ocr_empty",
  "copy_failed"
]);

export const PDF_MATH_COPY_DISABLE_NOTICE_SHOWN_KEY =
  "pdfMathCopyDisableNoticeShown";

export const INITIAL_PDF_FALLBACK_STATE = Object.freeze({
  blobUrl: "",
  relay: "",
  loadStatus: "idle",
  mathCopyStatus: "pending",
  mathCopyReason: ""
});

export function createInitialPdfFallbackState() {
  return { ...INITIAL_PDF_FALLBACK_STATE };
}

export function isPdfLoadStatus(value) {
  return PDF_LOAD_STATUSES.includes(value);
}

export function isPdfMathCopyStatus(value) {
  return PDF_MATH_COPY_STATUSES.includes(value);
}

export function isPdfMathCopyReason(value) {
  return PDF_MATH_COPY_REASONS.includes(value);
}
