import * as ort from "onnxruntime-web/webgpu";
import {
  createPdfMathError,
  PDF_MATH_BENCHMARK_THRESHOLD_MS,
  PDF_MATH_MODEL_REVISION
} from "./pdfMathCommon";
import { getPdfMathModelEntry, getPdfMathModelManifest } from "./pdfMathManifest";
import {
  buildMlModelRecordKey,
  deleteMlModelRecord,
  getMlModelMetaRecord,
  listMlModelRecords,
  putMlModelMetaRecord,
  putMlModelRecord
} from "./pdfMathModelStore";
import {
  applyPdfMathOrtWebGpuSelection,
  configurePdfMathOrtRuntime,
  probePdfMathWebGpu
} from "./pdfMathOrt";
import { createPdfMathTokenizer } from "./pdfMathTokenizer";

const DETECTION_INPUT_SIZE = 640;
const DETECTION_SCORE_THRESHOLD = 0.25;
const DETECTION_NMS_THRESHOLD = 0.45;
const DETECTION_CLICK_TOLERANCE = 24;
const MAX_RECOGNIZER_TOKENS = 512;
const DEFAULT_BOUNDS_PADDING = 6;

export async function createPdfMathRuntime({ modelRevision = PDF_MATH_MODEL_REVISION } = {}) {
  configurePdfMathOrtRuntime(ort);
  const webgpuSelection = await probePdfMathWebGpu();
  if (!webgpuSelection.enabled || !webgpuSelection.device) {
    throw createPdfMathError("gpu_unavailable", "WebGPU is unavailable for PDF math.", false);
  }
  applyPdfMathOrtWebGpuSelection(ort, webgpuSelection);

  const manifest = getPdfMathModelManifest(modelRevision);
  if (!manifest) {
    throw createPdfMathError("models_load_failed", "Unsupported PDF math model revision.", false);
  }

  const state = {
    detector: null,
    recognizer: null,
    tokenizer: null,
    recognizerConfig: null,
    generationConfig: null,
    disposed: false
  };

  return {
    async loadModels(models, { onProgress } = {}) {
      assertActive(state);

      const modelEntries = models.map((model) => {
        const entry = getPdfMathModelEntry(model?.modelId, modelRevision);
        if (!entry) {
          throw createPdfMathError("models_load_failed", `Unsupported PDF math model: ${model?.modelId || ""}`, false);
        }
        return entry;
      });

      try {
        for (const entry of modelEntries) {
          const files = await ensureModelAssets(entry, onProgress);
          if (entry.role === "detector") {
            state.detector = await createDetectorRuntime(files);
          } else if (entry.role === "recognizer") {
            const recognizer = await createRecognizerRuntime(files);
            state.recognizer = recognizer;
            state.tokenizer = recognizer.tokenizer;
            state.recognizerConfig = recognizer.config;
            state.generationConfig = recognizer.generationConfig;
          }
        }
      } catch (error) {
        throw createPdfMathError(
          error?.code === "worker_error" ? "worker_error" : "models_load_failed",
          error?.message || "Failed to prepare PDF math models.",
          Boolean(error?.fatal)
        );
      }
    },

    async runBenchmark({ thresholdMs = PDF_MATH_BENCHMARK_THRESHOLD_MS } = {}) {
      assertModelsReady(state);
      const startedAt = performance.now();

      await state.detector.session.run({
        images: createZeroTensor([1, 3, DETECTION_INPUT_SIZE, DETECTION_INPUT_SIZE])
      });

      const encoderResult = await state.recognizer.encoderSession.run({
        pixel_values: createZeroTensor([1, 3, state.recognizer.config.imageHeight, state.recognizer.config.imageWidth])
      });
      const encoderHiddenStates = encoderResult.last_hidden_state;
      await runDecoderStep(state.recognizer.decoderSession, encoderHiddenStates, [
        state.generationConfig.decoderStartTokenId
      ]);

      const durationMs = performance.now() - startedAt;
      return {
        durationMs,
        passed: durationMs <= Number(thresholdMs || PDF_MATH_BENCHMARK_THRESHOLD_MS)
      };
    },

    async detectFormulaRegions({ imageBitmap, cropRect }) {
      assertModelsReady(state);
      assertActive(state);

      const sourceCanvas = imageBitmapToCanvas(imageBitmap);

      try {
        const detections = await detectFormulaBoxes(state.detector.session, sourceCanvas);
        return {
          bounds: detections.map((detection) => translateBounds(detection.bounds, cropRect))
        };
      } catch (error) {
        throw createPdfMathError(
          error?.code,
          error?.message || "PDF math layout detection failed.",
          Boolean(error?.fatal)
        );
      } finally {
        imageBitmap?.close?.();
      }
    },

    async detectAndRecognize({ imageBitmap, clickPoint, cropRect }) {
      assertModelsReady(state);
      assertActive(state);

      const sourceCanvas = imageBitmapToCanvas(imageBitmap);
      const click = normalizeClickPoint(clickPoint, sourceCanvas);

      try {
        const detections = await detectFormulaBoxes(state.detector.session, sourceCanvas);
        const selected = selectDetection(detections, click);
        if (!selected) {
          return {
            status: "no-match",
            latex: "",
            confidence: null,
            bounds: null,
            reason: "no_formula_detected"
          };
        }

        const formulaCanvas = cropFormulaCanvas(sourceCanvas, selected.bounds);
        const recognition = await recognizeFormula(state, formulaCanvas);
        if (!recognition.latex) {
          return {
            status: "no-match",
            latex: "",
            confidence: null,
            bounds: null,
            reason: "ocr_empty"
          };
        }

        return {
          status: "ok",
          latex: recognition.latex,
          confidence: recognition.confidence,
          bounds: translateBounds(selected.bounds, cropRect),
          reason: ""
        };
      } catch (error) {
        throw createPdfMathError(
          error?.code,
          error?.message || "PDF math recognition failed.",
          Boolean(error?.fatal)
        );
      } finally {
        imageBitmap?.close?.();
      }
    },

    async dispose() {
      if (state.disposed) {
        return;
      }

      state.disposed = true;
      try {
        state.detector?.session?.release?.();
      } catch {
        // Best-effort session cleanup.
      }
      try {
        state.recognizer?.encoderSession?.release?.();
      } catch {
        // Best-effort session cleanup.
      }
      try {
        state.recognizer?.decoderSession?.release?.();
      } catch {
        // Best-effort session cleanup.
      }
    }
  };
}

async function ensureModelAssets(entry, onProgress) {
  const cachedRecords = await listMlModelRecords({
    revision: PDF_MATH_MODEL_REVISION,
    modelId: entry.modelId
  });
  const cachedByFilename = new Map(cachedRecords.map((record) => [record.filename, record]));
  const verifiedFiles = new Map();
  const expectedFiles = new Set(entry.files.map((file) => file.filename));

  for (const descriptor of entry.files) {
    const cached = cachedByFilename.get(descriptor.filename);
    if (cached && await isValidCachedModelRecord(cached, descriptor)) {
      verifiedFiles.set(descriptor.filename, cached.blob);
      onProgress?.({
        stage: "cache",
        modelId: entry.modelId,
        filename: descriptor.filename,
        loadedBytes: descriptor.size,
        totalBytes: descriptor.size
      });
      continue;
    }

    if (cached) {
      await deleteMlModelRecord(cached.key);
    }

    const blob = await fetchModelFile(descriptor, entry.modelId, onProgress);
    await putMlModelRecord({
      key: buildMlModelRecordKey(PDF_MATH_MODEL_REVISION, entry.modelId, descriptor.filename),
      revision: PDF_MATH_MODEL_REVISION,
      modelId: entry.modelId,
      filename: descriptor.filename,
      blob,
      size: descriptor.size,
      updatedAt: new Date().toISOString()
    });
    verifiedFiles.set(descriptor.filename, blob);
  }

  for (const cached of cachedRecords) {
    if (!expectedFiles.has(cached.filename)) {
      await deleteMlModelRecord(cached.key);
    }
  }

  const currentMeta = await getMlModelMetaRecord(entry.modelId);
  const expectedMetaFiles = entry.files.map((file) => file.filename);
  if (
    currentMeta?.revision !== PDF_MATH_MODEL_REVISION ||
    !arraysEqual(currentMeta?.files || [], expectedMetaFiles)
  ) {
    await putMlModelMetaRecord({
      key: entry.modelId,
      revision: PDF_MATH_MODEL_REVISION,
      modelId: entry.modelId,
      files: expectedMetaFiles,
      updatedAt: new Date().toISOString()
    });
  }

  return verifiedFiles;
}

async function isValidCachedModelRecord(record, descriptor) {
  if (!(record?.blob instanceof Blob)) {
    return false;
  }

  if (Number(record.size) !== descriptor.size || Number(record.blob.size) !== descriptor.size) {
    return false;
  }

  const digest = await hashBlob(record.blob);
  return digest === descriptor.sha256;
}

async function fetchModelFile(descriptor, modelId, onProgress) {
  const sources = [descriptor.sameOriginUrl, descriptor.remoteUrl];
  let lastError = null;

  for (const url of sources) {
    try {
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await readBlobWithProgress(response, (loadedBytes, totalBytes) => {
        onProgress?.({
          stage: "download",
          modelId,
          filename: descriptor.filename,
          loadedBytes,
          totalBytes
        });
      }, descriptor.size);
      if (Number(blob.size) !== descriptor.size) {
        throw new Error(`Unexpected file size for ${descriptor.filename}.`);
      }

      const digest = await hashBlob(blob);
      if (digest !== descriptor.sha256) {
        throw new Error(`Checksum mismatch for ${descriptor.filename}.`);
      }
      return blob;
    } catch (error) {
      lastError = error;
    }
  }

  throw createPdfMathError(
    "models_load_failed",
    `Failed to fetch ${descriptor.filename}: ${lastError?.message || "unknown error"}.`,
    false
  );
}

async function readBlobWithProgress(response, onProgress, fallbackTotalBytes) {
  const totalBytes =
    Number(response.headers?.get?.("content-length") || fallbackTotalBytes || 0) || fallbackTotalBytes;
  if (!response.body?.getReader) {
    const blob = await response.blob();
    onProgress?.(blob.size, totalBytes || blob.size);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loadedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
      loadedBytes += value.byteLength;
      onProgress?.(loadedBytes, totalBytes || fallbackTotalBytes || loadedBytes);
    }
  }

  return new Blob(chunks);
}

async function createDetectorRuntime(files) {
  const buffer = await blobToArrayBuffer(files.get("mfd-v20240618.onnx"));
  const session = await ort.InferenceSession.create(buffer, {
    executionProviders: [
      {
        name: "webgpu",
        device: await ort.env.webgpu.device,
        validationMode: "basic"
      }
    ]
  });
  return {
    session
  };
}

async function createRecognizerRuntime(files) {
  const [config, generationConfig, tokenizerJson] = await Promise.all([
    readJsonBlob(files.get("config.json")),
    readJsonBlob(files.get("generation_config.json")),
    readJsonBlob(files.get("tokenizer.json"))
  ]);

  const tokenizer = createPdfMathTokenizer(tokenizerJson);
  const encoderSession = await ort.InferenceSession.create(
    await blobToArrayBuffer(files.get("encoder_model.onnx")),
    {
      executionProviders: [
        {
          name: "webgpu",
          device: await ort.env.webgpu.device,
          validationMode: "basic"
        }
      ]
    }
  );
  const decoderSession = await ort.InferenceSession.create(
    await blobToArrayBuffer(files.get("decoder_model.onnx")),
    {
      executionProviders: [
        {
          name: "webgpu",
          device: await ort.env.webgpu.device,
          validationMode: "basic"
        }
      ]
    }
  );

  return {
    tokenizer,
    encoderSession,
    decoderSession,
    generationConfig: {
      decoderStartTokenId: Number(generationConfig?.decoder_start_token_id ?? config?.decoder_start_token_id ?? 2),
      eosTokenId: Number(generationConfig?.eos_token_id ?? config?.eos_token_id ?? 2),
      maxNewTokens: Number(generationConfig?.max_new_tokens || MAX_RECOGNIZER_TOKENS)
    },
    config: {
      imageHeight: Number(config?.encoder?.image_size || 384),
      imageWidth: Number(config?.encoder?.image_size || 384),
      vocabSize: Number(config?.decoder?.vocab_size || 1200)
    }
  };
}

async function detectFormulaBoxes(session, sourceCanvas) {
  const prepared = prepareDetectionInput(sourceCanvas);
  const output = await session.run({
    images: prepared.tensor
  });
  const detections = decodeDetections(output.output0?.data || output.output0, prepared);
  return nonMaximumSuppress(detections, DETECTION_NMS_THRESHOLD);
}

async function recognizeFormula(state, formulaCanvas) {
  const { tensor } = prepareRecognizerInput(
    formulaCanvas,
    state.recognizer.config.imageWidth,
    state.recognizer.config.imageHeight
  );
  const encoderOutputs = await state.recognizer.encoderSession.run({
    pixel_values: tensor
  });
  const encoderHiddenStates = encoderOutputs.last_hidden_state;

  const generatedIds = [state.recognizer.generationConfig.decoderStartTokenId];
  const probabilities = [];
  for (let step = 0; step < state.recognizer.generationConfig.maxNewTokens; step += 1) {
    const decoderStep = await runDecoderStep(
      state.recognizer.decoderSession,
      encoderHiddenStates,
      generatedIds
    );
    generatedIds.push(decoderStep.tokenId);
    probabilities.push(decoderStep.probability);
    if (decoderStep.tokenId === state.recognizer.generationConfig.eosTokenId) {
      break;
    }
  }

  const decoded = state.tokenizer.decode(generatedIds, {
    skipSpecialTokens: true
  });
  const latex = postProcessLatex(decoded);
  return {
    latex,
    confidence: probabilities.length ? geometricMean(probabilities) : null
  };
}

async function runDecoderStep(decoderSession, encoderHiddenStates, tokenIds) {
  const inputTensor = new ort.Tensor(
    "int64",
    BigInt64Array.from(tokenIds, (tokenId) => BigInt(tokenId)),
    [1, tokenIds.length]
  );
  const outputs = await decoderSession.run({
    input_ids: inputTensor,
    encoder_hidden_states: encoderHiddenStates
  });
  const logits = outputs.logits.data;
  const vocabSize = outputs.logits.dims[2];
  const start = (tokenIds.length - 1) * vocabSize;
  const nextLogits = logits.subarray(start, start + vocabSize);
  const { tokenId, probability } = argmaxSoftmax(nextLogits);
  return {
    tokenId,
    probability
  };
}

function imageBitmapToCanvas(imageBitmap) {
  const width = Math.max(1, Number(imageBitmap?.width || 0));
  const height = Math.max(1, Number(imageBitmap?.height || 0));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });
  if (!context) {
    throw createPdfMathError("worker_error", "Canvas rendering context unavailable.", false);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(imageBitmap, 0, 0, width, height);
  return canvas;
}

function cropFormulaCanvas(sourceCanvas, bounds) {
  const paddingX = Math.max(DEFAULT_BOUNDS_PADDING, Math.round(bounds.width * 0.04));
  const paddingY = Math.max(DEFAULT_BOUNDS_PADDING, Math.round(bounds.height * 0.08));
  const left = clamp(Math.floor(bounds.x - paddingX), 0, sourceCanvas.width);
  const top = clamp(Math.floor(bounds.y - paddingY), 0, sourceCanvas.height);
  const right = clamp(Math.ceil(bounds.x + bounds.width + paddingX), 0, sourceCanvas.width);
  const bottom = clamp(Math.ceil(bounds.y + bounds.height + paddingY), 0, sourceCanvas.height);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });
  if (!context) {
    throw createPdfMathError("worker_error", "Canvas rendering context unavailable.", false);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(sourceCanvas, left, top, width, height, 0, 0, width, height);
  return canvas;
}

function prepareDetectionInput(sourceCanvas) {
  const scale = Math.min(DETECTION_INPUT_SIZE / sourceCanvas.width, DETECTION_INPUT_SIZE / sourceCanvas.height);
  const resizedWidth = Math.max(1, Math.round(sourceCanvas.width * scale));
  const resizedHeight = Math.max(1, Math.round(sourceCanvas.height * scale));
  const padX = Math.floor((DETECTION_INPUT_SIZE - resizedWidth) / 2);
  const padY = Math.floor((DETECTION_INPUT_SIZE - resizedHeight) / 2);

  const canvas = new OffscreenCanvas(DETECTION_INPUT_SIZE, DETECTION_INPUT_SIZE);
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });
  if (!context) {
    throw createPdfMathError("worker_error", "Canvas rendering context unavailable.", false);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, DETECTION_INPUT_SIZE, DETECTION_INPUT_SIZE);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    sourceCanvas,
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
    padX,
    padY,
    resizedWidth,
    resizedHeight
  );

  const imageData = context.getImageData(0, 0, DETECTION_INPUT_SIZE, DETECTION_INPUT_SIZE).data;
  const tensor = createRgbTensor(imageData, DETECTION_INPUT_SIZE, DETECTION_INPUT_SIZE, (channel) => channel / 255);

  return {
    tensor,
    scale,
    padX,
    padY,
    sourceWidth: sourceCanvas.width,
    sourceHeight: sourceCanvas.height
  };
}

function prepareRecognizerInput(sourceCanvas, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });
  if (!context) {
    throw createPdfMathError("worker_error", "Canvas rendering context unavailable.", false);
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height).data;
  return {
    tensor: createRgbTensor(imageData, width, height, (channel) => (channel / 255 - 0.5) / 0.5)
  };
}

function createRgbTensor(imageData, width, height, normalizeChannel) {
  const planeSize = width * height;
  const data = new Float32Array(planeSize * 3);

  for (let index = 0; index < planeSize; index += 1) {
    const pixelOffset = index * 4;
    data[index] = normalizeChannel(imageData[pixelOffset]);
    data[planeSize + index] = normalizeChannel(imageData[pixelOffset + 1]);
    data[planeSize * 2 + index] = normalizeChannel(imageData[pixelOffset + 2]);
  }

  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

function decodeDetections(rawOutput, prepared) {
  const channels = 6;
  const anchorCount = rawOutput.length / channels;
  const detections = [];

  for (let anchorIndex = 0; anchorIndex < anchorCount; anchorIndex += 1) {
    const score = Math.max(
      Number(rawOutput[anchorCount * 4 + anchorIndex] || 0),
      Number(rawOutput[anchorCount * 5 + anchorIndex] || 0)
    );
    if (score < DETECTION_SCORE_THRESHOLD) {
      continue;
    }

    const centerX = Number(rawOutput[anchorIndex] || 0);
    const centerY = Number(rawOutput[anchorCount + anchorIndex] || 0);
    const width = Number(rawOutput[anchorCount * 2 + anchorIndex] || 0);
    const height = Number(rawOutput[anchorCount * 3 + anchorIndex] || 0);

    const left = clamp((centerX - width / 2 - prepared.padX) / prepared.scale, 0, prepared.sourceWidth);
    const top = clamp((centerY - height / 2 - prepared.padY) / prepared.scale, 0, prepared.sourceHeight);
    const right = clamp((centerX + width / 2 - prepared.padX) / prepared.scale, 0, prepared.sourceWidth);
    const bottom = clamp((centerY + height / 2 - prepared.padY) / prepared.scale, 0, prepared.sourceHeight);

    if (right <= left || bottom <= top) {
      continue;
    }

    detections.push({
      score,
      bounds: {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      }
    });
  }

  return detections.sort((left, right) => right.score - left.score);
}

function nonMaximumSuppress(detections, threshold) {
  const selected = [];
  for (const candidate of detections) {
    if (selected.some((accepted) => intersectionOverUnion(candidate.bounds, accepted.bounds) > threshold)) {
      continue;
    }
    selected.push(candidate);
  }
  return selected;
}

function selectDetection(detections, clickPoint) {
  if (!detections.length) {
    return null;
  }

  const ranked = detections
    .map((detection) => ({
      detection,
      distance: distanceToBounds(clickPoint, detection.bounds)
    }))
    .sort((left, right) => left.distance - right.distance || right.detection.score - left.detection.score);

  const best = ranked[0];
  if (!best) {
    return null;
  }

  const tolerance = Math.max(
    DETECTION_CLICK_TOLERANCE,
    Math.min(best.detection.bounds.width, best.detection.bounds.height) * 0.75
  );
  if (best.distance > tolerance) {
    return null;
  }

  return best.detection;
}

function distanceToBounds(point, bounds) {
  const dx = point.x < bounds.x
    ? bounds.x - point.x
    : point.x > bounds.x + bounds.width
      ? point.x - (bounds.x + bounds.width)
      : 0;
  const dy = point.y < bounds.y
    ? bounds.y - point.y
    : point.y > bounds.y + bounds.height
      ? point.y - (bounds.y + bounds.height)
      : 0;
  return Math.hypot(dx, dy);
}

function intersectionOverUnion(left, right) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);

  if (x2 <= x1 || y2 <= y1) {
    return 0;
  }

  const intersection = (x2 - x1) * (y2 - y1);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function translateBounds(bounds, cropRect) {
  return {
    x: bounds.x + Number(cropRect?.x || 0),
    y: bounds.y + Number(cropRect?.y || 0),
    width: bounds.width,
    height: bounds.height
  };
}

function normalizeClickPoint(clickPoint, sourceCanvas) {
  return {
    x: clamp(Number(clickPoint?.x || 0), 0, sourceCanvas.width),
    y: clamp(Number(clickPoint?.y || 0), 0, sourceCanvas.height)
  };
}

function normalizeRect(rect, maxWidth, maxHeight) {
  const x = clamp(Math.floor(Number(rect?.x || 0)), 0, maxWidth);
  const y = clamp(Math.floor(Number(rect?.y || 0)), 0, maxHeight);
  const width = Math.max(1, Math.min(maxWidth - x, Math.floor(Number(rect?.width || maxWidth || 1))));
  const height = Math.max(1, Math.min(maxHeight - y, Math.floor(Number(rect?.height || maxHeight || 1))));
  return {
    x,
    y,
    width,
    height
  };
}

function argmaxSoftmax(logits) {
  let maxLogit = Number.NEGATIVE_INFINITY;
  let maxIndex = 0;
  for (let index = 0; index < logits.length; index += 1) {
    const value = logits[index];
    if (value > maxLogit) {
      maxLogit = value;
      maxIndex = index;
    }
  }

  let denominator = 0;
  for (let index = 0; index < logits.length; index += 1) {
    denominator += Math.exp(logits[index] - maxLogit);
  }
  return {
    tokenId: maxIndex,
    probability: denominator > 0 ? 1 / denominator : 0
  };
}

function postProcessLatex(text) {
  let nextText = removeRedundantScript(String(text || ""));
  nextText = removeTrailingWhitespace(nextText);
  nextText = replaceIllegalSymbols(nextText);
  for (let index = 0; index < 10; index += 1) {
    const updated = removeEmptyText(nextText);
    if (updated === nextText) {
      break;
    }
    nextText = updated;
  }
  nextText = fixLatexPairs(nextText);
  nextText = removeUnnecessarySpaces(nextText);
  return nextText.trim();
}

function removeRedundantScript(text) {
  return text
    .replace(/^\^\s*{\s*(.*?)\s*}/, "$1")
    .replace(/^_\s*{\s*(.*?)\s*}/, "$1")
    .trim();
}

function removeTrailingWhitespace(text) {
  return text.replace(/(?:\\ +|\\quad\s*|\\qquad\s*|\\,\s*|\\:\s*|\\;\s*|\\enspace\s*|\\thinspace\s*|\\!\s*)+$/g, "").trim();
}

function replaceIllegalSymbols(text) {
  return text
    .replace(/\\\./g, "\\ .")
    .replace(/\\=/g, "\\ =")
    .replace(/\\-/g, "\\ -")
    .replace(/\\~/g, "\\ ~");
}

function removeEmptyText(text) {
  return text
    .replace(/\\hat\s*{\s*}/g, "")
    .replace(/\^\s*{\s*}/g, "")
    .replace(/_\s*{\s*}/g, "")
    .replace(/\\text\s*{\s*}/g, "")
    .replace(/\\tilde\s*{\s*}/g, "")
    .replace(/\\bar\s*{\s*}/g, "")
    .replace(/\\vec\s*{\s*}/g, "")
    .replace(/\\acute\s*{\s*}/g, "")
    .replace(/\\grave\s*{\s*}/g, "")
    .replace(/\\breve\s*{\s*}/g, "")
    .replace(/\\overline\s*{\s*}/g, "")
    .replace(/\\dot\s*{\s*}/g, "")
    .replace(/\\ddot\s*{\s*}/g, "")
    .replace(/\\widehat\s*{\s*}/g, "")
    .replace(/\\widetilde\s*{\s*}/g, "")
    .trim();
}

function removeUnnecessarySpaces(text) {
  return text
    .replace(/\\([a-zA-Z]+) (?=[a-zA-Z])/g, "\\$1 ")
    .replace(/\\([a-zA-Z]+)\s+(?![a-zA-Z])/g, "\\$1")
    .replace(/(\{)\s+/g, "$1")
    .replace(/\s+(\})/g, "$1")
    .replace(/(?<=[^\\])\s*([+\-=])\s*/g, "$1")
    .replace(/\s*(\^|_)\s*/g, "$1");
}

function fixLatexPairs(text) {
  const normalized = String(text || "");
  let balance = 0;
  let output = "";
  for (const character of normalized) {
    if (character === "{") {
      balance += 1;
      output += character;
      continue;
    }
    if (character === "}" && balance === 0) {
      continue;
    }
    if (character === "}") {
      balance -= 1;
    }
    output += character;
  }
  if (balance > 0) {
    output += "}".repeat(balance);
  }
  return output.replace(/\s+/g, " ").trim();
}

function geometricMean(values) {
  const safeValues = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!safeValues.length) {
    return null;
  }

  const sum = safeValues.reduce((total, value) => total + Math.log(value), 0);
  return Math.exp(sum / safeValues.length);
}

function createZeroTensor(dims) {
  const size = dims.reduce((total, value) => total * value, 1);
  return new ort.Tensor("float32", new Float32Array(size), dims);
}

async function readJsonBlob(blob) {
  return JSON.parse(await blob.text());
}

async function blobToArrayBuffer(blob) {
  return blob.arrayBuffer();
}

async function hashBlob(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function assertActive(state) {
  if (state.disposed) {
    throw createPdfMathError("worker_error", "PDF math runtime is disposed.", false);
  }
}

function assertModelsReady(state) {
  if (!state.detector?.session || !state.recognizer?.encoderSession || !state.recognizer?.decoderSession || !state.tokenizer) {
    throw createPdfMathError("pdf_not_ready", "PDF math models are not ready.", false);
  }
}
