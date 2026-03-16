import { useEffect, useRef, useState } from "preact/hooks";
import * as pdfMathService from "../lib/pdfMathService";
import { loadPdfJs } from "./pdfJsClient";
import { canRunPdfMathCopy, getPdfSurfaceStatus } from "./pdfSurfaceStatus";

const LOW_QUALITY_RENDER_MULTIPLIER = 0.58;
const LOW_QUALITY_MAX_SCALE = 0.95;
const HIGH_QUALITY_MAX_SCALE = 1.75;
const HIGH_QUALITY_DWELL_MS = 1000;
const HIGH_QUALITY_SCROLL_IDLE_MS = 240;
const PAGE_RENDER_ROOT_MARGIN = "480px 0px";
const PAGE_KEEPALIVE_MARGIN = 1;
const INITIAL_PRERENDER_PAGES = 2;

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
  const onFirstPageRenderRef = useRef(onFirstPageRender);
  const onRenderFailureRef = useRef(onRenderFailure);
  const trackedHoverPageRef = useRef(0);
  const highQualityHoverTimerRef = useRef(0);
  const triggerHighQualityHoverRef = useRef(null);
  const lastScrollAtRef = useRef(0);
  const [renderState, setRenderState] = useState({
    totalPages: 0,
    failed: false
  });
  const [interactionState, setInteractionState] = useState(null);

  useEffect(() => {
    onFirstPageRenderRef.current = onFirstPageRender;
  }, [onFirstPageRender]);

  useEffect(() => {
    onRenderFailureRef.current = onRenderFailure;
  }, [onRenderFailure]);

  useEffect(() => {
    firstPageNotifiedRef.current = false;
    setRenderState({
      totalPages: 0,
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
    let renderObserver = null;
    let activeRenderJob = null;
    const pageShells = new Map();
    const renderedQualities = new Map();
    const queuedQualities = new Map();
    const pendingQueue = [];
    const visiblePages = new Set();

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

      onRenderFailureRef.current?.(error);
    };

    const clearHoverTimer = () => {
      if (!highQualityHoverTimerRef.current) {
        return;
      }

      window.clearTimeout(highQualityHoverTimerRef.current);
      highQualityHoverTimerRef.current = 0;
    };

    const ensurePlaceholder = (pageShell) => {
      if (!(pageShell instanceof HTMLElement)) {
        return;
      }

      pageShell.dataset.rendered = "false";
      pageShell.dataset.renderQuality = "none";
      delete pageShell.dataset.renderedWidth;
      delete pageShell.dataset.renderedHeight;

      if (pageShell.querySelector(".pdf-page-placeholder")) {
        return;
      }

      const aspectRatio = pageShell.dataset.aspectRatio || "8.5 / 11";
      const pageNumber = Number(pageShell.dataset.pageNumber || 0);
      const placeholder = document.createElement("div");
      placeholder.className = "pdf-page-placeholder";
      placeholder.style.aspectRatio = aspectRatio;
      placeholder.textContent = `Loading page ${pageNumber}…`;
      pageShell.replaceChildren(placeholder);
    };

    const getQueuedIndex = (pageNumber) =>
      pendingQueue.findIndex((queuedPageNumber) => queuedPageNumber === pageNumber);

    const removeQueuedRender = (pageNumber) => {
      queuedQualities.delete(pageNumber);
      const queuedIndex = getQueuedIndex(pageNumber);
      if (queuedIndex >= 0) {
        pendingQueue.splice(queuedIndex, 1);
      }
    };

    const resetPageShellToPlaceholder = (pageNumber) => {
      const pageShell = pageShells.get(pageNumber);
      if (!pageShell) {
        return;
      }

      if (activeRenderJob?.pageNumber === pageNumber) {
        return;
      }

      removeQueuedRender(pageNumber);
      ensurePlaceholder(pageShell);
      renderedQualities.delete(pageNumber);
    };

    const pruneDistantPages = () => {
      if (!visiblePages.size) {
        return;
      }

      const visiblePageNumbers = [...visiblePages].sort((left, right) => left - right);
      const minVisible = visiblePageNumbers[0];
      const maxVisible = visiblePageNumbers[visiblePageNumbers.length - 1];
      const keepMin = Math.max(1, minVisible - PAGE_KEEPALIVE_MARGIN);
      const keepMax = maxVisible + PAGE_KEEPALIVE_MARGIN;

      for (const [pageNumber, quality] of renderedQualities) {
        if (quality === "high" && pageNumber === trackedHoverPageRef.current) {
          continue;
        }

        if (activeRenderJob?.pageNumber === pageNumber) {
          continue;
        }

        if (pageNumber >= keepMin && pageNumber <= keepMax) {
          continue;
        }

        resetPageShellToPlaceholder(pageNumber);
      }
    };

    const enqueueRender = (pageNumber, quality, { prioritize = false } = {}) => {
      if (!Number.isFinite(pageNumber) || pageNumber < 1) {
        return;
      }

      const currentQuality = renderedQualities.get(pageNumber) || "none";
      if (getRenderQualityRank(currentQuality) >= getRenderQualityRank(quality)) {
        return;
      }

      const activeQuality =
        activeRenderJob?.pageNumber === pageNumber ? activeRenderJob.quality : "none";
      if (getRenderQualityRank(activeQuality) >= getRenderQualityRank(quality)) {
        return;
      }

      const queuedQuality = queuedQualities.get(pageNumber) || "none";
      if (getRenderQualityRank(queuedQuality) >= getRenderQualityRank(quality)) {
        const queuedIndex = getQueuedIndex(pageNumber);
        if (prioritize && queuedIndex > 0) {
          pendingQueue.splice(queuedIndex, 1);
          pendingQueue.unshift(pageNumber);
        }
        return;
      }

      queuedQualities.set(pageNumber, quality);
      const queuedIndex = getQueuedIndex(pageNumber);
      if (queuedIndex >= 0) {
        if (prioritize && queuedIndex > 0) {
          pendingQueue.splice(queuedIndex, 1);
          pendingQueue.unshift(pageNumber);
        }
      } else if (prioritize) {
        pendingQueue.unshift(pageNumber);
      } else {
        pendingQueue.push(pageNumber);
      }

      void processNextRender();
    };

    const processNextRender = async () => {
      if (disposed || activeRenderJob || !documentHandle) {
        return;
      }

      const nextPageNumber = pendingQueue.shift();
      if (!nextPageNumber) {
        return;
      }

      const nextQuality = queuedQualities.get(nextPageNumber) || "low";
      queuedQualities.delete(nextPageNumber);

      const pageShell = pageShells.get(nextPageNumber);
      const currentQuality = renderedQualities.get(nextPageNumber) || "none";
      if (!pageShell || getRenderQualityRank(currentQuality) >= getRenderQualityRank(nextQuality)) {
        void processNextRender();
        return;
      }

      let page = null;
      try {
        activeRenderJob = {
          pageNumber: nextPageNumber,
          quality: nextQuality,
          task: null,
          canvas: null
        };

        page = await documentHandle.getPage(nextPageNumber);
        if (disposed || renderSequenceRef.current !== currentSequence) {
          return;
        }

        const renderJob = {
          ...startPdfPageRender(page, pageShell, nextQuality),
          pageNumber: nextPageNumber
        };
        activeRenderJob = renderJob;
        await renderJob.task.promise;

        if (disposed || renderSequenceRef.current !== currentSequence) {
          return;
        }

        pageShell.replaceChildren(renderJob.canvas);
        renderedQualities.set(nextPageNumber, nextQuality);
        pageShell.dataset.rendered = "true";
        pageShell.dataset.renderQuality = nextQuality;
        pruneDistantPages();

        if (nextPageNumber === 1 && !firstPageNotifiedRef.current) {
          firstPageNotifiedRef.current = true;
          onFirstPageRenderRef.current?.();
        }
      } catch (error) {
        if (!disposed && renderSequenceRef.current === currentSequence) {
          ensurePlaceholder(pageShell);
          renderedQualities.delete(nextPageNumber);

          if (!isPdfRenderCancellation(error)) {
            failRender(error);
            return;
          }
        }
      } finally {
        activeRenderJob = null;
        try {
          page?.cleanup?.();
        } catch {
          // Best-effort pdf.js page cache cleanup.
        }
      }

      if (disposed || renderSequenceRef.current !== currentSequence) {
        return;
      }

      await nextAnimationFrame();
      void processNextRender();
    };

    const maybePromoteHoveredPage = () => {
      const trackedHoverPage = trackedHoverPageRef.current;
      if (!trackedHoverPage || !documentHandle || !visiblePages.has(trackedHoverPage)) {
        return;
      }

      if (activeRenderJob) {
        highQualityHoverTimerRef.current = window.setTimeout(() => {
          highQualityHoverTimerRef.current = 0;
          maybePromoteHoveredPage();
        }, HIGH_QUALITY_SCROLL_IDLE_MS);
        return;
      }

      if (Date.now() - lastScrollAtRef.current < HIGH_QUALITY_SCROLL_IDLE_MS) {
        highQualityHoverTimerRef.current = window.setTimeout(() => {
          highQualityHoverTimerRef.current = 0;
          maybePromoteHoveredPage();
        }, HIGH_QUALITY_SCROLL_IDLE_MS);
        return;
      }

      const currentQuality = renderedQualities.get(trackedHoverPage) || "none";
      if (currentQuality === "high") {
        return;
      }

      if (currentQuality === "none") {
        enqueueRender(trackedHoverPage, "low", {
          prioritize: true
        });
        return;
      }

      enqueueRender(trackedHoverPage, "high", {
        prioritize: true
      });
    };

    const renderDocument = async () => {
      try {
        const pdfjs = await loadPdfJs();
        if (disposed || renderSequenceRef.current !== currentSequence) {
          return;
        }

        loadingTask = pdfjs.getDocument({
          url: pdfState.blobUrl
        });
        documentHandle = await loadingTask.promise;

        if (disposed || renderSequenceRef.current !== currentSequence || !pagesRef.current) {
          return;
        }

        const firstPage = await documentHandle.getPage(1);
        if (disposed || renderSequenceRef.current !== currentSequence || !pagesRef.current) {
          return;
        }

        const firstViewport = firstPage.getViewport({ scale: 1 });
        const pageAspectRatio =
          firstViewport?.width > 0 && firstViewport?.height > 0
            ? `${firstViewport.width} / ${firstViewport.height}`
            : "8.5 / 11";

        const nextShells = [];
        for (let pageNumber = 1; pageNumber <= documentHandle.numPages; pageNumber += 1) {
          const pageShell = createPdfPageShell(pageNumber, pageAspectRatio);
          pageShells.set(pageNumber, pageShell);
          nextShells.push(pageShell);
        }

        pagesRef.current.replaceChildren(...nextShells);
        setRenderState({
          totalPages: documentHandle.numPages,
          failed: false
        });

        renderObserver = createPageRenderObserver((pageNumber) => {
          visiblePages.add(pageNumber);
          enqueueRender(pageNumber, "low");
          pruneDistantPages();
        }, (pageNumber) => {
          visiblePages.delete(pageNumber);
          pruneDistantPages();
        });

        for (const pageShell of nextShells) {
          renderObserver?.observe(pageShell);
        }

        for (
          let pageNumber = 1;
          pageNumber <= Math.min(documentHandle.numPages, INITIAL_PRERENDER_PAGES);
          pageNumber += 1
        ) {
          enqueueRender(pageNumber, "low", {
            prioritize: pageNumber === 1
          });
        }
        triggerHighQualityHoverRef.current = (pageNumber) => {
          trackedHoverPageRef.current = pageNumber;
          maybePromoteHoveredPage();
        };
      } catch (error) {
        failRender(error);
      }
    };

    void renderDocument();

    return () => {
      disposed = true;
      clearHoverTimer();
      triggerHighQualityHoverRef.current = null;
      renderObserver?.disconnect?.();
      try {
        loadingTask?.destroy?.();
      } catch {
        // Best-effort cleanup for cancelled pdf.js loading tasks.
      }
      try {
        activeRenderJob?.task?.cancel?.();
      } catch {
        // Best-effort cleanup for cancelled page renders.
      }
      try {
        documentHandle?.destroy?.();
      } catch {
        // Best-effort cleanup for cancelled pdf.js documents.
      }
    };
  }, [pdfState.blobUrl]);

  useEffect(() => {
    const viewport = pagesRef.current;
    if (!(viewport instanceof HTMLElement)) {
      return undefined;
    }

    const handlePointerUpdate = (event) => {
      const pageShell =
        event.target instanceof Element ? event.target.closest("[data-pdf-page='true']") : null;
      const nextPageNumber = Number(pageShell?.dataset?.pageNumber || 0);
      if (trackedHoverPageRef.current === nextPageNumber) {
        return;
      }

      trackedHoverPageRef.current = nextPageNumber;
      window.clearTimeout(highQualityHoverTimerRef.current);
      highQualityHoverTimerRef.current = 0;

      if (!nextPageNumber) {
        return;
      }

      highQualityHoverTimerRef.current = window.setTimeout(() => {
        highQualityHoverTimerRef.current = 0;
        triggerHighQualityHoverRef.current?.(nextPageNumber);
      }, HIGH_QUALITY_DWELL_MS);
    };

    const handlePointerLeave = () => {
      trackedHoverPageRef.current = 0;
      window.clearTimeout(highQualityHoverTimerRef.current);
      highQualityHoverTimerRef.current = 0;
    };

    const handleScroll = () => {
      lastScrollAtRef.current = Date.now();
    };

    viewport.addEventListener("pointermove", handlePointerUpdate);
    viewport.addEventListener("pointerleave", handlePointerLeave);
    viewport.addEventListener("scroll", handleScroll, {
      passive: true
    });
    window.addEventListener("scroll", handleScroll, {
      passive: true
    });

    return () => {
      viewport.removeEventListener("pointermove", handlePointerUpdate);
      viewport.removeEventListener("pointerleave", handlePointerLeave);
      viewport.removeEventListener("scroll", handleScroll);
      window.removeEventListener("scroll", handleScroll);
      window.clearTimeout(highQualityHoverTimerRef.current);
      highQualityHoverTimerRef.current = 0;
      trackedHoverPageRef.current = 0;
    };
  }, [pdfState.blobUrl]);

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

      {renderState.totalPages ? (
        <p className="pdf-surface-meta">
          {renderState.totalPages} page{renderState.totalPages === 1 ? "" : "s"} available.
          More pages render as you scroll.
        </p>
      ) : null}
    </div>
  );
}

function createPdfPageShell(pageNumber, aspectRatio) {
  const pageShell = document.createElement("section");
  pageShell.className = "pdf-page";
  pageShell.dataset.pdfPage = "true";
  pageShell.dataset.pageNumber = String(pageNumber);
  pageShell.dataset.aspectRatio = aspectRatio;
  pageShell.dataset.rendered = "false";
  pageShell.dataset.renderQuality = "none";

  const placeholder = document.createElement("div");
  placeholder.className = "pdf-page-placeholder";
  placeholder.style.aspectRatio = aspectRatio;
  placeholder.textContent = `Loading page ${pageNumber}…`;
  pageShell.appendChild(placeholder);

  return pageShell;
}

function startPdfPageRender(page, pageShell, quality = "low") {
  const baseViewport = page.getViewport({ scale: 1 });
  const maxWidth = Math.max(280, Math.min((pageShell.clientWidth || 960) - 24, 960));
  const displayScale = Math.max(0.75, Math.min(HIGH_QUALITY_MAX_SCALE, maxWidth / baseViewport.width));
  const targetDpr = Math.max(1, Math.min(globalThis.devicePixelRatio || 1, HIGH_QUALITY_MAX_SCALE));
  const renderScale =
    quality === "high"
      ? Math.max(displayScale, Math.min(displayScale * targetDpr, HIGH_QUALITY_MAX_SCALE))
      : Math.max(
          0.75,
          Math.min(displayScale * LOW_QUALITY_RENDER_MULTIPLIER, LOW_QUALITY_MAX_SCALE)
        );
  const renderViewport = page.getViewport({ scale: renderScale });
  const displayViewport = page.getViewport({ scale: displayScale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false
  });

  if (!context) {
    throw new Error("Canvas rendering context unavailable.");
  }

  canvas.className = "pdf-page-canvas";
  canvas.dataset.pdfPageCanvas = "true";
  canvas.dataset.pageNumber = String(page.pageNumber);
  canvas.dataset.renderQuality = quality;
  canvas.width = Math.ceil(renderViewport.width);
  canvas.height = Math.ceil(renderViewport.height);
  canvas.dataset.renderedWidth = String(canvas.width);
  canvas.dataset.renderedHeight = String(canvas.height);
  canvas.setAttribute("aria-label", `PDF page ${page.pageNumber}`);
  canvas.style.width = `${displayViewport.width}px`;
  canvas.style.height = `${displayViewport.height}px`;
  pageShell.dataset.renderedWidth = String(canvas.width);
  pageShell.dataset.renderedHeight = String(canvas.height);
  pageShell.dataset.renderQuality = quality;

  const task = page.render({
    canvasContext: context,
    viewport: renderViewport
  });

  return {
    canvas,
    quality,
    task
  };
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

function getRenderQualityRank(quality) {
  if (quality === "high") {
    return 2;
  }

  if (quality === "low") {
    return 1;
  }

  return 0;
}

function isPdfRenderCancellation(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    error?.name === "RenderingCancelledException" ||
    error?.name === "AbortError" ||
    error?.code === "RenderingCancelledException" ||
    message.includes("RenderingCancelledException") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  );
}

function createPageRenderObserver(onVisible, onHidden = null) {
  if (typeof IntersectionObserver !== "function") {
    return {
      observe(target) {
        onVisible(Number(target?.dataset?.pageNumber || 0));
      },
      disconnect() {}
    };
  }

  return new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const pageNumber = Number(entry.target?.dataset?.pageNumber || 0);
        if (!entry.isIntersecting) {
          onHidden?.(pageNumber);
          continue;
        }

        onVisible(pageNumber);
      }
    },
    {
      root: null,
      rootMargin: PAGE_RENDER_ROOT_MARGIN,
      threshold: 0.01
    }
  );
}

function nextAnimationFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
