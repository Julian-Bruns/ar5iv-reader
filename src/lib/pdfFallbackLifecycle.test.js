import { describe, expect, it, vi } from "vitest";
import {
  createPrimedPdfFallbackPaper,
  getPdfMathStateFromServiceSnapshot,
  getSupersededPdfBlobUrls,
  reconcilePdfMathServiceTabs
} from "./pdfFallbackLifecycle";

describe("createPrimedPdfFallbackPaper", () => {
  it("sets the frozen loading state before preload work begins", () => {
    const paper = {
      id: "2401.01234",
      sourceUrl: "https://arxiv.org/abs/2401.01234",
      pdfUrl: "https://arxiv.org/pdf/2401.01234.pdf",
      titleHint: "Sample Paper",
      view: "pdf",
      notice: "Showing the PDF because this paper does not currently have a usable HTML view.",
      pdfState: {
        documentUrl: "",
        sourceMode: "",
        blobUrl: "",
        relay: "",
        loadStatus: "idle",
        mathCopyStatus: "pending",
        mathCopyReason: ""
      }
    };

    const primed = createPrimedPdfFallbackPaper(paper, {
      phase: "idle",
      enabled: false,
      reason: "",
      benchmarkMs: null,
      modelRevision: "breezedeus-pix2text-v1",
      refCount: 0
    });

    expect(primed.pdfState).toEqual({
      documentUrl: "https://arxiv.org/pdf/2401.01234.pdf",
      sourceMode: "remote-direct",
      blobUrl: "",
      relay: "",
      loadStatus: "loading",
      mathCopyStatus: "pending",
      mathCopyReason: ""
    });
  });

  it("preserves explicit blob-backed document settings", () => {
    const primed = createPrimedPdfFallbackPaper(
      {
        id: "saved:2401.01234",
        pdfUrl: "https://arxiv.org/pdf/2401.01234.pdf",
        view: "pdf",
        pdfState: {
          documentUrl: "blob:saved",
          sourceMode: "saved-blob",
          blobUrl: "blob:saved",
          relay: "saved",
          loadStatus: "idle",
          mathCopyStatus: "pending",
          mathCopyReason: ""
        }
      },
      {
        phase: "idle",
        enabled: false,
        reason: "",
        benchmarkMs: null,
        modelRevision: "breezedeus-pix2text-v1",
        refCount: 0
      }
    );

    expect(primed.pdfState).toEqual({
      documentUrl: "blob:saved",
      sourceMode: "saved-blob",
      blobUrl: "blob:saved",
      relay: "saved",
      loadStatus: "loading",
      mathCopyStatus: "pending",
      mathCopyReason: ""
    });
  });
});

describe("getPdfMathStateFromServiceSnapshot", () => {
  it("maps ready snapshots to the ready copy state", () => {
    expect(
      getPdfMathStateFromServiceSnapshot({
        phase: "ready",
        enabled: true,
        reason: "",
        benchmarkMs: 320,
        modelRevision: "breezedeus-pix2text-v1",
        refCount: 1
      })
    ).toEqual({
      mathCopyStatus: "ready",
      mathCopyReason: ""
    });
  });

  it("maps disabled and infrastructure-error snapshots to disabled UI state", () => {
    expect(
      getPdfMathStateFromServiceSnapshot({
        phase: "disabled",
        enabled: false,
        reason: "benchmark_too_slow",
        benchmarkMs: 5001,
        modelRevision: "breezedeus-pix2text-v1",
        refCount: 0
      })
    ).toEqual({
      mathCopyStatus: "disabled",
      mathCopyReason: "benchmark_too_slow"
    });

    expect(
      getPdfMathStateFromServiceSnapshot({
        phase: "error",
        enabled: false,
        reason: "models_load_failed",
        benchmarkMs: null,
        modelRevision: "breezedeus-pix2text-v1",
        refCount: 0
      })
    ).toEqual({
      mathCopyStatus: "disabled",
      mathCopyReason: "models_load_failed"
    });
  });
});

describe("getSupersededPdfBlobUrls", () => {
  it("returns blob URLs that were removed, replaced, or superseded", () => {
    const currentTabs = [
      {
        key: "paper:remove",
        paper: {
          view: "pdf",
          pdfState: {
            blobUrl: "blob:remove"
          }
        }
      },
      {
        key: "paper:supersede",
        paper: {
          view: "pdf",
          pdfState: {
            blobUrl: "blob:old"
          }
        }
      },
      {
        key: "paper:replace",
        paper: {
          view: "pdf",
          pdfState: {
            blobUrl: "blob:replace"
          }
        }
      },
      {
        key: "paper:keep",
        paper: {
          view: "pdf",
          pdfState: {
            blobUrl: "blob:keep"
          }
        }
      }
    ];
    const nextTabs = [
      {
        key: "paper:supersede",
        paper: {
          view: "pdf",
          pdfState: {
            blobUrl: "blob:new"
          }
        }
      },
      {
        key: "paper:replace",
        paper: {
          view: "html"
        }
      },
      {
        key: "paper:keep",
        paper: {
          view: "pdf",
          pdfState: {
            blobUrl: "blob:keep"
          }
        }
      }
    ];

    expect(getSupersededPdfBlobUrls(currentTabs, nextTabs)).toEqual([
      "blob:remove",
      "blob:old",
      "blob:replace"
    ]);
  });
});

describe("reconcilePdfMathServiceTabs", () => {
  it("releases the service when a previously-open PDF tab is no longer present", () => {
    const service = {
      status: vi.fn(() => ({
        phase: "ready",
        enabled: true,
        reason: "",
        benchmarkMs: 120,
        modelRevision: "breezedeus-pix2text-v1",
        refCount: 1
      })),
      acquire: vi.fn(),
      release: vi.fn()
    };
    const acquiredTabKeys = new Set(["paper:gone"]);

    reconcilePdfMathServiceTabs({
      tabs: [],
      acquiredTabKeys,
      service,
      onStatus: vi.fn()
    });

    expect(acquiredTabKeys.size).toBe(0);
    expect(service.release).toHaveBeenCalledTimes(1);
  });

  it("acquires newly-open PDF tabs and reports the resulting service status", async () => {
    const service = {
      status: vi.fn(() => ({
        phase: "checking",
        enabled: false,
        reason: "",
        benchmarkMs: null,
        modelRevision: "breezedeus-pix2text-v1",
        refCount: 0
      })),
      acquire: vi.fn(async () => ({
        phase: "error",
        enabled: false,
        reason: "models_load_failed",
        benchmarkMs: null,
        modelRevision: "breezedeus-pix2text-v1",
        refCount: 1
      })),
      release: vi.fn()
    };
    const onStatus = vi.fn();
    const acquiredTabKeys = new Set();

    reconcilePdfMathServiceTabs({
      tabs: [
        {
          key: "paper:2401.01234",
          paper: {
            view: "pdf",
            pdfState: {
              blobUrl: ""
            }
          }
        }
      ],
      acquiredTabKeys,
      service,
      onStatus
    });

    await Promise.resolve();

    expect(acquiredTabKeys).toEqual(new Set(["paper:2401.01234"]));
    expect(service.acquire).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenNthCalledWith(1, "paper:2401.01234", {
      phase: "checking",
      enabled: false,
      reason: "",
      benchmarkMs: null,
      modelRevision: "breezedeus-pix2text-v1",
      refCount: 0
    });
    expect(onStatus).toHaveBeenNthCalledWith(2, "paper:2401.01234", {
      phase: "error",
      enabled: false,
      reason: "models_load_failed",
      benchmarkMs: null,
      modelRevision: "breezedeus-pix2text-v1",
      refCount: 1
    });
  });
});
