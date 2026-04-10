import { useEffect, useRef, useState } from "preact/hooks";
import { fetchPaperBibtex, primePaperBibtex } from "../lib/citation";
import { installMathCopy } from "../lib/mathCopy";
import {
  createEmptyNoteAiState,
  NOTE_MATH_MODEL,
  NOTE_SPEECH_MODEL
} from "../lib/noteAiCommon";
import {
  getNoteAiCapabilities,
  interpretNoteMath,
  prefetchNoteAiRuntime,
  transcribeNoteSpeech
} from "../lib/noteAiService";
import { startNoteSpeechRecorder } from "../lib/noteSpeechRecorder";
import {
  buildTheoremCopyText,
  buildTheoremPayload,
  findTheoremFromTarget
} from "../lib/theoremNotes";
import PdfReaderSurface from "./PdfReaderSurface";

export default function ReaderView({
  tabs,
  activeTabKey,
  paper,
  busy,
  error,
  fallbackNoticeEnabled,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  onBack,
  onSave,
  onExport,
  onDelete,
  showToast,
  onCreateTheoremNote,
  onPdfFirstPageRender,
  onPdfRenderFailure,
  onPdfMathActivationRequest
}) {
  const articleRef = useRef(null);
  const showToastRef = useRef(showToast);
  const noteRecorderRef = useRef(null);
  const noteAiJobRef = useRef(0);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [copyBibtexBusy, setCopyBibtexBusy] = useState(false);
  const [theoremMenu, setTheoremMenu] = useState(null);
  const [noteComposer, setNoteComposer] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteAiState, setNoteAiState] = useState(() => createInitialNoteAiState());
  const [dragState, setDragState] = useState({ draggedKey: "", targetKey: "", placement: "before" });

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    const shell = articleRef.current;
    if (!shell || !paper?.sanitizedHtml || paper?.view !== "html") {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      prepareArticleForMobile(shell);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [paper?.id, paper?.sanitizedHtml, paper?.view]);

  useEffect(() => {
    if (!articleRef.current || !paper?.sanitizedHtml || paper?.view !== "html") {
      return undefined;
    }

    return installMathCopy(articleRef.current, (message) =>
      showToastRef.current(message)
    );
  }, [paper?.id, paper?.sanitizedHtml]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || !paper?.sanitizedHtml || paper?.view !== "html") {
      return undefined;
    }

    const handleContextMenu = (event) => {
      const theoremNode = findTheoremFromTarget(event.target);
      if (!theoremNode) {
        setTheoremMenu(null);
        return;
      }

      const payload = buildTheoremPayload(theoremNode, paper, window.location.href);
      if (!payload?.theoremTextWithoutProof) {
        return;
      }

      event.preventDefault();
      setTheoremMenu({
        x: event.clientX,
        y: event.clientY,
        payload
      });
    };

    article.addEventListener("contextmenu", handleContextMenu);
    return () => {
      article.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [paper, paper?.id, paper?.sanitizedHtml, paper?.view]);

  useEffect(() => {
    setDismissedNotice(false);
    setShowActionMenu(false);
    setCopyBibtexBusy(false);
    setTheoremMenu(null);
    setNoteComposer(null);
    setNoteDraft("");
    noteRecorderRef.current?.cancel?.();
    noteRecorderRef.current = null;
    noteAiJobRef.current += 1;
    setNoteAiState(createInitialNoteAiState());
  }, [paper?.id, paper?.notice, fallbackNoticeEnabled]);

  useEffect(() => {
    if (!paper?.id) {
      return;
    }

    void primePaperBibtex(paper.id);
  }, [paper?.id]);

  useEffect(() => {
    if (!showActionMenu) {
      return undefined;
    }

    const handleDocumentClick = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".reader-menu-shell")) {
        return;
      }

      setShowActionMenu(false);
    };

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [showActionMenu]);

  useEffect(() => {
    if (!theoremMenu) {
      return undefined;
    }

    const handleDocumentClick = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".theorem-menu-shell")) {
        return;
      }

      setTheoremMenu(null);
    };

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [theoremMenu]);

  useEffect(() => {
    if (!theoremMenu && !noteComposer) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      setTheoremMenu(null);
      setNoteComposer(null);
      setNoteDraft("");
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [theoremMenu, noteComposer]);

  useEffect(() => {
    if (!noteComposer) {
      return undefined;
    }

    setNoteAiState(createInitialNoteAiState());

    const cancelIdle = scheduleIdleTask(() => {
      void prefetchNoteAiRuntime().catch(() => {});
    });

    return () => {
      cancelIdle();
    };
  }, [noteComposer]);

  useEffect(() => {
    if (!tabs?.length) {
      setDragState({ draggedKey: "", targetKey: "", placement: "before" });
    }
  }, [tabs]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || !paper?.ar5ivUrl || paper?.view !== "html") {
      return undefined;
    }

    const handleDocumentLinkClick = (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) {
        return;
      }

      const targetHash = resolveSamePaperHash(link.getAttribute("href"), paper.ar5ivUrl);
      if (!targetHash) {
        return;
      }

      event.preventDefault();
      scrollToPaperTarget(article, targetHash, { updateHistory: true });
    };

    article.addEventListener("click", handleDocumentLinkClick);
    return () => {
      article.removeEventListener("click", handleDocumentLinkClick);
    };
  }, [paper?.ar5ivUrl, paper?.id, paper?.sanitizedHtml]);

  useEffect(() => {
    if (
      paper?.view !== "html" ||
      !paper?.sanitizedHtml ||
      !window.location.hash ||
      !articleRef.current
    ) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToPaperTarget(articleRef.current, window.location.hash, {
        updateHistory: false
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [paper?.id, paper?.sanitizedHtml]);

  async function handleCopyBibtex() {
    if (!paper?.id || copyBibtexBusy) {
      return;
    }

    setCopyBibtexBusy(true);

    try {
      const bibtex = await fetchPaperBibtex(paper.id);
      await copyText(bibtex);
      showToastRef.current("Copied BibTeX.");
    } catch (error) {
      console.error("BibTeX copy failed", error);
      showToastRef.current("BibTeX copy failed.");
    } finally {
      setCopyBibtexBusy(false);
    }
  }

  async function handleTheoremCopy(includeProof) {
    if (!theoremMenu?.payload) {
      return;
    }

    try {
      await copyText(buildTheoremCopyText(theoremMenu.payload, { includeProof }));
      showToastRef.current(includeProof ? "Copied theorem with proof." : "Copied theorem.");
      setTheoremMenu(null);
    } catch (error) {
      console.error("Theorem copy failed", error);
      showToastRef.current("Clipboard copy failed.");
    }
  }

  async function handleSaveTheoremNote() {
    if (
      !noteComposer?.payload ||
      !noteDraft.trim() ||
      noteAiState.transcribing ||
      noteAiState.interpreting
    ) {
      return;
    }

    const didSave = await onCreateTheoremNote?.(noteComposer.payload, noteDraft, {
      speechTranscript: noteAiState.transcript,
      mathLatex: noteAiState.mathLatex,
      speechModel: noteAiState.transcript ? NOTE_SPEECH_MODEL.id : "",
      mathModel: noteAiState.mathLatex ? NOTE_MATH_MODEL.id : "",
      aiGeneratedAt:
        noteAiState.transcript || noteAiState.mathLatex ? new Date().toISOString() : ""
    });
    if (!didSave) {
      return;
    }

    resetNoteComposer();
    showToastRef.current("Note saved.");
  }

  async function handleStartNoteDictation() {
    if (!noteAiState.supported || noteAiState.recording) {
      return;
    }

    try {
      noteRecorderRef.current = await startNoteSpeechRecorder();
      setNoteAiState((current) => ({
        ...current,
        recording: true,
        transcribing: false,
        interpreting: false,
        progressLabel: "Listening…",
        progressLoadedBytes: 0,
        progressTotalBytes: 0,
        transcript: "",
        mathLatex: "",
        error: ""
      }));
    } catch (error) {
      console.error("Note dictation could not start", error);
      setNoteAiState((current) => ({
        ...current,
        recording: false,
        progressLabel: "",
        error: stringifyNoteAiError(error, "Microphone access failed.")
      }));
      showToastRef.current("Microphone access failed.");
    }
  }

  async function handleStopNoteDictation() {
    const recorder = noteRecorderRef.current;
    if (!recorder) {
      return;
    }

    noteRecorderRef.current = null;
    const jobId = noteAiJobRef.current + 1;
    noteAiJobRef.current = jobId;
    setNoteAiState((current) => ({
      ...current,
      recording: false,
      transcribing: true,
      interpreting: false,
      progressLabel: "Transcribing speech…",
      progressLoadedBytes: 0,
      progressTotalBytes: NOTE_SPEECH_MODEL.totalBytes,
      transcript: "",
      mathLatex: "",
      error: ""
    }));

    try {
      const recording = await recorder.stop();
      const transcription = await transcribeNoteSpeech(recording, {
        onProgress(progress) {
          updateNoteAiProgress(jobId, setNoteAiState, progress);
        }
      });
      if (noteAiJobRef.current !== jobId) {
        return;
      }

      const transcript = String(transcription?.text || "").trim();
      if (transcript) {
        setNoteDraft((current) =>
          current.trim() ? `${current.trim()}\n\n${transcript}` : transcript
        );
      }
      setNoteAiState((current) => ({
        ...current,
        transcribing: false,
        interpreting: Boolean(transcript) && current.mathCapable,
        progressLabel: transcript
          ? current.mathCapable
            ? "Interpreting spoken math…"
            : "Speech transcription ready."
          : "",
        progressLoadedBytes: 0,
        progressTotalBytes: current.mathCapable ? NOTE_MATH_MODEL.totalBytes : 0,
        transcript,
        mathLatex: "",
        error: transcript ? "" : "No speech was detected."
      }));

      if (!transcript || !noteAiState.mathCapable) {
        return;
      }

      const interpretation = await interpretNoteMath(transcript, {
        onProgress(progress) {
          updateNoteAiProgress(jobId, setNoteAiState, progress);
        }
      });
      if (noteAiJobRef.current !== jobId) {
        return;
      }

      setNoteAiState((current) => ({
        ...current,
        interpreting: false,
        progressLabel: interpretation?.mathLatex ? "LaTeX ready." : "No spoken math detected.",
        progressLoadedBytes: interpretation?.mathLatex ? NOTE_MATH_MODEL.totalBytes : 0,
        progressTotalBytes: interpretation?.mathLatex ? NOTE_MATH_MODEL.totalBytes : 0,
        mathLatex: String(interpretation?.mathLatex || "").trim(),
        error: ""
      }));
    } catch (error) {
      if (noteAiJobRef.current !== jobId) {
        return;
      }

      console.error("Note dictation failed", error);
      setNoteAiState((current) => ({
        ...current,
        recording: false,
        transcribing: false,
        interpreting: false,
        progressLabel: "",
        progressLoadedBytes: 0,
        progressTotalBytes: 0,
        error: stringifyNoteAiError(error, "Speech transcription failed.")
      }));
      showToastRef.current("Speech transcription failed.");
    }
  }

  function resetNoteComposer() {
    noteRecorderRef.current?.cancel?.();
    noteRecorderRef.current = null;
    noteAiJobRef.current += 1;
    setNoteComposer(null);
    setNoteDraft("");
    setNoteAiState(createInitialNoteAiState());
  }

  return (
    <div className="reader-shell">
      {tabs?.length ? (
        <div className="reader-tabs-shell">
          <div className="reader-tabs" role="tablist" aria-label="Open papers">
            {tabs.map((tab) => {
              const isActive = tab.key === activeTabKey;
              const tabTitle = tab.title || tab.id || "Untitled paper";
              const showDropMarker =
                dragState.draggedKey &&
                dragState.draggedKey !== tab.key &&
                dragState.targetKey === tab.key;

              return (
                <div
                  className={`reader-tab${isActive ? " reader-tab--active" : ""}${
                    dragState.draggedKey === tab.key ? " reader-tab--dragging" : ""
                  }${
                    showDropMarker
                      ? dragState.placement === "after"
                        ? " reader-tab--drop-after"
                        : " reader-tab--drop-before"
                      : ""
                  }`}
                  key={tab.key}
                  draggable={tabs.length > 1}
                  aria-grabbed={dragState.draggedKey === tab.key}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", tab.key);
                    setDragState({
                      draggedKey: tab.key,
                      targetKey: "",
                      placement: "before"
                    });
                  }}
                  onDragOver={(event) => {
                    if (!dragState.draggedKey || dragState.draggedKey === tab.key) {
                      return;
                    }

                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const placement =
                      event.clientX - bounds.left > bounds.width / 2 ? "after" : "before";

                    setDragState((current) =>
                      current.targetKey === tab.key &&
                      current.placement === placement &&
                      current.draggedKey === dragState.draggedKey
                        ? current
                        : {
                            draggedKey: dragState.draggedKey,
                            targetKey: tab.key,
                            placement
                          }
                    );
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const draggedKey = dragState.draggedKey || event.dataTransfer.getData("text/plain");
                    if (draggedKey && draggedKey !== tab.key) {
                      onReorderTabs?.(draggedKey, tab.key, dragState.placement);
                    }
                    setDragState({ draggedKey: "", targetKey: "", placement: "before" });
                  }}
                  onDragEnd={() => {
                    setDragState({ draggedKey: "", targetKey: "", placement: "before" });
                  }}
                >
                  <button
                    className="reader-tab-button"
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    title={tabTitle}
                    onClick={() => onSelectTab(tab.key)}
                  >
                    <span
                      className={`reader-tab-indicator reader-tab-indicator--${tab.status || "idle"}`}
                      aria-hidden="true"
                    />
                    <span className="reader-tab-label">
                      {formatTabLabel(tabTitle, tabs.length)}
                    </span>
                  </button>
                  <button
                    className="reader-tab-close"
                    type="button"
                    aria-label={`Close ${tabTitle}`}
                    title={`Close ${tabTitle}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab(tab.key);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <header className={`reader-topbar${showActionMenu ? " reader-topbar--menu-open" : ""}`}>
        <div className="reader-context">
          <p className="reader-kicker">{getReaderStatusLabel(paper)}</p>
          <p className="reader-meta">
            {paper?.sourceUrl ? (
              <a className="reader-id-link" href={paper.sourceUrl} target="_blank" rel="noreferrer">
                {paper?.id || "Loading paper…"}
              </a>
            ) : paper?.id || "Loading paper…"}
            {paper?.view === "html" && paper?.relay ? (
              <span className="reader-meta-detail">Fetched via {paper.relay}</span>
            ) : null}
          </p>
        </div>

        <div className="reader-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Back to library"
            title="Back to library"
            onClick={onBack}
          >
            <BackIcon />
          </button>
          {paper?.id ? (
            <button
              className="ghost-button"
              type="button"
              onClick={() => void handleCopyBibtex()}
              disabled={copyBibtexBusy}
              aria-label="Copy BibTeX citation"
              title="Copy BibTeX citation"
            >
              {copyBibtexBusy ? "Copying…" : "Copy BibTeX"}
            </button>
          ) : null}
          {paper?.mode === "session" ? (
            <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
              {busy ? "Saving…" : "Save to Library"}
            </button>
          ) : null}
          {shouldShowActionMenu(paper) ? (
            <div className="reader-menu-shell">
              <button
                className="icon-button icon-button--menu"
                type="button"
                aria-label="More reader actions"
                aria-expanded={showActionMenu}
                aria-haspopup="menu"
                onClick={() => setShowActionMenu((value) => !value)}
              >
                <MoreIcon />
              </button>
              {showActionMenu ? (
                <div className="reader-menu" role="menu" aria-label="Reader actions">
                  {paper?.view === "pdf" && paper?.pdfUrl ? (
                    <a
                      href={paper.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                      onClick={() => setShowActionMenu(false)}
                    >
                      Open PDF
                    </a>
                  ) : null}
                  {paper?.mode === "saved" && paper?.view === "html" ? (
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setShowActionMenu(false);
                        onExport();
                      }}
                    >
                      Export HTML
                    </button>
                  ) : null}
                  {paper?.mode === "saved" ? (
                    <button
                      className="reader-menu-danger"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setShowActionMenu(false);
                        onDelete();
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {error ? <p className="banner banner--error">{error}</p> : null}
      {paper?.notice && fallbackNoticeEnabled && !dismissedNotice ? (
        <div className="banner banner--notice">
          <p>{paper.notice}</p>
          <div className="banner-actions">
            <button
              className="banner-icon"
              type="button"
              aria-label="Dismiss PDF fallback notice"
              onClick={() => {
                setDismissedNotice(true);
                setShowActionMenu(false);
              }}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      <section className={`reader-frame${paper?.view === "pdf" ? " reader-frame--pdf" : ""}`}>
        <div className={`reader-surface${paper?.view === "pdf" ? " reader-surface--pdf" : ""}`}>
          {paper?.view === "pdf" ? (
            <PdfReaderSurface
              paper={paper}
              onFirstPageRender={onPdfFirstPageRender}
              onRenderFailure={onPdfRenderFailure}
              onEnsureMathReady={onPdfMathActivationRequest}
              onCopySuccess={showToast}
              onCopyFailure={showToast}
            />
          ) : (
            <article
              ref={articleRef}
              className="paper-body"
              dangerouslySetInnerHTML={{ __html: paper?.sanitizedHtml || "" }}
            />
          )}
        </div>
      </section>

      {theoremMenu ? (
        <div
          className="theorem-menu-shell"
          style={{
            left: `${theoremMenu.x}px`,
            top: `${theoremMenu.y}px`
          }}
        >
          <div className="theorem-menu" role="menu" aria-label="Theorem actions">
            <button role="menuitem" type="button" onClick={() => void handleTheoremCopy(true)}>
              Copy with proof
            </button>
            <button role="menuitem" type="button" onClick={() => void handleTheoremCopy(false)}>
              Copy without proof
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setNoteComposer({ payload: theoremMenu.payload });
                setNoteDraft("");
                setNoteAiState(createInitialNoteAiState());
                setTheoremMenu(null);
              }}
            >
              Create note
            </button>
          </div>
        </div>
      ) : null}

      {noteComposer ? (
        <div className="note-modal-backdrop" role="presentation">
          <section className="card note-modal" role="dialog" aria-modal="true" aria-label="Create note">
            <div className="settings-modal-header">
              <div className="section-heading section-heading--compact">
                <h2>Create Note</h2>
                <p>{noteComposer.payload.referenceLabel || "Selected theorem"}</p>
              </div>
              <button
                className="icon-button icon-button--close"
                type="button"
                aria-label="Close note composer"
                onClick={resetNoteComposer}
              >
                ×
              </button>
            </div>

            <div className="note-modal-content">
              <p className="note-modal-theorem">{noteComposer.payload.theoremTextWithoutProof}</p>
              <div className="note-ai-toolbar">
                <button
                  className="ghost-button"
                  type="button"
                  disabled={!noteAiState.supported || noteAiState.transcribing || noteAiState.interpreting}
                  onClick={() =>
                    void (noteAiState.recording ? handleStopNoteDictation() : handleStartNoteDictation())
                  }
                >
                  {noteAiState.recording ? "Stop Dictation" : "Dictate with Whisper"}
                </button>
                {!noteAiState.supported ? (
                  <p className="note-ai-status">
                    Dictation needs HTTPS, microphone access, and worker support.
                  </p>
                ) : null}
                {noteAiState.supported && !noteAiState.mathCapable ? (
                  <p className="note-ai-status">
                    Speech transcription works here, but LaTeX interpretation needs WebGPU.
                  </p>
                ) : null}
                {noteAiState.progressLabel ? (
                  <p className="note-ai-status">{noteAiState.progressLabel}</p>
                ) : null}
                {noteAiState.error ? (
                  <p className="note-ai-status note-ai-status--error">{noteAiState.error}</p>
                ) : null}
              </div>
              <textarea
                className="note-modal-input"
                value={noteDraft}
                placeholder="Write your note here"
                onInput={(event) => setNoteDraft(event.currentTarget.value)}
              />
              {noteAiState.transcript ? (
                <div className="note-ai-preview">
                  <p className="sync-label">Transcript</p>
                  <p className="note-ai-preview-text">{noteAiState.transcript}</p>
                </div>
              ) : null}
              {noteAiState.mathLatex ? (
                <div className="note-ai-preview">
                  <p className="sync-label">LaTeX</p>
                  <pre className="note-ai-preview-code">
                    <code>{noteAiState.mathLatex}</code>
                  </pre>
                </div>
              ) : null}
              <div className="note-modal-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={resetNoteComposer}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    !noteDraft.trim() || noteAiState.transcribing || noteAiState.interpreting
                  }
                  onClick={() => void handleSaveTheoremNote()}
                >
                  {noteAiState.transcribing || noteAiState.interpreting ? "Working…" : "Save"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function createInitialNoteAiState() {
  const capabilities = getNoteAiCapabilities();
  return {
    ...createEmptyNoteAiState(),
    supported: capabilities.supported,
    mathCapable: capabilities.mathCapable,
    error: capabilities.supported ? "" : "Dictation is unavailable on this device."
  };
}

function updateNoteAiProgress(jobId, setNoteAiState, progress) {
  setNoteAiState((current) =>
    current.recording || current.transcribing || current.interpreting
      ? {
          ...current,
          progressLabel: String(progress?.label || current.progressLabel || "").trim(),
          progressLoadedBytes: Number(progress?.loadedBytes || current.progressLoadedBytes || 0),
          progressTotalBytes: Number(progress?.totalBytes || current.progressTotalBytes || 0)
        }
      : current
  );
  return jobId;
}

function stringifyNoteAiError(error, fallbackMessage) {
  const message = String(error?.message || "").trim();
  return message || fallbackMessage;
}

function scheduleIdleTask(callback) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback);
    return () => window.cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

async function copyText(text) {
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
}

function resolveSamePaperHash(href, paperUrl) {
  if (!href) {
    return "";
  }

  if (href.startsWith("#")) {
    return href;
  }

  try {
    const currentPaperUrl = new URL(paperUrl);
    const targetUrl = new URL(href, paperUrl);

    if (
      !targetUrl.hash ||
      targetUrl.origin !== currentPaperUrl.origin ||
      targetUrl.pathname !== currentPaperUrl.pathname ||
      targetUrl.search !== currentPaperUrl.search
    ) {
      return "";
    }

    return targetUrl.hash;
  } catch {
    return "";
  }
}

function scrollToPaperTarget(article, hash, { updateHistory }) {
  const normalizedHash = hash === "#" ? "" : hash;
  const fragment = normalizedHash.startsWith("#") ? normalizedHash.slice(1) : normalizedHash;
  const targetId = decodeURIComponent(fragment);

  if (updateHistory) {
    const nextUrl = `${window.location.pathname}${window.location.search}${normalizedHash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }

  if (!targetId) {
    window.scrollTo({ top: 0, behavior: "auto" });
    return;
  }

  const target = findPaperTarget(article, targetId);
  if (!target) {
    return;
  }

  target.scrollIntoView({ block: "start", inline: "nearest" });
}

function findPaperTarget(article, targetId) {
  const target = article.ownerDocument.getElementById(targetId);
  if (target && article.contains(target)) {
    return target;
  }

  for (const namedTarget of article.querySelectorAll("[name]")) {
    if (namedTarget.getAttribute("name") === targetId) {
      return namedTarget;
    }
  }

  return null;
}

function prepareArticleForMobile(shell) {
  const rootArticle = shell.querySelector(":scope > article");
  if (!rootArticle || rootArticle.dataset.chunked === "true") {
    return;
  }

  rootArticle.classList.add("paper-root");
  rootArticle.dataset.chunked = "true";

  const children = [...rootArticle.childNodes].filter((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return true;
    }

    return node.nodeType === Node.TEXT_NODE && node.textContent?.trim();
  });

  if (children.length < 8) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let chunk = createChunk(rootArticle.ownerDocument);
  let chunkSize = 0;

  for (const child of children) {
    if (shouldStartNewChunk(child, chunkSize, chunk.childNodes.length)) {
      fragment.appendChild(chunk);
      chunk = createChunk(rootArticle.ownerDocument);
      chunkSize = 0;
    }

    chunk.appendChild(child);
    if (child.nodeType === Node.ELEMENT_NODE) {
      chunkSize += 1;
    }
  }

  if (chunk.childNodes.length) {
    fragment.appendChild(chunk);
  }

  rootArticle.replaceChildren(fragment);
}

function createChunk(documentNode) {
  const element = documentNode.createElement("section");
  element.className = "paper-chunk";
  return element;
}

function shouldStartNewChunk(node, chunkSize, chunkChildren) {
  if (chunkChildren === 0) {
    return false;
  }

  if (!(node instanceof Element)) {
    return chunkSize >= 5;
  }

  if (
    node.matches(
      "section, h1, h2, h3, h4, .ltx_section, .ltx_bibliography, .ltx_appendix, .ltx_titlepage"
    )
  ) {
    return true;
  }

  return chunkSize >= 6 && node.matches("p, div, figure, table, ul, ol");
}

function formatTabLabel(title, tabCount) {
  const normalizedTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (!normalizedTitle) {
    return "Untitled";
  }

  const maxWords = tabCount >= 6 ? 3 : tabCount >= 4 ? 4 : 6;
  const maxLength = tabCount >= 6 ? 22 : tabCount >= 4 ? 30 : 44;
  const words = normalizedTitle.split(" ");
  const shortened = words.slice(0, maxWords).join(" ");

  if (shortened.length <= maxLength && words.length <= maxWords) {
    return shortened;
  }

  const clipped = shortened.slice(0, maxLength).trimEnd();
  return `${clipped}…`;
}

function getReaderStatusLabel(paper) {
  if (paper?.mode === "saved") {
    return "Saved Offline";
  }

  if (paper?.view === "pdf") {
    return "PDF Fallback";
  }

  return "Skim";
}

function shouldShowActionMenu(paper) {
  return Boolean((paper?.view === "pdf" && paper?.pdfUrl) || paper?.mode === "saved");
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}
