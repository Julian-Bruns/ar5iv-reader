import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => {
  const detectorFiles = {
    "config.yaml": "static-shape: false\n",
    "mfd-v20240618.onnx": "detector-onnx"
  };
  const recognizerFiles = {
    "config.json": JSON.stringify({
      encoder: {
        image_size: 384
      },
      decoder: {
        vocab_size: 8
      },
      decoder_start_token_id: 2,
      eos_token_id: 2
    }),
    "generation_config.json": JSON.stringify({
      decoder_start_token_id: 2,
      eos_token_id: 2,
      max_new_tokens: 8
    }),
    "tokenizer.json": JSON.stringify({
      model: {
        type: "BPE",
        vocab: {
          "<pad>": 0,
          "<s>": 1,
          "</s>": 2,
          "<unk>": 3,
          "<mask>": 4,
          x: 5,
          "+": 6,
          y: 7
        }
      }
    }),
    "encoder_model.onnx": "encoder-onnx",
    "decoder_model.onnx": "decoder-onnx"
  };
  const manifest = createManifest({
    "breezedeus/pix2text-mfd": {
      role: "detector",
      files: {
        "config.yaml": {
          contents: detectorFiles["config.yaml"],
          size: 20,
          sha256: "6d834ea95d49fe774f3c4c50323964e45cb4bcf68d70d923a3f3c9f61a91a36b"
        },
        "mfd-v20240618.onnx": {
          contents: detectorFiles["mfd-v20240618.onnx"],
          size: 13,
          sha256: "286f4afcf9a8c428054432112f249715d56a843b8db4fbaa980508bd8cabb933"
        }
      }
    },
    "breezedeus/pix2text-mfr": {
      role: "recognizer",
      files: {
        "config.json": {
          contents: recognizerFiles["config.json"],
          size: 101,
          sha256: "4b37b208df91fa1f9728f730fa1d42d99280fa326ab7bc60c69913a32025f1c5"
        },
        "generation_config.json": {
          contents: recognizerFiles["generation_config.json"],
          size: 64,
          sha256: "b5fdc12b97dd9ad71a9a19540c362a2513655243c683236968f5e0279d386296"
        },
        "tokenizer.json": {
          contents: recognizerFiles["tokenizer.json"],
          size: 100,
          sha256: "70d4af68630f43116eff8a6e62633b3eff7d38593d9f9028d7032f3b7c1d8a33"
        },
        "encoder_model.onnx": {
          contents: recognizerFiles["encoder_model.onnx"],
          size: 12,
          sha256: "0fd3e4e0b9fb1ce13e0f00042c57afb7207c975112c43a68efe4dc0a8bcfdc36"
        },
        "decoder_model.onnx": {
          contents: recognizerFiles["decoder_model.onnx"],
          size: 12,
          sha256: "26fe14394c04fdaa87bdf519fd0038a56182d45345310b6d7d8d51ca5d95e37d"
        }
      }
    }
  });

  return {
    manifest,
    detectorFiles,
    recognizerFiles,
    records: new Map(),
    meta: new Map(),
    fetchCalls: [],
    deletedKeys: [],
    ortCreates: [],
    ortCreateOptions: []
  };
});

vi.mock("./pdfMathManifest", () => ({
  getPdfMathModelManifest() {
    return runtimeMocks.manifest;
  },
  getPdfMathModelEntry(modelId) {
    return runtimeMocks.manifest.models[modelId] || null;
  }
}));

vi.mock("./pdfMathModelStore", () => ({
  buildMlModelRecordKey(revision, modelId, filename) {
    return `${revision}::${modelId}::${filename}`;
  },
  async listMlModelRecords({ revision = "", modelId = "" } = {}) {
    return [...runtimeMocks.records.values()].filter(
      (record) =>
        (!revision || record.revision === revision) &&
        (!modelId || record.modelId === modelId)
    );
  },
  async putMlModelRecord(record) {
    runtimeMocks.records.set(record.key, {
      ...record
    });
  },
  async deleteMlModelRecord(key) {
    runtimeMocks.deletedKeys.push(key);
    runtimeMocks.records.delete(key);
  },
  async getMlModelMetaRecord(key) {
    return runtimeMocks.meta.get(key) || null;
  },
  async putMlModelMetaRecord(record) {
    runtimeMocks.meta.set(record.key, {
      ...record
    });
  }
}));

vi.mock("onnxruntime-web/webgpu", () => {
  class Tensor {
    constructor(type, data, dims) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  }

  return {
    env: {
      wasm: {},
      webgpu: {}
    },
    Tensor,
    InferenceSession: {
      create: vi.fn(async (buffer, options) => {
        const tag = Buffer.from(buffer).toString("utf8");
        runtimeMocks.ortCreates.push(tag);
        runtimeMocks.ortCreateOptions.push(options || null);
        if (tag === "detector-onnx") {
          return {
            async run() {
              return {
                output0: {
                  data: new Float32Array([320, 320, 200, 120, 0.95, 0.05]),
                  dims: [1, 6, 1]
                }
              };
            },
            release: vi.fn()
          };
        }

        if (tag === "encoder-onnx") {
          return {
            async run() {
              return {
                last_hidden_state: new Tensor(
                  "float32",
                  new Float32Array(578 * 384),
                  [1, 578, 384]
                )
              };
            },
            release: vi.fn()
          };
        }

        if (tag === "decoder-onnx") {
          return {
            async run(inputs) {
              const sequence = [5, 6, 7, 2];
              const length = inputs.input_ids.dims[1];
              const vocabSize = 8;
              const logits = new Float32Array(length * vocabSize);
              const nextTokenId = sequence[Math.min(length - 1, sequence.length - 1)];
              logits[(length - 1) * vocabSize + nextTokenId] = 10;
              return {
                logits: new Tensor("float32", logits, [1, length, vocabSize])
              };
            },
            release: vi.fn()
          };
        }

        throw new Error(`Unexpected model buffer: ${tag}`);
      })
    }
  };
});

describe("pdfMathRuntime", () => {
  beforeEach(() => {
    vi.resetModules();
    runtimeMocks.records.clear();
    runtimeMocks.meta.clear();
    runtimeMocks.fetchCalls.length = 0;
    runtimeMocks.deletedKeys.length = 0;
    runtimeMocks.ortCreates.length = 0;
    runtimeMocks.ortCreateOptions.length = 0;

    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        gpu: {
          requestAdapter: vi.fn(async () => ({
            requestDevice: vi.fn(async () => ({
              label: "selected-device"
            }))
          }))
        }
      }
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: vi.fn(async (url) => {
        runtimeMocks.fetchCalls.push(String(url));
        const filename = String(url).split("/").at(-1)?.replace(/\?download=true$/, "") || "";
        const body = getFixtureContents(filename);
        if (!body) {
          return {
            ok: false,
            status: 404,
            async blob() {
              return new Blob([]);
            }
          };
        }

        return {
          ok: true,
          status: 200,
          async blob() {
            return new Blob([body]);
          }
        };
      })
    });
    Object.defineProperty(globalThis, "OffscreenCanvas", {
      configurable: true,
      value: FakeOffscreenCanvas
    });
  });

  it("downloads, validates, caches, and reuses model assets", async () => {
    const { createPdfMathRuntime } = await import("./pdfMathRuntime");
    const runtime = await createPdfMathRuntime();

    await runtime.loadModels([
      {
        role: "detector",
        modelId: "breezedeus/pix2text-mfd"
      },
      {
        role: "recognizer",
        modelId: "breezedeus/pix2text-mfr"
      }
    ]);

    expect(runtimeMocks.fetchCalls).toHaveLength(7);
    expect(runtimeMocks.records.size).toBe(7);
    expect(runtimeMocks.meta.get("breezedeus/pix2text-mfd")?.files).toEqual([
      "config.yaml",
      "mfd-v20240618.onnx"
    ]);
    expect(runtimeMocks.meta.get("breezedeus/pix2text-mfr")?.files).toEqual([
      "config.json",
      "generation_config.json",
      "tokenizer.json",
      "encoder_model.onnx",
      "decoder_model.onnx"
    ]);

    runtimeMocks.fetchCalls.length = 0;
    const secondRuntime = await createPdfMathRuntime();
    await secondRuntime.loadModels([
      {
        role: "detector",
        modelId: "breezedeus/pix2text-mfd"
      },
      {
        role: "recognizer",
        modelId: "breezedeus/pix2text-mfr"
      }
    ]);

    expect(runtimeMocks.fetchCalls).toHaveLength(0);
  });

  it("passes the selected WebGPU device into each ORT WebGPU session", async () => {
    const fakeDevice = {
      label: "selected-device"
    };
    const fakeAdapter = {
      requestDevice: vi.fn(async () => fakeDevice)
    };
    globalThis.navigator.gpu.requestAdapter = vi.fn(async (options) =>
      options?.powerPreference === "high-performance" ? fakeAdapter : null
    );

    const { createPdfMathRuntime } = await import("./pdfMathRuntime");
    const runtime = await createPdfMathRuntime();
    await runtime.loadModels([
      {
        role: "detector",
        modelId: "breezedeus/pix2text-mfd"
      },
      {
        role: "recognizer",
        modelId: "breezedeus/pix2text-mfr"
      }
    ]);

    expect(fakeAdapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.ortCreateOptions).toEqual([
      {
        executionProviders: [
          {
            name: "webgpu",
            device: fakeDevice,
            validationMode: "basic"
          }
        ]
      },
      {
        executionProviders: [
          {
            name: "webgpu",
            device: fakeDevice,
            validationMode: "basic"
          }
        ]
      },
      {
        executionProviders: [
          {
            name: "webgpu",
            device: fakeDevice,
            validationMode: "basic"
          }
        ]
      }
    ]);
  });

  it("repairs a corrupted cached file by deleting and refetching only that file", async () => {
    const { createPdfMathRuntime } = await import("./pdfMathRuntime");
    const runtime = await createPdfMathRuntime();

    await runtime.loadModels([
      {
        role: "detector",
        modelId: "breezedeus/pix2text-mfd"
      },
      {
        role: "recognizer",
        modelId: "breezedeus/pix2text-mfr"
      }
    ]);

    runtimeMocks.fetchCalls.length = 0;
    const corruptKey = "breezedeus-pix2text-v1::breezedeus/pix2text-mfr::tokenizer.json";
    runtimeMocks.records.set(corruptKey, {
      ...runtimeMocks.records.get(corruptKey),
      blob: new Blob(["corrupt"]),
      size: 7
    });

    const repairedRuntime = await createPdfMathRuntime();
    await repairedRuntime.loadModels([
      {
        role: "detector",
        modelId: "breezedeus/pix2text-mfd"
      },
      {
        role: "recognizer",
        modelId: "breezedeus/pix2text-mfr"
      }
    ]);

    expect(runtimeMocks.deletedKeys).toContain(corruptKey);
    expect(runtimeMocks.fetchCalls).toEqual([
      "/models/breezedeus-pix2text-v1/pix2text-mfr/tokenizer.json"
    ]);
  });

  it("runs benchmark and returns recognized LaTeX when a formula box matches the click", async () => {
    const { createPdfMathRuntime } = await import("./pdfMathRuntime");
    const runtime = await createPdfMathRuntime();
    await runtime.loadModels([
      {
        role: "detector",
        modelId: "breezedeus/pix2text-mfd"
      },
      {
        role: "recognizer",
        modelId: "breezedeus/pix2text-mfr"
      }
    ]);

    const benchmark = await runtime.runBenchmark({
      thresholdMs: 5_000
    });
    expect(benchmark.passed).toBe(true);
    expect(benchmark.durationMs).toBeGreaterThanOrEqual(0);

    const result = await runtime.detectAndRecognize({
      imageBitmap: {
        width: 100,
        height: 100,
        close: vi.fn()
      },
      clickPoint: {
        x: 50,
        y: 50
      },
      cropRect: {
        x: 0,
        y: 0,
        width: 100,
        height: 100
      }
    });

    expect(result).toEqual({
      status: "ok",
      latex: "x+y",
      confidence: expect.any(Number),
      bounds: expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number)
      }),
      reason: ""
    });
  });

  it("returns no_formula_detected when the click is outside valid detections", async () => {
    const { createPdfMathRuntime } = await import("./pdfMathRuntime");
    const runtime = await createPdfMathRuntime();
    await runtime.loadModels([
      {
        role: "detector",
        modelId: "breezedeus/pix2text-mfd"
      },
      {
        role: "recognizer",
        modelId: "breezedeus/pix2text-mfr"
      }
    ]);

    const result = await runtime.detectAndRecognize({
      imageBitmap: {
        width: 100,
        height: 100,
        close: vi.fn()
      },
      clickPoint: {
        x: 0,
        y: 0
      },
      cropRect: {
        x: 0,
        y: 0,
        width: 100,
        height: 100
      }
    });

    expect(result).toEqual({
      status: "no-match",
      latex: "",
      confidence: null,
      bounds: null,
      reason: "no_formula_detected"
    });
  });
});

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {
      fillStyle: "#ffffff",
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
      fillRect() {},
      drawImage() {},
      getImageData: (_x, _y, width, height) => ({
        data: new Uint8ClampedArray(width * height * 4).fill(255)
      })
    };
  }
}

function createManifest(modelDefinitions) {
  return {
    revision: "breezedeus-pix2text-v1",
    models: Object.fromEntries(
      Object.entries(modelDefinitions).map(([modelId, definition]) => [
        modelId,
        {
          role: definition.role,
          modelId,
          files: Object.entries(definition.files).map(([filename, descriptor]) => ({
            filename,
            size: descriptor.size,
            sha256: descriptor.sha256,
            sameOriginUrl: `/models/breezedeus-pix2text-v1/${modelId.split("/")[1]}/${filename}`,
            remoteUrl: `https://example.invalid/${modelId}/${filename}`
          }))
        }
      ])
    )
  };
}

function getFixtureContents(filename) {
  return (
    runtimeMocks.detectorFiles[filename] ||
    runtimeMocks.recognizerFiles[filename] ||
    ""
  );
}
