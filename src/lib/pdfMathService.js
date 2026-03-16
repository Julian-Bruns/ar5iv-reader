import { setSetting, SETTING_KEYS } from "./db";
import {
  buildPdfMathRequestId,
  createPdfMathError,
  createPdfMathResult,
  createPdfMathStatusSnapshot,
  normalizeErrorCode,
  PDF_MATH_BENCHMARK_THRESHOLD_MS,
  PDF_MATH_MODELS,
  PDF_MATH_MODEL_REVISION
} from "./pdfMathCommon";

let currentStatus = createPdfMathStatusSnapshot();
let warmupPromise = null;
let warmupComplete = false;
let warmupSucceeded = false;
let workerHandle = null;
let workerModelsReady = false;
let recognitionCount = 0;

export function status() {
  return {
    ...currentStatus
  };
}

export async function prefetch() {
  if (warmupComplete) {
    return status();
  }

  if (!warmupPromise) {
    warmupPromise = runInitialWarmup().finally(() => {
      warmupComplete = true;
      warmupPromise = null;
    });
  }

  return warmupPromise;
}

export async function acquire() {
  setRefCount(currentStatus.refCount + 1);

  if (!warmupComplete) {
    return prefetch();
  }

  if (!warmupSucceeded) {
    return status();
  }

  if (workerModelsReady && workerHandle?.worker) {
    currentStatus = createPdfMathStatusSnapshot({
      phase: "ready",
      enabled: true,
      benchmarkMs: currentStatus.benchmarkMs,
      refCount: currentStatus.refCount
    });
    return status();
  }

  updatePhase({
    phase: "checking",
    enabled: false,
    reason: "",
    benchmarkMs: currentStatus.benchmarkMs
  });

  try {
    await ensureWorkerModelsLoaded();
    updatePhase({
      phase: "ready",
      enabled: true,
      reason: "",
      benchmarkMs: currentStatus.benchmarkMs
    });
  } catch (error) {
    handleWorkerFailure(error);
  }

  return status();
}

export function release() {
  if (currentStatus.refCount === 0) {
    return;
  }

  setRefCount(currentStatus.refCount - 1);
  void disposeWorkerIfIdle();
}

export async function detectAndRecognize({ imageBitmap, clickPoint, cropRect }) {
  if (!workerHandle?.worker || !workerModelsReady || currentStatus.phase !== "ready") {
    throw createPdfMathError("pdf_not_ready", "PDF math worker is not ready.", false);
  }

  recognitionCount += 1;
  try {
    const result = await sendWorkerRequest(
      "DETECT_AND_RECOGNIZE",
      {
        imageBitmap,
        clickPoint: normalizePoint(clickPoint),
        cropRect: normalizeRect(cropRect)
      },
      imageBitmap ? [imageBitmap] : []
    );

    return createPdfMathResult(result);
  } catch (error) {
    throw createPdfMathError(
      error?.code,
      error?.message || "PDF math recognition failed.",
      Boolean(error?.fatal)
    );
  } finally {
    recognitionCount = Math.max(0, recognitionCount - 1);
    void disposeWorkerIfIdle();
  }
}

async function runInitialWarmup() {
  updatePhase({
    phase: "checking",
    enabled: false,
    reason: "",
    benchmarkMs: null
  });

  const capability = await runCapabilityChecks();
  await persistSettingSafely(SETTING_KEYS.pdfMathCopyCapability, capability);

  if (!capability.enabled) {
    warmupSucceeded = false;
    updatePhase({
      phase: "disabled",
      enabled: false,
      reason: capability.reason,
      benchmarkMs: null
    });
    return status();
  }

  await persistSettingSafely(SETTING_KEYS.pdfMathCopyModelRevision, PDF_MATH_MODEL_REVISION);

  try {
    await ensureWorkerModelsLoaded();
  } catch (error) {
    warmupSucceeded = false;
    handleWorkerFailure(error, {
      preserveBenchmarkMs: false
    });
    return status();
  }

  let benchmark;
  try {
    benchmark = await sendWorkerRequest("RUN_BENCHMARK", {
      thresholdMs: PDF_MATH_BENCHMARK_THRESHOLD_MS
    });
  } catch (error) {
    benchmark = null;
    await persistSettingSafely(SETTING_KEYS.pdfMathCopyBenchmark, {
      durationMs: null,
      thresholdMs: PDF_MATH_BENCHMARK_THRESHOLD_MS,
      passed: false,
      checkedAt: new Date().toISOString()
    });
    warmupSucceeded = false;
    updatePhase({
      phase: "error",
      enabled: false,
      reason: "benchmark_failed",
      benchmarkMs: null
    });
    return status();
  }

  const benchmarkMs = Number(benchmark?.durationMs);
  const passed =
    Boolean(benchmark?.passed) && Number.isFinite(benchmarkMs) && benchmarkMs <= PDF_MATH_BENCHMARK_THRESHOLD_MS;

  await persistSettingSafely(SETTING_KEYS.pdfMathCopyBenchmark, {
    durationMs: Number.isFinite(benchmarkMs) ? benchmarkMs : null,
    thresholdMs: PDF_MATH_BENCHMARK_THRESHOLD_MS,
    passed,
    checkedAt: new Date().toISOString()
  });

  if (!passed) {
    warmupSucceeded = false;
    updatePhase({
      phase: "disabled",
      enabled: false,
      reason: "benchmark_too_slow",
      benchmarkMs: Number.isFinite(benchmarkMs) ? benchmarkMs : null
    });
    return status();
  }

  warmupSucceeded = true;
  updatePhase({
    phase: "ready",
    enabled: true,
    reason: "",
    benchmarkMs
  });
  return status();
}

async function runCapabilityChecks() {
  const secureContext = typeof window !== "undefined" && window.isSecureContext === true;
  if (!secureContext) {
    return createCapabilityResult(false, "insecure_context");
  }

  if (typeof Worker !== "function") {
    return createCapabilityResult(false, "worker_unsupported");
  }

  if (!globalThis.navigator?.gpu) {
    return createCapabilityResult(false, "gpu_unavailable");
  }

  if (Number(globalThis.navigator?.deviceMemory) < 8) {
    return createCapabilityResult(false, "device_memory_too_low");
  }

  if (Number(globalThis.navigator?.hardwareConcurrency) < 8) {
    return createCapabilityResult(false, "hardware_concurrency_too_low");
  }

  return createCapabilityResult(true, "");
}

function createCapabilityResult(enabled, reason) {
  return {
    enabled,
    reason,
    checkedAt: new Date().toISOString()
  };
}

async function ensureWorkerModelsLoaded() {
  const handle = ensureWorkerHandle();
  if (workerModelsReady) {
    return handle;
  }

  await sendWorkerRequest("INIT", {
    modelRevision: PDF_MATH_MODEL_REVISION
  });
  await sendWorkerRequest("LOAD_MODELS", {
    modelRevision: PDF_MATH_MODEL_REVISION,
    models: PDF_MATH_MODELS.map((model) => ({
      role: model.role,
      modelId: model.modelId
    }))
  });
  workerModelsReady = true;
  return handle;
}

function ensureWorkerHandle() {
  if (workerHandle?.worker) {
    return workerHandle;
  }

  const worker = new Worker(new URL("./pdfMathWorker.js", import.meta.url), {
    type: "module"
  });
  const handle = {
    worker,
    pending: new Map()
  };

  worker.onmessage = (event) => {
    const message = event?.data;
    const requestId = String(message?.requestId || "");
    const pendingRequest = handle.pending.get(requestId);
    if (!pendingRequest) {
      return;
    }

    if (message?.type === "PROGRESS") {
      return;
    }

    if (message?.type === "ERROR") {
      handle.pending.delete(requestId);
      const error = createPdfMathError(
        message?.payload?.code,
        message?.payload?.message || "PDF math worker error.",
        Boolean(message?.payload?.fatal)
      );
      pendingRequest.reject(error);
      if (error.fatal) {
        handleWorkerFailure(error, {
          preserveBenchmarkMs: true
        });
      }
      return;
    }

    if (!pendingRequest.accepts(message)) {
      return;
    }

    handle.pending.delete(requestId);
    pendingRequest.resolve(message?.payload || {});
  };

  worker.onerror = () => {
    handleWorkerFailure(createPdfMathError("worker_error", "PDF math worker crashed.", true), {
      preserveBenchmarkMs: true
    });
  };

  worker.onmessageerror = () => {
    handleWorkerFailure(
      createPdfMathError("worker_error", "PDF math worker message decoding failed.", true),
      {
        preserveBenchmarkMs: true
      }
    );
  };

  workerHandle = handle;
  workerModelsReady = false;
  return handle;
}

function sendWorkerRequest(type, payload, transfer = []) {
  const handle = ensureWorkerHandle();
  const requestId = buildPdfMathRequestId();

  return new Promise((resolve, reject) => {
    handle.pending.set(requestId, {
      accepts: (message) => acceptsResponse(type, message),
      resolve,
      reject
    });

    try {
      handle.worker.postMessage(
        {
          type,
          requestId,
          payload
        },
        transfer
      );
    } catch (error) {
      handle.pending.delete(requestId);
      reject(createPdfMathError("worker_error", error?.message || "Failed to post worker message.", true));
    }
  });
}

function acceptsResponse(type, message) {
  if (type === "INIT") {
    return message?.type === "READY" && message?.payload?.stage === "init";
  }

  if (type === "LOAD_MODELS") {
    return message?.type === "READY" && message?.payload?.stage === "models";
  }

  if (type === "RUN_BENCHMARK") {
    return message?.type === "BENCHMARK_RESULT";
  }

  if (type === "DETECT_AND_RECOGNIZE") {
    return message?.type === "RESULT";
  }

  return false;
}

function handleWorkerFailure(error, options = {}) {
  const reason = normalizeWorkerFailureReason(error);
  const benchmarkMs = options.preserveBenchmarkMs ? currentStatus.benchmarkMs : null;

  if (workerHandle) {
    for (const pendingRequest of workerHandle.pending.values()) {
      pendingRequest.reject(createPdfMathError(reason, error?.message || reason, Boolean(error?.fatal)));
    }
    workerHandle.pending.clear();
  }

  terminateWorker();

  const phase =
    reason === "benchmark_too_slow" || reason === "insecure_context" || reason === "worker_unsupported"
      ? "disabled"
      : "error";

  updatePhase({
    phase,
    enabled: false,
    reason,
    benchmarkMs
  });
}

function normalizeWorkerFailureReason(error) {
  const code = normalizeErrorCode(error?.code);
  if (code === "models_load_failed" || code === "worker_error" || code === "benchmark_failed") {
    return code;
  }
  return "worker_error";
}

async function disposeWorkerIfIdle() {
  if (!workerHandle?.worker || currentStatus.refCount > 0 || recognitionCount > 0) {
    return;
  }

  try {
    workerHandle.worker.postMessage({
      type: "DISPOSE",
      requestId: buildPdfMathRequestId(),
      payload: {}
    });
  } catch {
    // Ignore termination-time worker failures.
  }

  terminateWorker();
}

function terminateWorker() {
  if (!workerHandle) {
    return;
  }

  try {
    workerHandle.worker.terminate();
  } catch {
    // Ignore best-effort worker cleanup failures.
  }

  workerHandle = null;
  workerModelsReady = false;
}

function setRefCount(refCount) {
  currentStatus = createPdfMathStatusSnapshot({
    phase: currentStatus.phase,
    enabled: currentStatus.enabled,
    reason: currentStatus.reason,
    benchmarkMs: currentStatus.benchmarkMs,
    refCount: Math.max(0, Number(refCount || 0))
  });
}

function updatePhase({ phase, enabled, reason, benchmarkMs }) {
  currentStatus = createPdfMathStatusSnapshot({
    phase,
    enabled,
    reason,
    benchmarkMs,
    refCount: currentStatus.refCount
  });
}

function normalizePoint(point) {
  return {
    x: Number(point?.x || 0),
    y: Number(point?.y || 0)
  };
}

function normalizeRect(rect) {
  return {
    x: Number(rect?.x || 0),
    y: Number(rect?.y || 0),
    width: Number(rect?.width || 0),
    height: Number(rect?.height || 0)
  };
}

async function persistSettingSafely(key, value) {
  try {
    await setSetting(key, value);
  } catch (error) {
    console.warn("Failed to persist PDF math diagnostic", key, error);
  }
}
