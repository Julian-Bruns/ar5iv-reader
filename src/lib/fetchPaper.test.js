import { describe, expect, it, vi } from "vitest";
import { buildArxivAbsUrl, buildArxivPdfUrl } from "./arxiv";
import {
  INITIAL_PDF_FALLBACK_STATE,
  PDF_FALLBACK_NOTICE,
  PDF_MATH_COPY_REASONS
} from "./pdfFallbackState";

vi.mock("./sanitizePaper", () => ({
  extractPaperMetadata: vi.fn(),
  normalizePaperTitle: vi.fn((titleHint, id) => titleHint || id)
}));

const { buildPdfFallbackPaper } = await import("./fetchPaper");

describe("buildPdfFallbackPaper", () => {
  it("returns the frozen PDF fallback paper shape", () => {
    expect(buildPdfFallbackPaper("1234.56789")).toEqual({
      id: "1234.56789",
      sourceUrl: buildArxivAbsUrl("1234.56789"),
      pdfUrl: buildArxivPdfUrl("1234.56789"),
      titleHint: "",
      view: "pdf",
      notice: PDF_FALLBACK_NOTICE,
      pdfState: {
        blobUrl: "",
        relay: "",
        loadStatus: "idle",
        mathCopyStatus: "pending",
        mathCopyReason: ""
      }
    });
  });

  it("creates a fresh pdfState object for each paper", () => {
    const first = buildPdfFallbackPaper("1234.56789");
    const second = buildPdfFallbackPaper("1234.56789");

    expect(first.pdfState).toEqual(INITIAL_PDF_FALLBACK_STATE);
    expect(first.pdfState).not.toBe(INITIAL_PDF_FALLBACK_STATE);
    expect(first.pdfState).not.toBe(second.pdfState);
  });

  it("keeps the allowed math-copy reason codes centralized", () => {
    expect(PDF_MATH_COPY_REASONS).toEqual([
      "",
      "insecure_context",
      "worker_unsupported",
      "gpu_unavailable",
      "device_memory_too_low",
      "hardware_concurrency_too_low",
      "storage_free_too_low",
      "models_load_failed",
      "benchmark_too_slow",
      "benchmark_failed",
      "worker_error",
      "pdf_not_ready",
      "no_formula_detected",
      "ocr_empty",
      "copy_failed"
    ]);
  });
});
