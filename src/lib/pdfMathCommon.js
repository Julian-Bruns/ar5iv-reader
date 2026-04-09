import { isPdfMathCopyReason } from "./pdfFallbackState";

export const PDF_MATH_MODEL_REVISION = "breezedeus-pix2text-v1";
export const PDF_MATH_BENCHMARK_THRESHOLD_MS = 5_000;
export const PDF_MATH_MODELS = Object.freeze([
  Object.freeze({
    role: "detector",
    modelId: "breezedeus/pix2text-mfd"
  }),
  Object.freeze({
    role: "recognizer",
    modelId: "breezedeus/pix2text-mfr"
  })
]);

export function createPdfMathStatusSnapshot({
  phase = "idle",
  installed = false,
  enabled = false,
  reason = "",
  benchmarkMs = null,
  refCount = 0,
  progress = null
} = {}) {
  return {
    phase,
    installed,
    enabled,
    reason,
    benchmarkMs,
    modelRevision: PDF_MATH_MODEL_REVISION,
    refCount,
    progress: normalizeProgress(progress)
  };
}

export function createPdfMathResult(result = {}) {
  return {
    status: result.status === "ok" ? "ok" : "no-match",
    latex: String(result.latex || ""),
    confidence: Number.isFinite(result.confidence) ? result.confidence : null,
    bounds: normalizeBounds(result.bounds),
    reason: normalizeResultReason(result.reason)
  };
}

export function createPdfMathLayoutResult(result = {}) {
  return {
    bounds: Array.isArray(result.bounds)
      ? result.bounds.map((bounds) => normalizeBounds(bounds)).filter(Boolean)
      : []
  };
}

export function createPdfMathError(code, message = "", fatal = false) {
  const normalizedCode = normalizeErrorCode(code);
  const error = new Error(String(message || normalizedCode));
  error.code = normalizedCode;
  error.fatal = Boolean(fatal);
  return error;
}

export function normalizeErrorCode(code) {
  return isPdfMathCopyReason(code) && code !== "" ? code : "worker_error";
}

export function buildPdfMathRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `pdf-math-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const normalized = {
    x: Number(bounds.x),
    y: Number(bounds.y),
    width: Number(bounds.width),
    height: Number(bounds.height)
  };

  return Object.values(normalized).every((value) => Number.isFinite(value)) ? normalized : null;
}

function normalizeResultReason(reason) {
  return reason === "no_formula_detected" || reason === "ocr_empty" ? reason : "";
}

function normalizeProgress(progress) {
  if (!progress || typeof progress !== "object") {
    return null;
  }

  return {
    loadedBytes: Number(progress.loadedBytes || 0),
    totalBytes:
      progress.totalBytes == null || Number.isNaN(Number(progress.totalBytes))
        ? null
        : Number(progress.totalBytes),
    etaMs:
      progress.etaMs == null || Number.isNaN(Number(progress.etaMs))
        ? null
        : Number(progress.etaMs),
    stage: String(progress.stage || "").trim(),
    oneTime: Boolean(progress.oneTime)
  };
}
