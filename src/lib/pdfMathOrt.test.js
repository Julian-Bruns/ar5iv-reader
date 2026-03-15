import { describe, expect, it } from "vitest";

import {
  configurePdfMathOrtRuntime,
  normalizePdfMathOrtWasmUrl,
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
});
