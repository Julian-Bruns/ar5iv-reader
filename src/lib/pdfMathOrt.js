const DEFAULT_PDF_MATH_ORT_WASM_URL =
  "https://pub-204df3f8d4a445cdbda23b55ffae9214.r2.dev/vendor/onnxruntime-web/1.24.3/ort-wasm-simd-threaded.asyncify.wasm";

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
