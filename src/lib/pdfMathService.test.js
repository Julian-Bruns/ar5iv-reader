import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  setSetting: vi.fn(),
  SETTING_KEYS: {
    pdfMathCopyCapability: "pdfMathCopyCapability",
    pdfMathCopyBenchmark: "pdfMathCopyBenchmark",
    pdfMathCopyModelRevision: "pdfMathCopyModelRevision"
  }
}));

vi.mock("./db", () => ({
  setSetting: dbMocks.setSetting,
  SETTING_KEYS: dbMocks.SETTING_KEYS
}));

describe("pdfMathService", () => {
  beforeEach(() => {
    vi.resetModules();
    dbMocks.setSetting.mockReset();
    installBrowserEnvironment();
    installWorkerScenario({
      INIT(message) {
        this.emitReady(message.requestId, "init");
      },
      LOAD_MODELS(message) {
        this.emitReady(message.requestId, "models");
      },
      RUN_BENCHMARK(message) {
        this.emitBenchmark(message.requestId, {
          durationMs: 321,
          passed: true,
          thresholdMs: message.payload.thresholdMs
        });
      }
    });
  });

  it("dedupes concurrent prefetch calls and persists diagnostics", async () => {
    const service = await import("./pdfMathService");

    const [first, second] = await Promise.all([service.prefetch(), service.prefetch()]);

    expect(first).toEqual({
      phase: "ready",
      enabled: true,
      reason: "",
      benchmarkMs: 321,
      modelRevision: "breezedeus-pix2text-v1",
      refCount: 0
    });
    expect(second).toEqual(first);
    expect(service.status()).toEqual(first);

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].messages.map((message) => message.type)).toEqual([
      "INIT",
      "LOAD_MODELS",
      "RUN_BENCHMARK"
    ]);
    expect(dbMocks.setSetting).toHaveBeenCalledWith(
      dbMocks.SETTING_KEYS.pdfMathCopyCapability,
      expect.objectContaining({
        enabled: true,
        reason: ""
      })
    );
    expect(dbMocks.setSetting).toHaveBeenCalledWith(
      dbMocks.SETTING_KEYS.pdfMathCopyModelRevision,
      "breezedeus-pix2text-v1"
    );
    expect(dbMocks.setSetting).toHaveBeenCalledWith(
      dbMocks.SETTING_KEYS.pdfMathCopyBenchmark,
      expect.objectContaining({
        durationMs: 321,
        thresholdMs: 5000,
        passed: true
      })
    );
  });

  it("reuses the warmup benchmark after disposing and reacquiring the worker", async () => {
    const service = await import("./pdfMathService");

    await service.prefetch();
    await service.acquire();
    service.release();
    await flush();

    expect(FakeWorker.instances[0].messages.at(-1)?.type).toBe("DISPOSE");
    expect(FakeWorker.instances[0].terminated).toBe(true);

    await service.acquire();

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].messages.map((message) => message.type)).toEqual([
      "INIT",
      "LOAD_MODELS"
    ]);
  });

  it.each([
    {
      name: "insecure context",
      setup() {
        globalThis.window.isSecureContext = false;
      },
      reason: "insecure_context"
    },
    {
      name: "missing worker support",
      setup() {
        globalThis.Worker = undefined;
      },
      reason: "worker_unsupported"
    },
    {
      name: "missing gpu support",
      setup() {
        globalThis.navigator.gpu = undefined;
      },
      reason: "gpu_unavailable"
    },
    {
      name: "device memory below threshold",
      setup() {
        globalThis.navigator.deviceMemory = 4;
      },
      reason: "device_memory_too_low"
    },
    {
      name: "hardware concurrency below threshold",
      setup() {
        globalThis.navigator.hardwareConcurrency = 4;
      },
      reason: "hardware_concurrency_too_low"
    },
    {
      name: "free storage below threshold",
      setup() {
        globalThis.navigator.storage.estimate = vi.fn(async () => ({
          quota: 1_100_000_000,
          usage: 200_000_001
        }));
      },
      reason: "storage_free_too_low"
    }
  ])("maps $name to the frozen disabled reason", async ({ setup, reason }) => {
    setup();
    const service = await import("./pdfMathService");

    const result = await service.prefetch();

    expect(result).toEqual({
      phase: "disabled",
      enabled: false,
      reason,
      benchmarkMs: null,
      modelRevision: "breezedeus-pix2text-v1",
      refCount: 0
    });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("surfaces models_load_failed when the worker cannot load models", async () => {
    installWorkerScenario({
      INIT(message) {
        this.emitReady(message.requestId, "init");
      },
      LOAD_MODELS(message) {
        this.emitError(message.requestId, {
          code: "models_load_failed",
          message: "load failed",
          fatal: false
        });
      }
    });

    const service = await import("./pdfMathService");
    const result = await service.prefetch();

    expect(result.phase).toBe("error");
    expect(result.reason).toBe("models_load_failed");
    expect(result.enabled).toBe(false);
  });

  it("maps a benchmark worker failure to benchmark_failed", async () => {
    installWorkerScenario({
      INIT(message) {
        this.emitReady(message.requestId, "init");
      },
      LOAD_MODELS(message) {
        this.emitReady(message.requestId, "models");
      },
      RUN_BENCHMARK(message) {
        this.emitError(message.requestId, {
          code: "benchmark_failed",
          message: "benchmark failed",
          fatal: false
        });
      }
    });

    const service = await import("./pdfMathService");
    const result = await service.prefetch();

    expect(result.phase).toBe("error");
    expect(result.reason).toBe("benchmark_failed");
    expect(dbMocks.setSetting).toHaveBeenCalledWith(
      dbMocks.SETTING_KEYS.pdfMathCopyBenchmark,
      expect.objectContaining({
        durationMs: null,
        thresholdMs: 5000,
        passed: false
      })
    );
  });

  it("disables the feature when the benchmark exceeds the frozen threshold", async () => {
    installWorkerScenario({
      INIT(message) {
        this.emitReady(message.requestId, "init");
      },
      LOAD_MODELS(message) {
        this.emitReady(message.requestId, "models");
      },
      RUN_BENCHMARK(message) {
        this.emitBenchmark(message.requestId, {
          durationMs: 5001,
          passed: false,
          thresholdMs: message.payload.thresholdMs
        });
      }
    });

    const service = await import("./pdfMathService");
    const result = await service.prefetch();

    expect(result).toEqual({
      phase: "disabled",
      enabled: false,
      reason: "benchmark_too_slow",
      benchmarkMs: 5001,
      modelRevision: "breezedeus-pix2text-v1",
      refCount: 0
    });
  });

  it("waits for in-flight recognition before disposing on release", async () => {
    let pendingDetectRequestId = "";
    installWorkerScenario({
      INIT(message) {
        this.emitReady(message.requestId, "init");
      },
      LOAD_MODELS(message) {
        this.emitReady(message.requestId, "models");
      },
      RUN_BENCHMARK(message) {
        this.emitBenchmark(message.requestId, {
          durationMs: 120,
          passed: true,
          thresholdMs: message.payload.thresholdMs
        });
      },
      DETECT_AND_RECOGNIZE(message) {
        pendingDetectRequestId = message.requestId;
      }
    });

    const service = await import("./pdfMathService");
    await service.acquire();

    const pending = service.detectAndRecognize({
      imageBitmap: { tag: "bitmap" },
      clickPoint: { x: 12, y: 34 },
      cropRect: { x: 1, y: 2, width: 3, height: 4 }
    });
    service.release();

    expect(FakeWorker.instances[0].messages.some((message) => message.type === "DISPOSE")).toBe(false);

    FakeWorker.instances[0].emitResult(pendingDetectRequestId, {
      status: "ok",
      latex: "\\alpha",
      confidence: 0.9,
      bounds: {
        x: 1,
        y: 2,
        width: 3,
        height: 4
      },
      reason: ""
    });

    await expect(pending).resolves.toEqual({
      status: "ok",
      latex: "\\alpha",
      confidence: 0.9,
      bounds: {
        x: 1,
        y: 2,
        width: 3,
        height: 4
      },
      reason: ""
    });
    await flush();

    expect(FakeWorker.instances[0].messages.some((message) => message.type === "DISPOSE")).toBe(true);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });
});

function installBrowserEnvironment() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      isSecureContext: true
    }
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {},
      deviceMemory: 16,
      hardwareConcurrency: 12,
      storage: {
        estimate: vi.fn(async () => ({
          quota: 3_000_000_000,
          usage: 1_000_000_000
        }))
      }
    }
  });
}

function installWorkerScenario(handlers) {
  FakeWorker.instances = [];
  FakeWorker.handlers = handlers;
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: FakeWorker
  });
}

class FakeWorker {
  static instances = [];
  static handlers = {};

  constructor(url) {
    this.url = url;
    this.messages = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
    const handler = FakeWorker.handlers[message.type];
    if (handler) {
      handler.call(this, message);
    }
  }

  terminate() {
    this.terminated = true;
  }

  emitReady(requestId, stage) {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "READY",
          requestId,
          payload: {
            stage
          }
        }
      });
    });
  }

  emitBenchmark(requestId, payload) {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "BENCHMARK_RESULT",
          requestId,
          payload
        }
      });
    });
  }

  emitResult(requestId, payload) {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "RESULT",
          requestId,
          payload
        }
      });
    });
  }

  emitError(requestId, payload) {
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "ERROR",
          requestId,
          payload
        }
      });
    });
  }
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
