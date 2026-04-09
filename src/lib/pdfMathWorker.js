import {
  createPdfMathError,
  createPdfMathLayoutResult,
  createPdfMathResult,
  PDF_MATH_BENCHMARK_THRESHOLD_MS,
  PDF_MATH_MODEL_REVISION
} from "./pdfMathCommon";
import { createPdfMathRuntime } from "./pdfMathRuntime";

const workerState = {
  initialized: false,
  modelRevision: "",
  modelsLoaded: false,
  runtime: null
};

self.onmessage = (event) => {
  void handleWorkerMessage(event?.data);
};

async function handleWorkerMessage(message) {
  const type = String(message?.type || "");
  const requestId = String(message?.requestId || "");
  const payload = message?.payload || {};

  try {
    if (type === "INIT") {
      await handleInit(requestId, payload);
      return;
    }

    if (type === "LOAD_MODELS") {
      await handleLoadModels(requestId, payload);
      return;
    }

    if (type === "RUN_BENCHMARK") {
      await handleBenchmark(requestId, payload);
      return;
    }

    if (type === "DETECT_LAYOUT") {
      await handleDetectLayout(requestId, payload);
      return;
    }

    if (type === "DETECT_AND_RECOGNIZE") {
      await handleDetectAndRecognize(requestId, payload);
      return;
    }

    if (type === "DISPOSE") {
      await disposeRuntime();
      return;
    }

    throw createPdfMathError("worker_error", `Unsupported PDF math request: ${type}`, false);
  } catch (error) {
    postError(requestId, error);
  }
}

async function handleInit(requestId, payload) {
  if (payload?.modelRevision !== PDF_MATH_MODEL_REVISION) {
    throw createPdfMathError("worker_error", "Unsupported PDF math model revision.", false);
  }

  workerState.initialized = true;
  workerState.modelRevision = payload.modelRevision;
  postMessage({
    type: "READY",
    requestId,
    payload: {
      stage: "init"
    }
  });
}

async function handleLoadModels(requestId, payload) {
  if (!workerState.initialized || workerState.modelRevision !== payload?.modelRevision) {
    throw createPdfMathError("models_load_failed", "PDF math worker is not initialized.", false);
  }

  workerState.runtime = await createRuntime(payload);
  await workerState.runtime.loadModels(payload.models, {
    onProgress(progress) {
      postMessage({
        type: "PROGRESS",
        requestId,
        payload: {
          stage: progress.stage,
          modelId: progress.modelId,
          filename: progress.filename,
          loadedBytes: Number(progress.loadedBytes || 0),
          totalBytes:
            progress.totalBytes == null || Number.isNaN(Number(progress.totalBytes))
              ? null
              : Number(progress.totalBytes)
        }
      });
    }
  });
  workerState.modelsLoaded = true;
  postMessage({
    type: "READY",
    requestId,
    payload: {
      stage: "models"
    }
  });
}

async function handleDetectLayout(requestId, payload) {
  if (!workerState.modelsLoaded || !workerState.runtime) {
    throw createPdfMathError("pdf_not_ready", "PDF math models are not ready.", false);
  }

  const result = await workerState.runtime.detectFormulaRegions({
    imageBitmap: payload.imageBitmap,
    cropRect: payload.cropRect
  });

  postMessage({
    type: "LAYOUT_RESULT",
    requestId,
    payload: createPdfMathLayoutResult(result)
  });
}

async function handleBenchmark(requestId, payload) {
  if (!workerState.modelsLoaded || !workerState.runtime) {
    throw createPdfMathError("benchmark_failed", "PDF math models are not ready.", false);
  }

  const thresholdMs = Number(payload?.thresholdMs || PDF_MATH_BENCHMARK_THRESHOLD_MS);
  const startedAt = performance.now();
  const runtimeResult = await workerState.runtime.runBenchmark({
    thresholdMs
  });
  const durationMs = Number(runtimeResult?.durationMs || performance.now() - startedAt);
  postMessage({
    type: "BENCHMARK_RESULT",
    requestId,
    payload: {
      durationMs,
      passed: Boolean(runtimeResult?.passed) && durationMs <= thresholdMs,
      thresholdMs
    }
  });
}

async function handleDetectAndRecognize(requestId, payload) {
  if (!workerState.modelsLoaded || !workerState.runtime) {
    throw createPdfMathError("pdf_not_ready", "PDF math models are not ready.", false);
  }

  const result = await workerState.runtime.detectAndRecognize({
    imageBitmap: payload.imageBitmap,
    clickPoint: payload.clickPoint,
    cropRect: payload.cropRect
  });

  postMessage({
    type: "RESULT",
    requestId,
    payload: createPdfMathResult(result)
  });
}

async function disposeRuntime() {
  if (workerState.runtime && typeof workerState.runtime.dispose === "function") {
    await workerState.runtime.dispose();
  }

  workerState.runtime = null;
  workerState.modelsLoaded = false;
  workerState.initialized = false;
  workerState.modelRevision = "";
}

async function createRuntime() {
  return createPdfMathRuntime({
    modelRevision: PDF_MATH_MODEL_REVISION
  });
}

function postError(requestId, error) {
  const normalized = createPdfMathError(error?.code, error?.message, Boolean(error?.fatal));
  postMessage({
    type: "ERROR",
    requestId,
    payload: {
      code: normalized.code,
      message: normalized.message,
      fatal: Boolean(normalized.fatal)
    }
  });
}
