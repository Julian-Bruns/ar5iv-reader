import { buildNoteAiRequestId } from "./noteAiCommon";

let workerHandle = null;

export function getNoteAiCapabilities() {
  const secureContext = typeof window !== "undefined" && window.isSecureContext === true;
  const mediaCaptureSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder === "function";
  const audioDecodeSupported = Boolean(
    globalThis.AudioContext || globalThis.webkitAudioContext
  );
  const workerSupported = typeof Worker === "function";
  const webGpuSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.gpu?.requestAdapter);

  return {
    supported: secureContext && mediaCaptureSupported && audioDecodeSupported && workerSupported,
    mathCapable:
      secureContext &&
      mediaCaptureSupported &&
      audioDecodeSupported &&
      workerSupported &&
      webGpuSupported
  };
}

export async function prefetchNoteAiRuntime() {
  const capabilities = getNoteAiCapabilities();
  if (!capabilities.supported) {
    return capabilities;
  }

  await sendWorkerRequest("PING", {});
  return capabilities;
}

export async function transcribeNoteSpeech(audio, { onProgress } = {}) {
  const samples = audio?.samples instanceof Float32Array ? audio.samples : null;
  if (!samples?.length) {
    throw new Error("No recorded audio was provided for transcription.");
  }

  const buffer = samples.buffer.slice(0);
  return sendWorkerRequest(
    "TRANSCRIBE",
    {
      audioBuffer: buffer,
      sampleRate: Number(audio?.sampleRate || 16_000)
    },
    [buffer],
    onProgress
  );
}

export async function interpretNoteMath(transcript, { onProgress } = {}) {
  const normalizedTranscript = String(transcript || "").trim();
  if (!normalizedTranscript) {
    return {
      mathLatex: "",
      spokenText: "",
      rawText: ""
    };
  }

  return sendWorkerRequest(
    "INTERPRET",
    {
      transcript: normalizedTranscript
    },
    [],
    onProgress
  );
}

function ensureWorkerHandle() {
  if (workerHandle?.worker) {
    return workerHandle;
  }

  const worker = new Worker(new URL("./noteAiWorker.js", import.meta.url), {
    type: "module"
  });
  const handle = {
    worker,
    pending: new Map()
  };

  worker.onmessage = (event) => {
    const message = event?.data || {};
    const requestId = String(message?.requestId || "");
    const pending = handle.pending.get(requestId);
    if (!pending) {
      return;
    }

    if (message.type === "PROGRESS") {
      pending.onProgress?.(message.payload || {});
      return;
    }

    handle.pending.delete(requestId);

    if (message.type === "ERROR") {
      pending.reject(new Error(message?.payload?.message || "Note AI worker error."));
      return;
    }

    pending.resolve(message?.payload || {});
  };

  worker.onerror = (event) => {
    const error = new Error(event?.message || "Note AI worker crashed.");
    for (const pending of handle.pending.values()) {
      pending.reject(error);
    }
    handle.pending.clear();
    worker.terminate();
    workerHandle = null;
  };

  workerHandle = handle;
  return handle;
}

function sendWorkerRequest(type, payload, transfer = [], onProgress) {
  const handle = ensureWorkerHandle();
  const requestId = buildNoteAiRequestId(type.toLowerCase());

  return new Promise((resolve, reject) => {
    handle.pending.set(requestId, {
      resolve,
      reject,
      onProgress
    });

    handle.worker.postMessage(
      {
        type,
        requestId,
        payload
      },
      transfer
    );
  });
}
