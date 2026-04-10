const DEFAULT_NOTE_AI_MODEL_ROOT = "/models/note-ai";
const TEN_GIB = 10 * 1024 * 1024 * 1024;

export const NOTE_SPEECH_MODEL = Object.freeze({
  id: "Xenova/whisper-base",
  directory: "whisper-base",
  dtype: "q4",
  totalBytes: 268_130_659
});

export const NOTE_MATH_MODEL = Object.freeze({
  id: "DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC",
  directory: "DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC",
  modelLibFilename: "Qwen2-1.5B-Instruct-q4f32_1-ctx4k_cs1k-webgpu.wasm",
  totalBytes: 1_007_234_999,
  vramRequiredMB: 1888.97,
  contextWindowSize: 4096
});

export const NOTE_AI_REMOTE_TOTAL_BYTES =
  NOTE_SPEECH_MODEL.totalBytes + NOTE_MATH_MODEL.totalBytes;

export function resolveNoteAiModelRootUrl(explicitUrl = null) {
  if (explicitUrl !== null) {
    return normalizeNoteAiUrl(explicitUrl);
  }

  return normalizeNoteAiUrl(
    (typeof __NOTE_AI_MODEL_ROOT_URL__ === "string" && __NOTE_AI_MODEL_ROOT_URL__) ||
      DEFAULT_NOTE_AI_MODEL_ROOT
  );
}

export function getNoteSpeechModelPath(rootUrl = resolveNoteAiModelRootUrl()) {
  return joinRootUrl(rootUrl, NOTE_SPEECH_MODEL.directory);
}

export function getNoteMathModelUrl(rootUrl = resolveNoteAiModelRootUrl()) {
  return joinRootUrl(rootUrl, NOTE_MATH_MODEL.directory);
}

export function getNoteMathModelLibUrl(rootUrl = resolveNoteAiModelRootUrl()) {
  return joinRootUrl(rootUrl, `webllm/${NOTE_MATH_MODEL.modelLibFilename}`);
}

export function createNoteMathAppConfig(rootUrl = resolveNoteAiModelRootUrl()) {
  return {
    useIndexedDBCache: true,
    model_list: [
      {
        model: getNoteMathModelUrl(rootUrl),
        model_id: NOTE_MATH_MODEL.id,
        model_lib: getNoteMathModelLibUrl(rootUrl),
        low_resource_required: true,
        vram_required_MB: NOTE_MATH_MODEL.vramRequiredMB,
        overrides: {
          context_window_size: NOTE_MATH_MODEL.contextWindowSize
        }
      }
    ]
  };
}

export function isNoteAiRemoteFootprintSafe(limitBytes = TEN_GIB) {
  return NOTE_AI_REMOTE_TOTAL_BYTES <= Number(limitBytes || 0);
}

export function buildMathInterpretationMessages(transcript) {
  const normalizedTranscript = String(transcript || "").trim();
  return [
    {
      role: "system",
      content:
        "You convert spoken mathematics into LaTeX. Return strict JSON with keys latex and spokenText. Use an empty string for latex when there is no mathematical content."
    },
    {
      role: "user",
      content: [
        "Turn any spoken math in this transcript into valid LaTeX.",
        "Keep plain prose out of the latex field.",
        'Respond only with JSON, for example: {"latex":"\\\\int_0^1 x^2 \\\\; dx","spokenText":"integral from zero to one of x squared d x"}',
        "",
        normalizedTranscript
      ].join("\n")
    }
  ];
}

export function parseMathInterpretation(rawResponse) {
  const cleaned = normalizeWhitespace(stripThinking(stripCodeFences(rawResponse)));
  if (!cleaned) {
    return {
      mathLatex: "",
      spokenText: "",
      rawText: ""
    };
  }

  const jsonCandidate = extractJsonObject(cleaned);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      return {
        mathLatex: normalizeLatex(parsed?.latex),
        spokenText: normalizeWhitespace(parsed?.spokenText || ""),
        rawText: cleaned
      };
    } catch {
      // Fall through to the plain-text heuristics below.
    }
  }

  return {
    mathLatex: looksLikeLatex(cleaned) ? normalizeLatex(cleaned) : "",
    spokenText: "",
    rawText: cleaned
  };
}

export function buildNoteAiRequestId(prefix = "note-ai") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyNoteAiState() {
  return {
    supported: false,
    mathCapable: false,
    recording: false,
    transcribing: false,
    interpreting: false,
    progressLabel: "",
    progressLoadedBytes: 0,
    progressTotalBytes: 0,
    transcript: "",
    mathLatex: "",
    error: ""
  };
}

function normalizeNoteAiUrl(value) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  if (normalizedValue.startsWith("/")) {
    return normalizedValue.replace(/\/+$/g, "");
  }

  try {
    const url = new URL(normalizedValue);
    return ["http:", "https:"].includes(url.protocol)
      ? url.toString().replace(/\/+$/g, "")
      : "";
  } catch {
    return "";
  }
}

function joinRootUrl(rootUrl, suffix) {
  const normalizedRoot = normalizeNoteAiUrl(rootUrl);
  const normalizedSuffix = String(suffix || "").replace(/^\/+/g, "");
  if (!normalizedRoot || !normalizedSuffix) {
    return normalizedRoot || "";
  }

  return `${normalizedRoot}/${normalizedSuffix}`;
}

function stripThinking(value) {
  return String(value || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function stripCodeFences(value) {
  return String(value || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonObject(value) {
  const source = String(value || "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return "";
  }

  return source.slice(start, end + 1);
}

function normalizeLatex(value) {
  return String(value || "")
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/\s+/g, " ");
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function looksLikeLatex(value) {
  const source = String(value || "").trim();
  if (!source) {
    return false;
  }

  return (
    /\\[a-zA-Z]+/.test(source) ||
    /[_^{}]/.test(source) ||
    /^\$[^$]+\$$/.test(source) ||
    /^\\\[[\s\S]*\\\]$/.test(source)
  );
}
