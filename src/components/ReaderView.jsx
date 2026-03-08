import { useEffect, useRef, useState } from "preact/hooks";
import { installMathCopy } from "../lib/mathCopy";

export default function ReaderView({
  paper,
  busy,
  error,
  fallbackNoticeEnabled,
  onBack,
  onDisableFallbackNotice,
  onSave,
  onExport,
  onDelete,
  showToast
}) {
  const articleRef = useRef(null);
  const showToastRef = useRef(showToast);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const [showNoticeMenu, setShowNoticeMenu] = useState(false);

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
    setShowQuickActions(false);
  }, [paper?.id]);

  useEffect(() => {
    setDismissedNotice(false);
    setShowNoticeMenu(false);
  }, [paper?.id, paper?.notice, fallbackNoticeEnabled]);

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

  useEffect(() => {
    if (!paper) {
      return undefined;
    }

    let frame = 0;
    let lastY = window.scrollY;
    let upwardTravel = 0;
    let downwardTravel = 0;

    const setVisible = (nextVisible) => {
      setShowQuickActions((currentVisible) =>
        currentVisible === nextVisible ? currentVisible : nextVisible
      );
    };

    const updateQuickActions = () => {
      frame = 0;
      const nextY = window.scrollY;
      const delta = nextY - lastY;
      lastY = nextY;

      if (nextY <= 140) {
        upwardTravel = 0;
        downwardTravel = 0;
        setVisible(false);
        return;
      }

      if (Math.abs(delta) < 2) {
        return;
      }

      if (delta < 0) {
        upwardTravel += -delta;
        downwardTravel = 0;

        if (nextY > 240 && upwardTravel >= 88) {
          setVisible(true);
        }
        return;
      }

      downwardTravel += delta;
      upwardTravel = 0;

      if (downwardTravel >= 36) {
        setVisible(false);
      }
    };

    const onScroll = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(updateQuickActions);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    updateQuickActions();

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [paper?.id, paper?.mode]);

  return (
    <div className="reader-shell">
      <div
        className={`reader-quickbar${showQuickActions ? " reader-quickbar--visible" : ""}`}
      >
        <div className="reader-quickbar-inner">
          <button className="ghost-button" type="button" onClick={onBack}>
            Back to Library
          </button>
          {paper?.mode === "session" && paper?.view === "html" ? (
            <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
              {busy ? "Saving…" : "Save to Library"}
            </button>
          ) : null}
        </div>
      </div>

      <header className="reader-topbar">
        <div className="reader-context">
          <p className="reader-kicker">
            {paper?.mode === "saved"
              ? "Offline library copy"
              : paper?.view === "pdf"
                ? "PDF fallback"
                : "Skim mode"}
          </p>
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
          <button className="ghost-button" type="button" onClick={onBack}>
            Back to Library
          </button>
          {paper?.mode === "session" && paper?.view === "html" ? (
            <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
              {busy ? "Saving…" : "Save to Library"}
            </button>
          ) : null}
          {paper?.view === "pdf" && paper?.pdfUrl ? (
            <a className="ghost-button" href={paper.pdfUrl} target="_blank" rel="noreferrer">
              Open PDF
            </a>
          ) : null}
          {paper?.mode === "saved" ? (
            <>
              <button className="ghost-button" type="button" onClick={onExport}>
                Export HTML
              </button>
              <button
                className="ghost-button ghost-button--danger"
                type="button"
                onClick={onDelete}
              >
                Remove
              </button>
            </>
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
                setShowNoticeMenu(false);
              }}
            >
              ×
            </button>
            <div className="banner-menu-shell">
              <button
                className="banner-icon"
                type="button"
                aria-label="PDF fallback notice options"
                onClick={() => setShowNoticeMenu((value) => !value)}
              >
                ⋯
              </button>
              {showNoticeMenu ? (
                <div className="banner-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setDismissedNotice(true);
                      setShowNoticeMenu(false);
                      onDisableFallbackNotice();
                    }}
                  >
                    Don&apos;t show this again
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <section className="reader-frame">
        <div className="reader-surface">
          {paper?.view === "pdf" && paper?.pdfUrl ? (
            <iframe
              className="pdf-viewer"
              src={paper.pdfUrl}
              title={paper.title || paper.id || "PDF fallback"}
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
