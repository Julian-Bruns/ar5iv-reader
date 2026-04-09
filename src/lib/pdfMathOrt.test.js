import { describe, expect, it } from "vitest";

import {
  applyPdfMathOrtWebGpuSelection,
  configurePdfMathOrtRuntime,
  normalizePdfMathOrtWasmUrl,
  probePdfMathWebGpu,
  resolvePdfMathOrtWasmUrl
} from "./pdfMathOrt";

describe("pdfMathOrt", () => {
  it("accepts absolute http and https URLs", () => {
    expect(normalizePdfMathOrtWasmUrl("https://assets.example.com/ort.wasm")).toBe(
      "https://assets.example.com/ort.wasm"
    );
    expect(normalizePdfMathOrtWasmUrl(" http://localhost:8787/ort.wasm ")).toBe(
      "http://localhost:8787/ort.wasm"
    );
  });

  it("rejects non-absolute or unsupported URLs", () => {
    expect(normalizePdfMathOrtWasmUrl("")).toBe("");
    expect(normalizePdfMathOrtWasmUrl("/ort.wasm")).toBe("");
    expect(normalizePdfMathOrtWasmUrl("ftp://example.com/ort.wasm")).toBe("");
  });

  it("prefers an explicit URL when resolving the runtime override", () => {
    expect(resolvePdfMathOrtWasmUrl("https://assets.example.com/ort.wasm")).toBe(
      "https://assets.example.com/ort.wasm"
    );
  });

  it("applies the wasm override without clobbering an existing mjs override", () => {
    const ortNamespace = {
      env: {
        wasm: {
          wasmPaths: {
            mjs: "https://assets.example.com/ort.mjs"
          }
        }
      }
    };

    expect(
      configurePdfMathOrtRuntime(ortNamespace, "https://assets.example.com/ort.wasm")
    ).toBe("https://assets.example.com/ort.wasm");
    expect(ortNamespace.env.wasm.wasmPaths).toEqual({
      mjs: "https://assets.example.com/ort.mjs",
      wasm: "https://assets.example.com/ort.wasm"
    });
  });

  it("leaves the runtime untouched when no valid override is configured", () => {
    const ortNamespace = {
      env: {
        wasm: {}
      }
    };

    expect(configurePdfMathOrtRuntime(ortNamespace, "")).toBe("");
    expect(ortNamespace.env.wasm).toEqual({});
  });

  it("probes WebGPU with a high-performance adapter first and requests a device", async () => {
    const fakeDevice = {
      label: "selected-device"
    };
    const fakeAdapter = {
      requestDevice: async () => fakeDevice
    };
    const navigatorObject = {
      gpu: {
        requestAdapter: async (options) =>
          options?.powerPreference === "high-performance" ? fakeAdapter : null
      }
    };

    await expect(probePdfMathWebGpu({ navigatorObject })).resolves.toEqual({
      enabled: true,
      reason: "",
      adapter: fakeAdapter,
      device: fakeDevice,
      powerPreference: "high-performance",
      forceFallbackAdapter: false
    });
  });

  it("applies the selected WebGPU device to the ORT environment", () => {
    const selection = {
      adapter: {
        requestDevice() {}
      },
      device: {
        label: "selected-device"
      },
      powerPreference: "high-performance",
      forceFallbackAdapter: false
    };
    const ortNamespace = {
      env: {
        wasm: {},
        webgpu: {}
      }
    };

    expect(applyPdfMathOrtWebGpuSelection(ortNamespace, selection)).toBe(selection);
    expect(ortNamespace.env.webgpu).toEqual({
      adapter: selection.adapter,
      device: selection.device,
      powerPreference: "high-performance",
      forceFallbackAdapter: false
    });
  });
});
