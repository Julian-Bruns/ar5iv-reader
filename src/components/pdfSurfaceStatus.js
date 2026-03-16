const LOAD_STATUS_MESSAGES = Object.freeze({
  loading: "Loading PDF…",
  error: "PDF failed to load."
});

const MATH_STATUS_MESSAGES = Object.freeze({
  pending: "Click an equation to enable LaTeX copy.",
  preparing: "Preparing PDF math copy…",
  ready: "Click an equation to copy LaTeX.",
  running: "Recognizing equation…"
});

const MATH_REASON_MESSAGES = Object.freeze({
  insecure_context: "PDF math copy requires a secure context.",
  worker_unsupported: "PDF math copy requires Web Workers.",
  gpu_unavailable: "PDF math copy requires navigator.gpu.",
  device_memory_too_low: "PDF math copy requires at least 8 GB of device memory.",
  hardware_concurrency_too_low: "PDF math copy requires at least 8 CPU threads.",
  storage_free_too_low: "PDF math copy requires at least 1 GB of free storage.",
  models_load_failed: "PDF math copy could not be prepared on this device.",
  worker_error: "PDF math copy could not be prepared on this device.",
  benchmark_too_slow: "PDF math copy was disabled because setup exceeded 5 seconds.",
  benchmark_failed: "PDF math copy benchmark failed.",
  no_formula_detected: "No formula was detected at that location.",
  ocr_empty: "The equation could not be recognized."
});

export function canRunPdfMathCopy(pdfState) {
  return (
    pdfState?.loadStatus === "ready" && pdfState?.mathCopyStatus === "ready"
  );
}

export function getPdfSurfaceStatus(pdfState, interactionState = null) {
  const effectiveLoadStatus = interactionState?.loadStatus || pdfState?.loadStatus || "loading";
  if (effectiveLoadStatus === "error") {
    return {
      tone: "error",
      text: LOAD_STATUS_MESSAGES.error
    };
  }

  if (effectiveLoadStatus !== "ready") {
    return {
      tone: "pending",
      text: LOAD_STATUS_MESSAGES.loading
    };
  }

  const effectiveMathStatus =
    interactionState?.mathCopyStatus || pdfState?.mathCopyStatus || "pending";
  const effectiveMathReason =
    interactionState?.mathCopyReason ?? pdfState?.mathCopyReason ?? "";

  if (effectiveMathStatus === "running") {
    return {
      tone: "pending",
      text: MATH_STATUS_MESSAGES.running
    };
  }

  if (effectiveMathStatus === "pending" && interactionState?.activating) {
    return {
      tone: "pending",
      text: MATH_STATUS_MESSAGES.preparing
    };
  }

  if (effectiveMathReason && MATH_REASON_MESSAGES[effectiveMathReason]) {
    return {
      tone: effectiveMathStatus === "error" ? "error" : "disabled",
      text: MATH_REASON_MESSAGES[effectiveMathReason]
    };
  }

  if (effectiveMathStatus === "ready") {
    return {
      tone: "ready",
      text: MATH_STATUS_MESSAGES.ready
    };
  }

  return {
    tone: "pending",
    text: MATH_STATUS_MESSAGES.pending
  };
}

export const PDF_SURFACE_STATUS_MESSAGES = Object.freeze({
  ...LOAD_STATUS_MESSAGES,
  ...MATH_STATUS_MESSAGES,
  ...MATH_REASON_MESSAGES
});
