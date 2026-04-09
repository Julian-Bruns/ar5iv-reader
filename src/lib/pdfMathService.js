import { setSetting, SETTING_KEYS } from "./db";
import { getPdfMathModelEntry } from "./pdfMathManifest";
import { getMlModelMetaRecord } from "./pdfMathModelStore";
import { probePdfMathWebGpu } from "./pdfMathOrt";
import {
  buildPdfMathRequestId,
  createPdfMathError,
  createPdfMathLayoutResult,
  createPdfMathResult,
  createPdfMathStatusSnapshot,
  normalizeErrorCode,
  PDF_MATH_BENCHMARK_THRESHOLD_MS,
  PDF_MATH_MODELS,
  PDF_MATH_MODEL_REVISION
} from "./pdfMathCommon";

const MODEL_TOTAL_BYTES = PDF_MATH_MODELS.reduce((total, model) => {
  const entry = getPdfMathModelEntry(model.modelId, PDF_MATH_MODEL_REVISION);
  return total + (entry?.files || []).reduce((sum, file) => sum + Number(file.size || 0), 0);
}, 0);

let currentStatus = createPdfMathStatusSnapshot();
let capabilityPromise = null;
let installDetectionPromise = null;
let installPromise = null;
let loadPromise = null;
let benchmarkPromise = null;
let workerHandle = null;
let workerModelsReady = false;
let recognitionCount = 0;
let installProgressState = createInstallProgressState(false);

const listeners = new Set();

export function status() {
  return {
    ...currentStatus,
    progress: currentStatus.progress ? { ...currentStatus.progress } : null
  };
}

export function subscribe(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  listeners.add(listener);
  listener(status());
  return () => {
    listeners.delete(listener);
  };
}

export function unsubscribe(listener) {
  listeners.delete(listener);
}

export async function prefetch() {
  try {
    return await ensureReady({
      installIfNeeded: true,
      oneTime: true
    });
  } catch {
    return status();
  }
}

export async function acquire() {
  setRefCount(currentStatus.refCount + 1);

  const capability = await ensureCapability();
  if (!capability.enabled) {
    return status();
  }

  const installed = currentStatus.installed ? true : await detectInstalledState();
  if (!installed) {
    updateStatus({
      phase: "idle",
      installed: false,
      enabled: false,
      reason: "",
      progress: null
    });
    return status();
  }

  if (!workerModelsReady) {
    await loadInstalledModelsIntoWorker({
      oneTime: false
    });
  }

  if (currentStatus.reason === "benchmark_too_slow") {
    return status();
  }

  if (currentStatus.benchmarkMs == null) {
    await ensureBenchmark();
  } else if (workerModelsReady && currentStatus.enabled) {
    updateStatus({
      phase: "ready",
      installed: true,
      enabled: true,
      reason: ""
    });
  }

  return status();
}

export async function ensureReady({ installIfNeeded = true, oneTime = false } = {}) {
  const capability = await ensureCapability();
  if (!capability.enabled) {
    return status();
  }

  const installed = currentStatus.installed ? true : await detectInstalledState();
  if (!installed && !installIfNeeded) {
    return status();
  }

  if (!installed) {
    if (!installPromise) {
      installPromise = installAndWarm({ oneTime }).finally(() => {
        installPromise = null;
      });
    }
    return installPromise;
  }

  if (!workerModelsReady) {
    await loadInstalledModelsIntoWorker({
      oneTime: false
    });
  }

  if (currentStatus.reason === "benchmark_too_slow") {
    return status();
  }

  if (currentStatus.benchmarkMs == null || !currentStatus.enabled) {
    await ensureBenchmark();
  } else {
    updateStatus({
      phase: "ready",
      installed: true,
      enabled: true,
      reason: "",
      progress: null
    });
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

export async function detectFormulaRegions({ imageBitmap, cropRect }) {
  assertRuntimeReady();

  recognitionCount += 1;
  try {
    const result = await sendWorkerRequest(
      "DETECT_LAYOUT",
      {
        imageBitmap,
        cropRect: normalizeRect(cropRect)
      },
      imageBitmap ? [imageBitmap] : []
    );
    return createPdfMathLayoutResult(result);
  } catch (error) {
    throw createPdfMathError(
      error?.code,
      error?.message || "PDF math layout detection failed.",
      Boolean(error?.fatal)
    );
  } finally {
    recognitionCount = Math.max(0, recognitionCount - 1);
    void disposeWorkerIfIdle();
  }
}

export async function detectAndRecognize({ imageBitmap, clickPoint, cropRect }) {
  assertRuntimeReady();

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

async function installAndWarm({ oneTime }) {
  await persistSettingSafely(SETTING_KEYS.pdfMathCopyModelRevision, PDF_MATH_MODEL_REVISION);
  resetInstallProgress(oneTime);
  updateStatus({
    phase: "installing",
    installed: false,
    enabled: false,
    reason: "",
    progress: buildProgressSnapshot("installing")
  });

  await loadInstalledModelsIntoWorker({
    oneTime,
    forceInstall: true
  });
  await detectInstalledState(true);
  await ensureBenchmark();
  return status();
}

async function ensureCapability() {
  if (!capabilityPromise) {
    capabilityPromise = runCapabilityChecks();
  }

  const capability = await capabilityPromise;
  await persistSettingSafely(SETTING_KEYS.pdfMathCopyCapability, capability);

  if (!capability.enabled) {
    updateStatus({
      phase: "disabled",
      installed: false,
      enabled: false,
      reason: capability.reason,
      benchmarkMs: null,
      progress: null
    });
  }

  return capability;
}

async function detectInstalledState(force = false) {
  if (!force && installDetectionPromise) {
    return installDetectionPromise;
  }

  installDetectionPromise = (async () => {
    let installedChecks;
    try {
      installedChecks = await Promise.all(
        PDF_MATH_MODELS.map(async (model) => {
          const entry = getPdfMathModelEntry(model.modelId, PDF_MATH_MODEL_REVISION);
          const meta = await getMlModelMetaRecord(model.modelId);
          const expectedFiles = (entry?.files || []).map((file) => file.filename);
          return (
            meta?.revision === PDF_MATH_MODEL_REVISION &&
            Array.isArray(meta?.files) &&
            meta.files.length === expectedFiles.length &&
            expectedFiles.every((file) => meta.files.includes(file))
          );
        })
      );
    } catch {
      installedChecks = [false];
    }

    const installed = installedChecks.every(Boolean);
    updateStatus({
      installed
    });
    return installed;
  })().finally(() => {
    installDetectionPromise = null;
  });

  return installDetectionPromise;
}

async function loadInstalledModelsIntoWorker({ oneTime, forceInstall = false }) {
  if (workerModelsReady && workerHandle?.worker) {
    if (currentStatus.enabled && currentStatus.benchmarkMs != null) {
      updateStatus({
        phase: "ready",
        installed: true,
        enabled: true,
        reason: "",
        progress: null
      });
    }
    return workerHandle;
  }

  if (!loadPromise) {
    loadPromise = (async () => {
      const handle = ensureWorkerHandle();
      resetInstallProgress(oneTime);
      updateStatus({
        phase: forceInstall ? "installing" : "loading",
        installed: currentStatus.installed || forceInstall,
        enabled: false,
        reason: "",
        progress: forceInstall ? buildProgressSnapshot("installing") : null
      });

      await sendWorkerRequest("INIT", {
        modelRevision: PDF_MATH_MODEL_REVISION
      });
      await sendWorkerRequest(
        "LOAD_MODELS",
        {
          modelRevision: PDF_MATH_MODEL_REVISION,
          models: PDF_MATH_MODELS.map((model) => ({
            role: model.role,
            modelId: model.modelId
          }))
        },
        [],
        (progress) => {
          recordInstallProgress(progress, {
            stage: forceInstall ? "installing" : "loading"
          });
        }
      );
      workerModelsReady = true;
      updateStatus({
        phase: "loading",
        installed: true,
        enabled: false,
        reason: "",
        progress: forceInstall
          ? {
              loadedBytes: MODEL_TOTAL_BYTES,
              totalBytes: MODEL_TOTAL_BYTES,
              etaMs: 0,
              stage: "loading",
              oneTime: Boolean(oneTime)
            }
          : null
      });
      return handle;
    })().catch((error) => {
      handleWorkerFailure(error, {
        preserveBenchmarkMs: false
      });
      throw error;
    }).finally(() => {
      loadPromise = null;
    });
  }

  return loadPromise;
}

async function ensureBenchmark() {
  if (currentStatus.reason === "benchmark_too_slow") {
    updateStatus({
      phase: "disabled",
      installed: true,
      enabled: false
    });
    return status();
  }

  if (!benchmarkPromise) {
    benchmarkPromise = (async () => {
      updateStatus({
        phase: "loading",
        installed: true,
        enabled: false,
        reason: "",
        progress: null
      });

      let benchmark;
      try {
        benchmark = await sendWorkerRequest("RUN_BENCHMARK", {
          thresholdMs: PDF_MATH_BENCHMARK_THRESHOLD_MS
        });
      } catch (error) {
        await persistSettingSafely(SETTING_KEYS.pdfMathCopyBenchmark, {
          durationMs: null,
          thresholdMs: PDF_MATH_BENCHMARK_THRESHOLD_MS,
          passed: false,
          checkedAt: new Date().toISOString()
        });
        updateStatus({
          phase: "error",
          installed: true,
          enabled: false,
          reason: "benchmark_failed",
          benchmarkMs: null,
          progress: null
        });
        throw error;
      }

      const benchmarkMs = Number(benchmark?.durationMs);
      const passed =
        Boolean(benchmark?.passed) &&
        Number.isFinite(benchmarkMs) &&
        benchmarkMs <= PDF_MATH_BENCHMARK_THRESHOLD_MS;

      await persistSettingSafely(SETTING_KEYS.pdfMathCopyBenchmark, {
        durationMs: Number.isFinite(benchmarkMs) ? benchmarkMs : null,
        thresholdMs: PDF_MATH_BENCHMARK_THRESHOLD_MS,
        passed,
        checkedAt: new Date().toISOString()
      });

      if (!passed) {
        updateStatus({
          phase: "disabled",
          installed: true,
          enabled: false,
          reason: "benchmark_too_slow",
          benchmarkMs: Number.isFinite(benchmarkMs) ? benchmarkMs : null,
          progress: null
        });
        return status();
      }

      updateStatus({
        phase: "ready",
        installed: true,
        enabled: true,
        reason: "",
        benchmarkMs,
        progress: null
      });
      return status();
    })().finally(() => {
      benchmarkPromise = null;
    });
  }

  return benchmarkPromise;
}

async function runCapabilityChecks() {
  const secureContext = typeof window !== "undefined" && window.isSecureContext === true;
  if (!secureContext) {
    return createCapabilityResult(false, "insecure_context");
  }

  if (typeof Worker !== "function") {
    return createCapabilityResult(false, "worker_unsupported");
  }

  const webgpuProbe = await probePdfMathWebGpu({
    requireDevice: false
  });
  if (!webgpuProbe.enabled) {
    return createCapabilityResult(false, "gpu_unavailable");
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
      pendingRequest.onProgress?.(message?.payload || {});
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

function sendWorkerRequest(type, payload, transfer = [], onProgress = null) {
  const handle = ensureWorkerHandle();
  const requestId = buildPdfMathRequestId();

  return new Promise((resolve, reject) => {
    handle.pending.set(requestId, {
      accepts: (message) => acceptsResponse(type, message),
      resolve,
      reject,
      onProgress
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

  if (type === "DETECT_LAYOUT") {
    return message?.type === "LAYOUT_RESULT";
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
  updateStatus({
    phase: reason === "benchmark_too_slow" ? "disabled" : "error",
    installed: currentStatus.installed,
    enabled: false,
    reason,
    benchmarkMs,
    progress: null
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
  updateStatus({
    phase: currentStatus.installed ? "idle" : currentStatus.phase,
    enabled: false,
    progress: null
  });
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
  setStatus(
    createPdfMathStatusSnapshot({
      ...currentStatus,
      refCount: Math.max(0, Number(refCount || 0))
    })
  );
}

function updateStatus(nextFields) {
  setStatus(
    createPdfMathStatusSnapshot({
      ...currentStatus,
      ...nextFields,
      refCount:
        nextFields?.refCount == null ? currentStatus.refCount : Math.max(0, Number(nextFields.refCount || 0))
    })
  );
}

function setStatus(nextStatus) {
  currentStatus = nextStatus;
  for (const listener of listeners) {
    try {
      listener(status());
    } catch (error) {
      console.warn("PDF math status listener failed", error);
    }
  }
}

function resetInstallProgress(oneTime) {
  installProgressState = createInstallProgressState(oneTime);
}

function recordInstallProgress(progress, { stage }) {
  const key = `${String(progress?.modelId || "")}:${String(progress?.filename || "")}`;
  const currentFile = installProgressState.files.get(key) || {
    loadedBytes: 0,
    totalBytes: 0
  };
  const loadedBytes = Math.max(currentFile.loadedBytes, Number(progress?.loadedBytes || 0));
  const totalBytes = Math.max(currentFile.totalBytes, Number(progress?.totalBytes || 0));
  installProgressState.files.set(key, {
    loadedBytes,
    totalBytes
  });

  const totalLoaded = [...installProgressState.files.values()].reduce(
    (sum, entry) => sum + Number(entry.loadedBytes || 0),
    0
  );
  if (
    !installProgressState.samples.length ||
    totalLoaded > installProgressState.samples[installProgressState.samples.length - 1].loadedBytes
  ) {
    installProgressState.samples.push({
      at: Date.now(),
      loadedBytes: totalLoaded
    });
    installProgressState.samples = installProgressState.samples.slice(-6);
  }

  updateStatus({
    phase: stage,
    installed: false,
    enabled: false,
    reason: "",
    progress: buildProgressSnapshot(stage)
  });
}

function buildProgressSnapshot(stage) {
  const loadedBytes = [...installProgressState.files.values()].reduce(
    (sum, entry) => sum + Number(entry.loadedBytes || 0),
    0
  );
  const etaMs = estimateEtaMs(installProgressState.samples, loadedBytes);
  return {
    loadedBytes,
    totalBytes: MODEL_TOTAL_BYTES || null,
    etaMs,
    stage,
    oneTime: installProgressState.oneTime
  };
}

function estimateEtaMs(samples, loadedBytes) {
  if (!Array.isArray(samples) || samples.length < 2 || MODEL_TOTAL_BYTES <= 0 || loadedBytes >= MODEL_TOTAL_BYTES) {
    return loadedBytes >= MODEL_TOTAL_BYTES ? 0 : null;
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedMs = last.at - first.at;
  const loadedDelta = last.loadedBytes - first.loadedBytes;
  if (elapsedMs <= 0 || loadedDelta <= 0) {
    return null;
  }

  const bytesPerMs = loadedDelta / elapsedMs;
  const remainingBytes = Math.max(0, MODEL_TOTAL_BYTES - loadedBytes);
  return bytesPerMs > 0 ? Math.round(remainingBytes / bytesPerMs) : null;
}

function createInstallProgressState(oneTime) {
  return {
    oneTime: Boolean(oneTime),
    files: new Map(),
    samples: []
  };
}

function assertRuntimeReady() {
  if (!workerHandle?.worker || !workerModelsReady || currentStatus.phase !== "ready") {
    throw createPdfMathError("pdf_not_ready", "PDF math worker is not ready.", false);
  }
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
