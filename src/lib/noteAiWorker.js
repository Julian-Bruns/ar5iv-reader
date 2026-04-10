import {
  buildMathInterpretationMessages,
  createNoteMathAppConfig,
  getNoteSpeechModelPath,
  NOTE_MATH_MODEL,
  parseMathInterpretation
} from "./noteAiCommon";

const workerState = {
  transcriber: null,
  transcriberPromise: null,
  mathEngine: null,
  mathEnginePromise: null
};

self.onmessage = (event) => {
  void handleWorkerMessage(event?.data || {});
};

async function handleWorkerMessage(message) {
  const requestId = String(message?.requestId || "");
  const type = String(message?.type || "");
  const payload = message?.payload || {};

  try {
    if (type === "PING") {
      postReady(requestId, {
        pong: true
      });
      return;
    }

    if (type === "TRANSCRIBE") {
      await handleTranscription(requestId, payload);
      return;
    }

    if (type === "INTERPRET") {
      await handleMathInterpretation(requestId, payload);
      return;
    }

    throw new Error(`Unsupported note AI request: ${type}`);
  } catch (error) {
    postMessage({
      type: "ERROR",
      requestId,
      payload: {
        message: error?.message || "Note AI request failed."
      }
    });
  }
}

async function handleTranscription(requestId, payload) {
  const transcriber = await ensureTranscriber(requestId);
  const audioBuffer = payload?.audioBuffer;
  const samples = audioBuffer instanceof ArrayBuffer ? new Float32Array(audioBuffer) : null;
  if (!samples?.length) {
    throw new Error("Recorded audio data was empty.");
  }

  const result = await transcriber(samples, {
    task: "transcribe",
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5
  });

  postReady(requestId, {
    text: String(result?.text || "").trim(),
    chunks: Array.isArray(result?.chunks) ? result.chunks : []
  });
}

async function handleMathInterpretation(requestId, payload) {
  const transcript = String(payload?.transcript || "").trim();
  if (!transcript) {
    postReady(requestId, {
      mathLatex: "",
      spokenText: "",
      rawText: ""
    });
    return;
  }

  const engine = await ensureMathEngine(requestId);
  const completion = await engine.chat.completions.create({
    messages: buildMathInterpretationMessages(transcript),
    temperature: 0,
    top_p: 0.9,
    max_tokens: 256,
    enable_thinking: false,
    stream: false
  });
  const rawText = String(completion?.choices?.[0]?.message?.content || "").trim();

  postReady(requestId, parseMathInterpretation(rawText));
}

async function ensureTranscriber(requestId) {
  if (workerState.transcriber) {
    return workerState.transcriber;
  }

  if (!workerState.transcriberPromise) {
    workerState.transcriberPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const transcriber = await pipeline(
        "automatic-speech-recognition",
        getNoteSpeechModelPath(),
        {
          dtype: "q4",
          device: "wasm",
          progress_callback(progress) {
            postProgress(requestId, {
              stage: "speech-load",
              label: "Loading Whisper base dictation model…",
              progress: Number(progress?.progress || 0),
              loadedBytes: Number(progress?.loaded || 0),
              totalBytes: Number(progress?.total || 0),
              file: String(progress?.file || "")
            });
          }
        }
      );
      workerState.transcriber = transcriber;
      return transcriber;
    })().finally(() => {
      workerState.transcriberPromise = null;
    });
  }

  return workerState.transcriberPromise;
}

async function ensureMathEngine(requestId) {
  if (workerState.mathEngine) {
    return workerState.mathEngine;
  }

  if (!workerState.mathEnginePromise) {
    workerState.mathEnginePromise = (async () => {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = new webllm.MLCEngine({
        appConfig: createNoteMathAppConfig(),
        initProgressCallback(report) {
          postProgress(requestId, {
            stage: "math-load",
            label: String(report?.text || "Loading DeepSeek math interpreter…"),
            progress: Number(report?.progress || 0),
            loadedBytes: 0,
            totalBytes: NOTE_MATH_MODEL.totalBytes
          });
        }
      });
      await engine.reload(NOTE_MATH_MODEL.id);
      workerState.mathEngine = engine;
      return engine;
    })().finally(() => {
      workerState.mathEnginePromise = null;
    });
  }

  return workerState.mathEnginePromise;
}

function postProgress(requestId, payload) {
  postMessage({
    type: "PROGRESS",
    requestId,
    payload
  });
}

function postReady(requestId, payload) {
  postMessage({
    type: "RESULT",
    requestId,
    payload
  });
}
