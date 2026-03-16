import { useEffect, useRef, useState } from "preact/hooks";
import * as pdfMathService from "../lib/pdfMathService";
import { getCachedPdfRender, putCachedPdfRender } from "../lib/pdfRenderCache";
import { loadPdfJs } from "./pdfJsClient";
import { canRunPdfMathCopy, getPdfSurfaceStatus } from "./pdfSurfaceStatus";

const LOW_QUALITY_MAX_SCALE = 1.25;
const HIGH_QUALITY_MAX_SCALE = 1.85;
const HIGH_QUALITY_DWELL_MS = 1000;
const HIGH_QUALITY_SCROLL_IDLE_MS = 240;
const PAGE_RENDER_ROOT_MARGIN = "480px 0px";
const PAGE_KEEPALIVE_MARGIN = 1;
const INITIAL_PRERENDER_PAGES = 2;
const HIGH_QUALITY_MEMORY_LIMIT = 16;
const FORMULA_CROP_SIZE = 600;

const EMPTY_PDF_STATE = Object.freeze({
  blobUrl: "",
  blob: null,
  pdfFingerprint: "",
  pdfByteLength: 0,
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
  const pdfDocumentRef = useRef(null);
  const renderedQualitiesRef = useRef(new Map());
  const pageShellsRef = useRef(new Map());
  const renderedCanvasesRef = useRef(new Map());
  const formulaBoxCacheRef = useRef(new Map());
  const formulaDetectionRequestsRef = useRef(new Map());
  const highQualityCacheRef = useRef(new Map());
  const visiblePagesRef = useRef(new Set());
  const ensurePageQualityRef = useRef(null);
  const [renderState, setRenderState] = useState({
    totalPages: 0,
    failed: false
  });
  const [interactionState, setInteractionState] = useState(null);
  const [serviceSnapshot, setServiceSnapshot] = useState(pdfMathService.status());

  useEffect(() => {
    onFirstPageRenderRef.current = onFirstPageRender;
  }, [onFirstPageRender]);

  useEffect(() => {
    onRenderFailureRef.current = onRenderFailure;
  }, [onRenderFailure]);

  useEffect(() => {
    return pdfMathService.subscribe((snapshot) => {
      setServiceSnapshot(snapshot);
    });
  }, []);

  useEffect(() => {
    firstPageNotifiedRef.current = false;
    setRenderState({
      totalPages: 0,
      failed: false
    });
    setInteractionState(null);
    formulaBoxCacheRef.current.clear();
    formulaDetectionRequestsRef.current.clear();
    clearHighQualityCache(highQualityCacheRef.current);
    renderedCanvasesRef.current.clear();
    renderedQualitiesRef.current.clear();
    pageShellsRef.current.clear();
    visiblePagesRef.current.clear();
    ensurePageQualityRef.current = null;
    pdfDocumentRef.current = null;

    if (pagesRef.current) {
      pagesRef.current.replaceChildren();
      pagesRef.current.style.cursor = "";
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
    let renderObserver = null;
    let activeRenderJob = null;
    const pageShells = new Map();
    const queuedQualities = new Map();
    const pendingQueue = [];
    const waiters = new Map();

    pageShellsRef.current = pageShells;

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

      rejectAllWaiters(waiters, error);
      onRenderFailureRef.current?.(error);
    };

    const clearHoverTimer = () => {
      if (!highQualityHoverTimerRef.current) {
        return;
      }

      window.clearTimeout(highQualityHoverTimerRef.current);
      highQualityHoverTimerRef.current = 0;
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

    const ensurePlaceholder = (pageShell) => {
      if (!(pageShell instanceof HTMLElement)) {
        return;
      }

      pageShell.dataset.rendered = "false";
      pageShell.dataset.renderQuality = "none";
      delete pageShell.dataset.renderedWidth;
      delete pageShell.dataset.renderedHeight;
      renderedCanvasesRef.current.delete(Number(pageShell.dataset.pageNumber || 0));
      clearFormulaOverlay(pageShell);

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
      renderedQualitiesRef.current.delete(pageNumber);
    };

    const pruneDistantPages = () => {
      if (!visiblePagesRef.current.size) {
        return;
      }

      const visiblePageNumbers = [...visiblePagesRef.current].sort((left, right) => left - right);
      const minVisible = visiblePageNumbers[0];
      const maxVisible = visiblePageNumbers[visiblePageNumbers.length - 1];
      const keepMin = Math.max(1, minVisible - PAGE_KEEPALIVE_MARGIN);
      const keepMax = maxVisible + PAGE_KEEPALIVE_MARGIN;

      for (const [pageNumber, quality] of renderedQualitiesRef.current) {
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

    const queueRender = (pageNumber, quality, { prioritize = false } = {}) => {
      const currentQuality = renderedQualitiesRef.current.get(pageNumber) || "none";
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

    const ensurePageQuality = (pageNumber, quality) =>
      new Promise((resolve, reject) => {
        const currentQuality = renderedQualitiesRef.current.get(pageNumber) || "none";
        if (getRenderQualityRank(currentQuality) >= getRenderQualityRank(quality)) {
          resolve(renderedCanvasesRef.current.get(pageNumber) || null);
          return;
        }

        const nextWaiters = waiters.get(pageNumber) || [];
        nextWaiters.push({
          quality,
          resolve,
          reject
        });
        waiters.set(pageNumber, nextWaiters);
        queueRender(pageNumber, quality, {
          prioritize: true
        });
      });

    ensurePageQualityRef.current = ensurePageQuality;

    const processNextRender = async () => {
      if (disposed || activeRenderJob || !pdfDocumentRef.current) {
        return;
      }

      const nextPageNumber = pendingQueue.shift();
      if (!nextPageNumber) {
        return;
      }

      const nextQuality = queuedQualities.get(nextPageNumber) || "low";
      queuedQualities.delete(nextPageNumber);

      const pageShell = pageShells.get(nextPageNumber);
      if (!pageShell) {
        void processNextRender();
        return;
      }

      const currentQuality = renderedQualitiesRef.current.get(nextPageNumber) || "none";
      if (getRenderQualityRank(currentQuality) >= getRenderQualityRank(nextQuality)) {
        resolveWaiters(waiters, nextPageNumber, currentQuality, renderedCanvasesRef.current.get(nextPageNumber));
        void processNextRender();
        return;
      }

      try {
        activeRenderJob = {
          pageNumber: nextPageNumber,
          quality: nextQuality
        };

        const restoredCanvas = await tryRestoreCachedCanvas({
          pageNumber: nextPageNumber,
          quality: nextQuality,
          pageShell,
          paper
        }, highQualityCacheRef.current);
        if (restoredCanvas) {
          handleRenderedCanvas(
            nextPageNumber,
            nextQuality,
            pageShell,
            restoredCanvas,
            paper,
            {
              waiters,
              renderedQualitiesRef,
              renderedCanvasesRef
            }
          );
          activeRenderJob = null;
          await nextAnimationFrame();
          void processNextRender();
          return;
        }

        const page = await pdfDocumentRef.current.getPage(nextPageNumber);
        const renderJob = {
          ...startPdfPageRender(page, pageShell, nextQuality),
          pageNumber: nextPageNumber
        };
        activeRenderJob = renderJob;
        await renderJob.task.promise;

        if (disposed || renderSequenceRef.current !== currentSequence) {
          return;
        }

        handleRenderedCanvas(
          nextPageNumber,
          nextQuality,
          pageShell,
          renderJob.canvas,
          paper,
          {
            waiters,
            renderedQualitiesRef,
            renderedCanvasesRef
          }
        );
        if (nextQuality === "high") {
          void rememberHighQualityCanvas(highQualityCacheRef.current, nextPageNumber, renderJob.canvas);
        } else {
          void persistLowQualityCanvas(paper, nextPageNumber, renderJob.canvas);
        }
        void maybeDetectFormulasForCanvas(nextPageNumber, renderJob.canvas, {
          force: nextQuality === "high"
        });

        if (nextPageNumber === 1 && !firstPageNotifiedRef.current) {
          firstPageNotifiedRef.current = true;
          onFirstPageRenderRef.current?.();
        }

        try {
          page.cleanup?.();
        } catch {
          // Best-effort pdf.js page cache cleanup.
        }
      } catch (error) {
        if (!disposed && renderSequenceRef.current === currentSequence) {
          ensurePlaceholder(pageShell);
          renderedQualitiesRef.current.delete(nextPageNumber);
          rejectWaiters(waiters, nextPageNumber, error);

          if (!isPdfRenderCancellation(error)) {
            failRender(error);
            return;
          }
        }
      } finally {
        activeRenderJob = null;
      }

      if (disposed || renderSequenceRef.current !== currentSequence) {
        return;
      }

      await nextAnimationFrame();
      void processNextRender();
    };

    const maybePromoteHoveredPage = () => {
      const trackedHoverPage = trackedHoverPageRef.current;
      if (!trackedHoverPage || !pdfDocumentRef.current || !visiblePagesRef.current.has(trackedHoverPage)) {
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

      const currentQuality = renderedQualitiesRef.current.get(trackedHoverPage) || "none";
      if (currentQuality === "high") {
        return;
      }

      if (currentQuality === "none") {
        queueRender(trackedHoverPage, "low", {
          prioritize: true
        });
        return;
      }

      queueRender(trackedHoverPage, "high", {
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
        pdfDocumentRef.current = await loadingTask.promise;

        if (disposed || renderSequenceRef.current !== currentSequence || !pagesRef.current) {
          return;
        }

        const firstPage = await pdfDocumentRef.current.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const pageAspectRatio =
          firstViewport?.width > 0 && firstViewport?.height > 0
            ? `${firstViewport.width} / ${firstViewport.height}`
            : "8.5 / 11";

        const nextShells = [];
        for (let pageNumber = 1; pageNumber <= pdfDocumentRef.current.numPages; pageNumber += 1) {
          const pageShell = createPdfPageShell(pageNumber, pageAspectRatio);
          pageShells.set(pageNumber, pageShell);
          nextShells.push(pageShell);
        }

        pagesRef.current.replaceChildren(...nextShells);
        setRenderState({
          totalPages: pdfDocumentRef.current.numPages,
          failed: false
        });

        renderObserver = createPageRenderObserver((pageNumber) => {
          visiblePagesRef.current.add(pageNumber);
          queueRender(pageNumber, "low");
          pruneDistantPages();
        }, (pageNumber) => {
          visiblePagesRef.current.delete(pageNumber);
          pruneDistantPages();
        });

        for (const pageShell of nextShells) {
          renderObserver?.observe(pageShell);
        }

        for (
          let pageNumber = 1;
          pageNumber <= Math.min(pdfDocumentRef.current.numPages, INITIAL_PRERENDER_PAGES);
          pageNumber += 1
        ) {
          queueRender(pageNumber, "low", {
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
      rejectAllWaiters(waiters, new Error("PDF surface disposed."));
      clearHighQualityCache(highQualityCacheRef.current);
      formulaDetectionRequestsRef.current.clear();
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
        pdfDocumentRef.current?.destroy?.();
      } catch {
        // Best-effort cleanup for cancelled pdf.js documents.
      }
      pdfDocumentRef.current = null;
    };
  }, [paper, pdfState.blobUrl]);

  useEffect(() => {
    if (serviceSnapshot.phase !== "ready" || !pagesRef.current) {
      return;
    }

    for (const [pageNumber, canvas] of renderedCanvasesRef.current) {
      void maybeDetectFormulasForCanvas(pageNumber, canvas, true);
    }
  }, [serviceSnapshot.phase, pdfState.blobUrl]);

  useEffect(() => {
    const viewport = pagesRef.current;
    if (!(viewport instanceof HTMLElement)) {
      return undefined;
    }

    const handlePointerUpdate = (event) => {
      const canvas =
        event.target instanceof Element ? event.target.closest("[data-pdf-page-canvas='true']") : null;
      const pageShell =
        event.target instanceof Element ? event.target.closest("[data-pdf-page='true']") : null;
      const nextPageNumber = Number(pageShell?.dataset?.pageNumber || 0);
      if (trackedHoverPageRef.current !== nextPageNumber) {
        trackedHoverPageRef.current = nextPageNumber;
        window.clearTimeout(highQualityHoverTimerRef.current);
        highQualityHoverTimerRef.current = 0;

        if (nextPageNumber) {
          highQualityHoverTimerRef.current = window.setTimeout(() => {
            highQualityHoverTimerRef.current = 0;
            triggerHighQualityHoverRef.current?.(nextPageNumber);
          }, HIGH_QUALITY_DWELL_MS);
        }
      }

      if (!(canvas instanceof HTMLCanvasElement) || !(pageShell instanceof HTMLElement)) {
        viewport.style.cursor = "";
        clearFormulaOverlay(pageShell);
        return;
      }

      const pageNumber = Number(canvas.dataset.pageNumber || 0);
      if (serviceSnapshot.phase === "ready" && !formulaBoxCacheRef.current.has(pageNumber)) {
        void maybeDetectFormulasForCanvas(pageNumber, canvas, false);
      }

      const bounds = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(bounds.width, 1);
      const scaleY = canvas.height / Math.max(bounds.height, 1);
      const point = {
        x: clamp((event.clientX - bounds.left) * scaleX, 0, canvas.width),
        y: clamp((event.clientY - bounds.top) * scaleY, 0, canvas.height)
      };
      const hitBounds = findHitBounds(formulaBoxCacheRef.current.get(pageNumber) || [], point);
      viewport.style.cursor = hitBounds ? "pointer" : "";
      canvas.style.cursor = hitBounds ? "pointer" : "";
      if (hitBounds) {
        drawFormulaOverlay(pageShell, canvas, hitBounds);
      } else {
        clearFormulaOverlay(pageShell);
      }
    };

    const handlePointerLeave = () => {
      trackedHoverPageRef.current = 0;
      window.clearTimeout(highQualityHoverTimerRef.current);
      highQualityHoverTimerRef.current = 0;
      viewport.style.cursor = "";
      for (const pageShell of pageShellsRef.current.values()) {
        clearFormulaOverlay(pageShell);
      }
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
      viewport.style.cursor = "";
    };
  }, [pdfState.blobUrl, serviceSnapshot.phase]);

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
  const installModalVisible =
    Boolean(interactionState?.activating) &&
    ["checking-install", "installing", "loading"].includes(serviceSnapshot.phase) &&
    (!serviceSnapshot.installed || Boolean(serviceSnapshot.progress?.oneTime));

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

      const pageNumber = Number(target.dataset.pageNumber || 0);
      const highQualityCanvas =
        (await ensurePageQualityRef.current?.(pageNumber, "high")) || target;
      const request = await createRecognitionRequest(highQualityCanvas, event);
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

      {installModalVisible ? (
        <div className="pdf-surface-modal-backdrop" role="presentation">
          <div className="card pdf-surface-modal" role="dialog" aria-modal="true" aria-label="PDF math setup">
            <p className="sync-label">Equation Copy Setup</p>
            <p className="pdf-surface-modal-copy">
              {serviceSnapshot.progress?.oneTime
                ? "Installing the layout detector and LaTeX OCR models. This is a one-time setup."
                : "Loading the equation copy models into memory."}
            </p>
            <div className="pdf-surface-progress">
              <div
                className="pdf-surface-progress-bar"
                style={{
                  width: `${getProgressPercent(serviceSnapshot.progress)}%`
                }}
              />
            </div>
            <p className="pdf-surface-progress-meta">
              {formatProgressText(serviceSnapshot.progress)}
            </p>
          </div>
        </div>
      ) : null}

      {renderState.totalPages ? (
        <p className="pdf-surface-meta">
          {renderState.totalPages} page{renderState.totalPages === 1 ? "" : "s"} available.
          More pages render as you scroll.
        </p>
      ) : null}
    </div>
  );

  async function maybeDetectFormulasForCanvas(pageNumber, canvas, force) {
    if (
      !(canvas instanceof HTMLCanvasElement) ||
      serviceSnapshot.phase !== "ready" ||
      !canRunPdfMathCopy({
        loadStatus: pdfState.loadStatus,
        mathCopyStatus: "ready"
      })
    ) {
      return;
    }

    const pending = formulaDetectionRequestsRef.current.get(pageNumber);
    if (pending && !force) {
      return pending;
    }

    const nextRequest = (async () => {
      const imageBitmap = await globalThis.createImageBitmap(canvas);
      const result = await pdfMathService.detectFormulaRegions({
        imageBitmap,
        cropRect: {
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height
        }
      });
      formulaBoxCacheRef.current.set(pageNumber, result.bounds || []);
      return result.bounds || [];
    })()
      .catch(() => [])
      .finally(() => {
        if (formulaDetectionRequestsRef.current.get(pageNumber) === nextRequest) {
          formulaDetectionRequestsRef.current.delete(pageNumber);
        }
      });

    formulaDetectionRequestsRef.current.set(pageNumber, nextRequest);
    return nextRequest;
  }
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
      : Math.max(1.0, Math.min(displayScale, LOW_QUALITY_MAX_SCALE));
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

async function tryRestoreCachedCanvas(renderRequest, highQualityCache) {
  if (renderRequest.quality === "high") {
    const cached = highQualityCache.get(renderRequest.pageNumber);
    if (!cached) {
      return null;
    }

    touchHighQualityEntry(highQualityCache, renderRequest.pageNumber);
    return cloneCanvasFromBitmap(cached.bitmap, renderRequest.pageShell, renderRequest.pageNumber, "high");
  }

  const pdfFingerprint = String(
    renderRequest.paper?.pdfState?.pdfFingerprint || renderRequest.paper?.pdfFingerprint || ""
  ).trim();
  if (!pdfFingerprint || typeof globalThis.createImageBitmap !== "function") {
    return null;
  }

  const cached = await getCachedPdfRender({
    pdfFingerprint,
    pageNumber: renderRequest.pageNumber,
    quality: "low"
  });
  if (!cached?.blob) {
    return null;
  }

  const bitmap = await globalThis.createImageBitmap(cached.blob);
  const canvas = cloneCanvasFromBitmap(bitmap, renderRequest.pageShell, renderRequest.pageNumber, "low");
  bitmap.close?.();
  return canvas;
}

function handleRenderedCanvas(
  pageNumber,
  quality,
  pageShell,
  canvas,
  paper,
  { waiters, renderedQualitiesRef, renderedCanvasesRef }
) {
  pageShell.replaceChildren(canvas);
  renderedQualitiesRef.current.set(pageNumber, quality);
  renderedCanvasesRef.current.set(pageNumber, canvas);
  pageShell.dataset.rendered = "true";
  pageShell.dataset.renderQuality = quality;
  pageShell.dataset.paperId = String(paper?.id || "");
  resolveWaiters(waiters, pageNumber, quality, canvas);
}

async function rememberHighQualityCanvas(cache, pageNumber, canvas) {
  if (typeof globalThis.createImageBitmap !== "function") {
    return;
  }

  const existing = cache.get(pageNumber);
  existing?.bitmap?.close?.();
  const bitmap = await globalThis.createImageBitmap(canvas);
  cache.set(pageNumber, {
    bitmap,
    updatedAt: Date.now()
  });
  touchHighQualityEntry(cache, pageNumber);

  while (cache.size > HIGH_QUALITY_MEMORY_LIMIT) {
    const oldestKey = cache.keys().next().value;
    const oldest = cache.get(oldestKey);
    oldest?.bitmap?.close?.();
    cache.delete(oldestKey);
  }
}

async function persistLowQualityCanvas(paper, pageNumber, canvas) {
  const pdfFingerprint = String(paper?.pdfState?.pdfFingerprint || paper?.pdfFingerprint || "").trim();
  if (!pdfFingerprint) {
    return;
  }

  const blob = await canvasToBlob(canvas);
  await putCachedPdfRender({
    paperId: paper?.id,
    pdfFingerprint,
    pageNumber,
    quality: "low",
    width: canvas.width,
    height: canvas.height,
    blob
  });
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
  const cropLeft = clamp(Math.round(clickPoint.x - FORMULA_CROP_SIZE / 2), 0, Math.max(0, canvas.width - 1));
  const cropTop = clamp(Math.round(clickPoint.y - FORMULA_CROP_SIZE / 2), 0, Math.max(0, canvas.height - 1));
  const cropWidth = Math.max(1, Math.min(FORMULA_CROP_SIZE, canvas.width - cropLeft));
  const cropHeight = Math.max(1, Math.min(FORMULA_CROP_SIZE, canvas.height - cropTop));
  const imageBitmap = await globalThis.createImageBitmap(
    canvas,
    cropLeft,
    cropTop,
    cropWidth,
    cropHeight
  );

  return {
    imageBitmap,
    clickPoint: {
      x: clickPoint.x - cropLeft,
      y: clickPoint.y - cropTop
    },
    cropRect: {
      x: cropLeft,
      y: cropTop,
      width: cropWidth,
      height: cropHeight
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

function findHitBounds(boundsList, point) {
  return boundsList.find((bounds) =>
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  ) || null;
}

function drawFormulaOverlay(pageShell, canvas, bounds) {
  if (!(pageShell instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  let overlay = pageShell.querySelector(".pdf-formula-overlay");
  if (!(overlay instanceof HTMLElement)) {
    overlay = document.createElement("div");
    overlay.className = "pdf-formula-overlay";
    pageShell.appendChild(overlay);
  }

  const scaleX = canvas.clientWidth / Math.max(canvas.width, 1);
  const scaleY = canvas.clientHeight / Math.max(canvas.height, 1);
  overlay.style.left = `${canvas.offsetLeft + bounds.x * scaleX}px`;
  overlay.style.top = `${canvas.offsetTop + bounds.y * scaleY}px`;
  overlay.style.width = `${Math.max(12, bounds.width * scaleX)}px`;
  overlay.style.height = `${Math.max(12, bounds.height * scaleY)}px`;
  overlay.hidden = false;
}

function clearFormulaOverlay(pageShell) {
  if (!(pageShell instanceof HTMLElement)) {
    return;
  }

  const overlay = pageShell.querySelector(".pdf-formula-overlay");
  if (overlay instanceof HTMLElement) {
    overlay.hidden = true;
  }
}

function resolveWaiters(waiters, pageNumber, quality, canvas) {
  const currentWaiters = waiters.get(pageNumber) || [];
  if (!currentWaiters.length) {
    return;
  }

  const remaining = [];
  for (const waiter of currentWaiters) {
    if (getRenderQualityRank(quality) >= getRenderQualityRank(waiter.quality)) {
      waiter.resolve(canvas);
    } else {
      remaining.push(waiter);
    }
  }

  if (remaining.length) {
    waiters.set(pageNumber, remaining);
  } else {
    waiters.delete(pageNumber);
  }
}

function rejectWaiters(waiters, pageNumber, error) {
  const currentWaiters = waiters.get(pageNumber) || [];
  for (const waiter of currentWaiters) {
    waiter.reject(error);
  }
  waiters.delete(pageNumber);
}

function rejectAllWaiters(waiters, error) {
  for (const [pageNumber] of waiters) {
    rejectWaiters(waiters, pageNumber, error);
  }
}

function cloneCanvasFromBitmap(bitmap, pageShell, pageNumber, quality) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false
  });
  if (!context) {
    throw new Error("Canvas rendering context unavailable.");
  }

  canvas.className = "pdf-page-canvas";
  canvas.dataset.pdfPageCanvas = "true";
  canvas.dataset.pageNumber = String(pageNumber);
  canvas.dataset.renderQuality = quality;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.dataset.renderedWidth = String(canvas.width);
  canvas.dataset.renderedHeight = String(canvas.height);
  canvas.setAttribute("aria-label", `PDF page ${pageNumber}`);
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  context.drawImage(bitmap, 0, 0);
  pageShell.dataset.renderedWidth = String(canvas.width);
  pageShell.dataset.renderedHeight = String(canvas.height);
  pageShell.dataset.renderQuality = quality;
  return canvas;
}

function touchHighQualityEntry(cache, pageNumber) {
  const entry = cache.get(pageNumber);
  if (!entry) {
    return;
  }

  cache.delete(pageNumber);
  cache.set(pageNumber, {
    ...entry,
    updatedAt: Date.now()
  });
}

function clearHighQualityCache(cache) {
  for (const entry of cache.values()) {
    entry.bitmap?.close?.();
  }
  cache.clear();
}

function getProgressPercent(progress) {
  if (!progress?.totalBytes) {
    return 8;
  }
  return clamp(Math.round((progress.loadedBytes / progress.totalBytes) * 100), 8, 100);
}

function formatProgressText(progress) {
  if (!progress) {
    return "Preparing…";
  }

  const loadedMb = (Number(progress.loadedBytes || 0) / (1024 * 1024)).toFixed(1);
  const totalMb = progress.totalBytes ? (Number(progress.totalBytes) / (1024 * 1024)).toFixed(1) : "?";
  const etaText =
    progress.etaMs == null
      ? "Calculating time remaining…"
      : progress.etaMs <= 0
        ? "Almost ready…"
        : `${Math.ceil(progress.etaMs / 1000)}s remaining`;
  return `${loadedMb} / ${totalMb} MB · ${etaText}`;
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Canvas blob conversion failed."));
    }, "image/webp", 0.86);
  });
}
