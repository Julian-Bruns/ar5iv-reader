import { useEffect, useRef, useState } from "preact/hooks";
import * as pdfMathService from "../lib/pdfMathService";
import { loadPdfJs } from "./pdfJsClient";
import { canRunPdfMathCopy, getPdfSurfaceStatus } from "./pdfSurfaceStatus";

const EMPTY_PDF_STATE = Object.freeze({
  blobUrl: "",
  loadStatus: "idle",
  mathCopyStatus: "pending",
  mathCopyReason: ""
});

export default function PdfReaderSurface({
  paper,
  onFirstPageRender,
  onRenderFailure,
  onEnsureMathReady,
  onCopySuccess,
  onCopyFailure
}) {
  const pdfState = paper?.pdfState || EMPTY_PDF_STATE;
  const pagesRef = useRef(null);
  const renderSequenceRef = useRef(0);
  const firstPageNotifiedRef = useRef(false);
  const [renderState, setRenderState] = useState({
    pageCount: 0,
    failed: false
  });
  const [interactionState, setInteractionState] = useState(null);

  useEffect(() => {
    firstPageNotifiedRef.current = false;
    setRenderState({
      pageCount: 0,
      failed: false
    });
    setInteractionState(null);

    if (pagesRef.current) {
      pagesRef.current.replaceChildren();
    }
  }, [paper?.id, pdfState.blobUrl]);

  useEffect(() => {
    if (!interactionState) {
      return;
    }

    if (
      interactionState.mathCopyStatus !== "running" &&
      interactionState.mathCopyStatus !== pdfState.mathCopyStatus
    ) {
      setInteractionState(null);
      return;
    }

    if (interactionState.mathCopyReason !== pdfState.mathCopyReason) {
      setInteractionState(null);
    }
  }, [interactionState, pdfState.mathCopyReason, pdfState.mathCopyStatus]);

  useEffect(() => {
    if (!pagesRef.current || !pdfState.blobUrl) {
      return undefined;
    }

    const currentSequence = renderSequenceRef.current + 1;
    renderSequenceRef.current = currentSequence;
    let disposed = false;
    let loadingTask = null;
    let documentHandle = null;

    const failRender = (error) => {
      if (disposed || renderSequenceRef.current !== currentSequence) {
        return;
      }

      setRenderState((current) => ({
        ...current,
        failed: true
      }));

      if (pagesRef.current) {
        pagesRef.current.replaceChildren();
      }

      onRenderFailure?.(error);
    };

    const renderDocument = async () => {
      try {
        const pdfjs = await loadPdfJs();
        if (disposed || renderSequenceRef.current !== currentSequence) {
          return;
        }

        loadingTask = pdfjs.getDocument({
          // Dedicated pdf.js module workers were stalling without ever resolving the first page.
          url: pdfState.blobUrl,
          disableWorker: true
        });
        documentHandle = await loadingTask.promise;

        if (disposed || renderSequenceRef.current !== currentSequence || !pagesRef.current) {
          return;
        }

        pagesRef.current.replaceChildren();
        setRenderState({
          pageCount: documentHandle.numPages,
          failed: false
        });

        for (let pageNumber = 1; pageNumber <= documentHandle.numPages; pageNumber += 1) {
          const page = await documentHandle.getPage(pageNumber);
          if (disposed || renderSequenceRef.current !== currentSequence || !pagesRef.current) {
            return;
          }

          const pageNode = await renderPdfPage(page, pagesRef.current);
          if (disposed || renderSequenceRef.current !== currentSequence || !pagesRef.current) {
            return;
          }

          pagesRef.current.appendChild(pageNode);

          if (pageNumber === 1 && !firstPageNotifiedRef.current) {
            firstPageNotifiedRef.current = true;
            onFirstPageRender?.();
          }
        }
      } catch (error) {
        failRender(error);
      }
    };

    void renderDocument();

    return () => {
      disposed = true;
      try {
        loadingTask?.destroy?.();
      } catch {
        // Best-effort cleanup for cancelled pdf.js loading tasks.
      }
      try {
        documentHandle?.destroy?.();
      } catch {
        // Best-effort cleanup for cancelled pdf.js documents.
      }
    };
  }, [onFirstPageRender, onRenderFailure, pdfState.blobUrl]);

  const effectiveState = renderState.failed
    ? {
        loadStatus: "error",
        mathCopyStatus: pdfState.mathCopyStatus,
        mathCopyReason: pdfState.mathCopyReason
      }
    : pdfState;
  const status = getPdfSurfaceStatus(effectiveState, interactionState);
  const canRecognize = canRunPdfMathCopy(pdfState);
  const canInitializeMathCopy =
    pdfState.loadStatus === "ready" && pdfState.mathCopyStatus === "pending";
  const canInteract = canRecognize || canInitializeMathCopy;

  const handleSurfaceClick = async (event) => {
    const target =
      event.target instanceof Element ? event.target.closest("[data-pdf-page-canvas='true']") : null;
    if (!(target instanceof HTMLCanvasElement) || !canInteract) {
      return;
    }

    try {
      if (!canRecognize) {
        setInteractionState({
          loadStatus: pdfState.loadStatus,
          mathCopyStatus: "pending",
          mathCopyReason: "",
          activating: true
        });

        const activationSnapshot = await onEnsureMathReady?.();
        if (!activationSnapshot?.enabled || activationSnapshot?.phase !== "ready") {
          setInteractionState({
            loadStatus: pdfState.loadStatus,
            mathCopyStatus: "disabled",
            mathCopyReason: activationSnapshot?.reason || "worker_error"
          });
          return;
        }
      }

      setInteractionState({
        loadStatus: pdfState.loadStatus,
        mathCopyStatus: "running",
        mathCopyReason: ""
      });

      const request = await createRecognitionRequest(target, event);
      const result = await pdfMathService.detectAndRecognize(request);

      if (result?.status === "ok" && result.latex?.trim()) {
        await copyText(result.latex.trim());
        setInteractionState(null);
        onCopySuccess?.("Copied!");
        return;
      }

      setInteractionState({
        loadStatus: pdfState.loadStatus,
        mathCopyStatus: "error",
        mathCopyReason: result?.reason === "ocr_empty" ? "ocr_empty" : "no_formula_detected"
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        setInteractionState(null);
        return;
      }

      if (error?.stage === "clipboard") {
        setInteractionState(null);
        onCopyFailure?.("Clipboard copy failed.");
        return;
      }

      if (typeof error?.code === "string" && error.code) {
        setInteractionState({
          loadStatus: pdfState.loadStatus,
          mathCopyStatus:
            error.code === "no_formula_detected" || error.code === "ocr_empty"
              ? "error"
              : "disabled",
          mathCopyReason: error.code
        });
        return;
      }

      setInteractionState({
        loadStatus: pdfState.loadStatus,
        mathCopyStatus: "error",
        mathCopyReason: "ocr_empty"
      });
    }
  };

  return (
    <div className="pdf-surface-shell">
      <div className="pdf-surface-toolbar">
        <p className="pdf-surface-label">PDF fallback</p>
        <p
          className={`pdf-surface-status pdf-surface-status--${status.tone}`}
          aria-live="polite"
        >
          {status.text}
        </p>
      </div>

      {pdfState.blobUrl ? (
        <div
          ref={pagesRef}
          className={`pdf-surface-pages${canInteract ? " pdf-surface-pages--interactive" : ""}`}
          onClick={(event) => {
            void handleSurfaceClick(event);
          }}
          aria-label={paper?.title || paper?.id || "PDF fallback"}
          role="group"
        />
      ) : (
        <div className="pdf-surface-empty" aria-hidden="true" />
      )}

      {renderState.pageCount ? (
        <p className="pdf-surface-meta">
          {renderState.pageCount} page{renderState.pageCount === 1 ? "" : "s"} rendered.
        </p>
      ) : null}
    </div>
  );
}

async function renderPdfPage(page, container) {
  const baseViewport = page.getViewport({ scale: 1 });
  const maxWidth = Math.max(280, Math.min((container.clientWidth || 960) - 24, 960));
  const scale = Math.max(0.75, Math.min(2, maxWidth / baseViewport.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false
  });

  if (!context) {
    throw new Error("Canvas rendering context unavailable.");
  }

  canvas.className = "pdf-page-canvas";
  canvas.dataset.pdfPageCanvas = "true";
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.setAttribute("aria-label", `PDF page ${page.pageNumber}`);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const pageShell = document.createElement("section");
  pageShell.className = "pdf-page";
  pageShell.appendChild(canvas);

  await page.render({
    canvasContext: context,
    viewport
  }).promise;

  return pageShell;
}

async function createRecognitionRequest(canvas, event) {
  if (typeof globalThis.createImageBitmap !== "function") {
    const error = new Error("ImageBitmap is unavailable.");
    error.code = "worker_error";
    throw error;
  }

  const bounds = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(bounds.width, 1);
  const scaleY = canvas.height / Math.max(bounds.height, 1);
  const clickPoint = {
    x: clamp((event.clientX - bounds.left) * scaleX, 0, canvas.width),
    y: clamp((event.clientY - bounds.top) * scaleY, 0, canvas.height)
  };

  return {
    imageBitmap: await globalThis.createImageBitmap(canvas),
    clickPoint,
    cropRect: {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height
    }
  };
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  } catch (error) {
    error.stage = "clipboard";
    throw error;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
