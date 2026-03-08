import { useEffect, useRef, useState } from "preact/hooks";
import { installMathCopy } from "../lib/mathCopy";

export default function ReaderView({
  paper,
  busy,
  error,
  onBack,
  onSave,
  onExport,
  onDelete,
  showToast
}) {
  const articleRef = useRef(null);
  const showToastRef = useRef(showToast);
  const [showQuickActions, setShowQuickActions] = useState(false);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    if (!articleRef.current || !paper?.sanitizedHtml) {
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
          {paper?.mode === "session" ? (
            <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
              {busy ? "Saving…" : "Save to Library"}
            </button>
          ) : null}
        </div>
      </div>

      <header className="reader-topbar">
        <div>
          <button className="ghost-button" type="button" onClick={onBack}>
            Back to Library
          </button>
          <p className="reader-kicker">
            {paper?.mode === "saved" ? "Offline library copy" : "Skim mode"}
          </p>
          <h1>{paper?.title || "Loading paper…"}</h1>
          {paper?.relay ? <p className="reader-meta">Fetched via {paper.relay}</p> : null}
        </div>

        <div className="reader-actions">
          {paper?.mode === "session" ? (
            <button className="primary-button" type="button" onClick={onSave} disabled={busy}>
              {busy ? "Saving…" : "Save to Library"}
            </button>
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

      <section className="reader-frame">
        <div className="reader-surface">
          {paper?.sourceUrl ? (
            <p className="source-link">
              Source:{" "}
              <a href={paper.sourceUrl} target="_blank" rel="noreferrer">
                {paper.sourceUrl}
              </a>
            </p>
          ) : null}
          <article
            ref={articleRef}
            className="paper-body"
            dangerouslySetInnerHTML={{ __html: paper?.sanitizedHtml || "" }}
          />
        </div>
      </section>
    </div>
  );
}
