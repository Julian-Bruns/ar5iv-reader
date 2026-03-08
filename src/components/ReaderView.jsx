import { useEffect, useRef } from "preact/hooks";
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

  return (
    <div className="reader-shell">
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
