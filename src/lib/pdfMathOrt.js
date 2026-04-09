const DEFAULT_PDF_MATH_ORT_WASM_URL =
  "https://pub-204df3f8d4a445cdbda23b55ffae9214.r2.dev/vendor/onnxruntime-web/1.24.3/ort-wasm-simd-threaded.asyncify.wasm";

const WEBGPU_PROBE_ATTEMPTS = Object.freeze([
  Object.freeze({
    powerPreference: "high-performance",
    forceFallbackAdapter: false
  }),
  Object.freeze({}),
  Object.freeze({
    powerPreference: "low-power",
    forceFallbackAdapter: false
  }),
  Object.freeze({
    forceFallbackAdapter: true
  })
]);

export function normalizePdfMathOrtWasmUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(String(value).trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function resolvePdfMathOrtWasmUrl(explicitUrl = null) {
  if (explicitUrl !== null) {
    return normalizePdfMathOrtWasmUrl(explicitUrl);
  }

  return normalizePdfMathOrtWasmUrl(
    (typeof __PDF_MATH_ORT_WASM_URL__ === "string" && __PDF_MATH_ORT_WASM_URL__) ||
      DEFAULT_PDF_MATH_ORT_WASM_URL
  );
}

export function configurePdfMathOrtRuntime(ortNamespace, wasmUrl = resolvePdfMathOrtWasmUrl()) {
  if (!wasmUrl || !ortNamespace?.env?.wasm) {
    return "";
  }

  const currentPaths = ortNamespace.env.wasm.wasmPaths;
  ortNamespace.env.wasm.wasmPaths =
    currentPaths && typeof currentPaths === "object" && !Array.isArray(currentPaths)
      ? {
          ...currentPaths,
          wasm: wasmUrl
        }
      : {
          wasm: wasmUrl
        };

  return wasmUrl;
}

export async function probePdfMathWebGpu({
  navigatorObject = globalThis.navigator,
  requireDevice = true
} = {}) {
  if (!navigatorObject?.gpu || typeof navigatorObject.gpu.requestAdapter !== "function") {
    return createWebGpuProbeResult(false, "gpu_unavailable");
  }

  for (const options of WEBGPU_PROBE_ATTEMPTS) {
    let adapter = null;
    try {
      adapter = await navigatorObject.gpu.requestAdapter(options);
    } catch {
      adapter = null;
    }

    if (!adapter || typeof adapter.requestDevice !== "function") {
      continue;
    }

    if (!requireDevice) {
      return createWebGpuProbeResult(true, "", {
        adapter,
        powerPreference: normalizePowerPreference(options.powerPreference),
        forceFallbackAdapter: Boolean(options.forceFallbackAdapter)
      });
    }

    try {
      const device = await adapter.requestDevice();
      return createWebGpuProbeResult(true, "", {
        adapter,
        device,
        powerPreference: normalizePowerPreference(options.powerPreference),
        forceFallbackAdapter: Boolean(options.forceFallbackAdapter)
      });
    } catch {
      // Try the next adapter strategy before giving up.
    }
  }

  return createWebGpuProbeResult(false, "gpu_unavailable");
}

export function applyPdfMathOrtWebGpuSelection(ortNamespace, selection) {
  if (!ortNamespace?.env) {
    return null;
  }

  const webgpuEnv =
    ortNamespace.env.webgpu && typeof ortNamespace.env.webgpu === "object"
      ? ortNamespace.env.webgpu
      : (ortNamespace.env.webgpu = {});

  if (selection?.adapter) {
    webgpuEnv.adapter = selection.adapter;
  }

  if (selection?.device) {
    webgpuEnv.device = selection.device;
  }

  webgpuEnv.powerPreference = selection?.powerPreference || "high-performance";
  webgpuEnv.forceFallbackAdapter = Boolean(selection?.forceFallbackAdapter);
  return selection || null;
}

function normalizePowerPreference(value) {
  return value === "low-power" ? "low-power" : "high-performance";
}

function createWebGpuProbeResult(enabled, reason, selection = null) {
  return {
    enabled,
    reason,
    adapter: selection?.adapter || null,
    device: selection?.device || null,
    powerPreference: selection?.powerPreference || "high-performance",
    forceFallbackAdapter: Boolean(selection?.forceFallbackAdapter)
  };
}
