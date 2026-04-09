import { useEffect, useRef, useState } from "preact/hooks";
import { fetchPaperBibtex, primePaperBibtex } from "../lib/citation";
import { installMathCopy } from "../lib/mathCopy";
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
  onPdfFirstPageRender,
  onPdfRenderFailure,
  onPdfMathActivationRequest
}) {
  const articleRef = useRef(null);
  const showToastRef = useRef(showToast);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [copyBibtexBusy, setCopyBibtexBusy] = useState(false);
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
    setDismissedNotice(false);
    setShowActionMenu(false);
    setCopyBibtexBusy(false);
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
    </div>
  );
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
