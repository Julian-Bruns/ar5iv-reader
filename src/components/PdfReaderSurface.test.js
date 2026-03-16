import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PDF_SURFACE_STATUS_MESSAGES,
  canRunPdfMathCopy,
  getPdfSurfaceStatus
} from "./pdfSurfaceStatus";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const surfacePath = path.resolve(testDir, "./PdfReaderSurface.jsx");

describe("PdfReaderSurface status contract", () => {
  it("maps frozen paper state to the exact status copy", () => {
    expect(getPdfSurfaceStatus({ loadStatus: "loading" })).toEqual({
      tone: "pending",
      text: PDF_SURFACE_STATUS_MESSAGES.loading
    });
    expect(getPdfSurfaceStatus({ loadStatus: "error" })).toEqual({
      tone: "error",
      text: PDF_SURFACE_STATUS_MESSAGES.error
    });
    expect(
      getPdfSurfaceStatus({
        loadStatus: "ready",
        mathCopyStatus: "pending",
        mathCopyReason: ""
      })
    ).toEqual({
      tone: "pending",
      text: PDF_SURFACE_STATUS_MESSAGES.pending
    });
    expect(
      getPdfSurfaceStatus({
        loadStatus: "ready",
        mathCopyStatus: "ready",
        mathCopyReason: ""
      })
    ).toEqual({
      tone: "ready",
      text: PDF_SURFACE_STATUS_MESSAGES.ready
    });
    expect(
      getPdfSurfaceStatus({
        loadStatus: "ready",
        mathCopyStatus: "disabled",
        mathCopyReason: "models_load_failed"
      })
    ).toEqual({
      tone: "disabled",
      text: PDF_SURFACE_STATUS_MESSAGES.models_load_failed
    });
    expect(
      getPdfSurfaceStatus(
        {
          loadStatus: "ready",
          mathCopyStatus: "ready",
          mathCopyReason: ""
        },
        {
          loadStatus: "ready",
          mathCopyStatus: "running",
          mathCopyReason: ""
        }
      )
    ).toEqual({
      tone: "pending",
      text: PDF_SURFACE_STATUS_MESSAGES.running
    });
    expect(
      getPdfSurfaceStatus(
        {
          loadStatus: "ready",
          mathCopyStatus: "ready",
          mathCopyReason: ""
        },
        {
          loadStatus: "ready",
          mathCopyStatus: "error",
          mathCopyReason: "no_formula_detected"
        }
      )
    ).toEqual({
      tone: "error",
      text: PDF_SURFACE_STATUS_MESSAGES.no_formula_detected
    });
  });

  it("keeps detection gated behind the frozen ready states", () => {
    expect(
      canRunPdfMathCopy({
        loadStatus: "loading",
        mathCopyStatus: "ready"
      })
    ).toBe(false);
    expect(
      canRunPdfMathCopy({
        loadStatus: "ready",
        mathCopyStatus: "pending"
      })
    ).toBe(false);
    expect(
      canRunPdfMathCopy({
        loadStatus: "ready",
        mathCopyStatus: "ready"
      })
    ).toBe(true);
  });

  it.each([
    [
      "insecure_context",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.insecure_context
      }
    ],
    [
      "worker_unsupported",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.worker_unsupported
      }
    ],
    [
      "gpu_unavailable",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.gpu_unavailable
      }
    ],
    [
      "device_memory_too_low",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.device_memory_too_low
      }
    ],
    [
      "hardware_concurrency_too_low",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.hardware_concurrency_too_low
      }
    ],
    [
      "storage_free_too_low",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.storage_free_too_low
      }
    ],
    [
      "worker_error",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.worker_error
      }
    ],
    [
      "benchmark_too_slow",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.benchmark_too_slow
      }
    ],
    [
      "benchmark_failed",
      {
        tone: "disabled",
        text: PDF_SURFACE_STATUS_MESSAGES.benchmark_failed
      }
    ],
    [
      "ocr_empty",
      {
        tone: "error",
        text: PDF_SURFACE_STATUS_MESSAGES.ocr_empty
      }
    ]
  ])("renders %s as status-only copy", (mathCopyReason, expected) => {
    expect(
      getPdfSurfaceStatus({
        loadStatus: "ready",
        mathCopyStatus: expected.tone === "error" ? "error" : "disabled",
        mathCopyReason
      })
    ).toEqual(expected);
  });
});

describe("PdfReaderSurface callback and toast contract", () => {
  it("calls the first-page and render-failure callbacks in the component contract", () => {
    const source = fs.readFileSync(surfacePath, "utf8");

    expect(source).toMatch(/onFirstPageRender/);
    expect(source).toMatch(/onRenderFailure/);
    expect(source).toMatch(/onEnsureMathReady/);
    expect(source).toMatch(/onFirstPageRenderRef\.current = onFirstPageRender;/);
    expect(source).toMatch(/onRenderFailureRef\.current = onRenderFailure;/);
    expect(source).toMatch(/onFirstPageRenderRef\.current\?\.\(\);/);
    expect(source).toMatch(/onRenderFailureRef\.current\?\.\(error\);/);
    expect(source).toMatch(/const activationSnapshot = await onEnsureMathReady\?\.\(\);/);
  });

  it("limits toast traffic to interaction results", () => {
    const source = fs.readFileSync(surfacePath, "utf8");

    expect(source).toMatch(/onCopySuccess\?\.\("Copied!"\);/);
    expect(source).toMatch(/onCopyFailure\?\.\("Clipboard copy failed\."\);/);
    expect(source).not.toMatch(/onCopySuccess\?\.\("PDF math copy requires/);
    expect(source).not.toMatch(/onCopyFailure\?\.\("PDF math copy requires/);
    expect(source).not.toMatch(/onCopyFailure\?\.\("No formula was detected at that location\."\);/);
  });

  it("keeps capability failures in the status UI instead of adding banners", () => {
    const source = fs.readFileSync(surfacePath, "utf8");

    expect(source).toMatch(/className=\{`pdf-surface-status pdf-surface-status--\$\{status\.tone\}`\}/);
    expect(source).not.toMatch(/banner--error/);
    expect(source).not.toMatch(/banner--notice/);
  });

  it("shows an explicit preparing state only after activation starts", () => {
    expect(
      getPdfSurfaceStatus(
        {
          loadStatus: "ready",
          mathCopyStatus: "pending",
          mathCopyReason: ""
        },
        {
          loadStatus: "ready",
          mathCopyStatus: "pending",
          mathCopyReason: "",
          activating: true
        }
      )
    ).toEqual({
      tone: "pending",
      text: PDF_SURFACE_STATUS_MESSAGES.preparing
    });
  });

  it("tags rendered canvases with stable page metadata and full-page request bounds", () => {
    const source = fs.readFileSync(surfacePath, "utf8");

    expect(source).toMatch(/canvas\.dataset\.pageNumber = String\(page\.pageNumber\);/);
    expect(source).toMatch(/canvas\.dataset\.renderedWidth = String\(canvas\.width\);/);
    expect(source).toMatch(/canvas\.dataset\.renderedHeight = String\(canvas\.height\);/);
    expect(source).toMatch(/pageShell\.dataset\.pdfPage = "true";/);
    expect(source).toMatch(/pageShell\.dataset\.pageNumber = String\(page\.pageNumber\);/);
    expect(source).toMatch(/cropRect: \{[\s\S]*width: canvas\.width,[\s\S]*height: canvas\.height[\s\S]*\}/);
  });
});
