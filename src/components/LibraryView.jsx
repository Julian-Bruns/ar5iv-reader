import { useEffect, useState } from "preact/hooks";
import InstallButton from "./InstallButton";

export default function LibraryView({
  papers,
  loading,
  importing,
  receiveMessage,
  defaultInput,
  onClearInput,
  onSubmitUrl,
  onOpenPaper,
  onExportPaper,
  onDeletePaper,
  onExportLibrary,
  onImportFile
}) {
  const [inputValue, setInputValue] = useState(defaultInput || "");

  useEffect(() => {
    setInputValue(defaultInput || "");
  }, [defaultInput]);

  return (
    <div className="library-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">Offline-first ar5iv reading</p>
          <h1>ar5iv Reader</h1>
          <p className="hero-copy">
            Paste an arXiv URL, send one from a bookmarklet, or save papers for
            offline reading with figure blobs stored in IndexedDB.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={onExportLibrary}>
            Export Library IDs
          </button>
          <label className="ghost-button upload-button">
            {importing ? "Importing…" : "Import Library IDs"}
            <input
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  onImportFile(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
          <InstallButton />
        </div>
      </header>

      <section className="card form-card">
        <div className="section-heading">
          <h2>Open a Paper</h2>
          <p>
            Works with `arxiv.org`, `ar5iv`, PDF links, or a plain arXiv ID.
          </p>
        </div>

        {receiveMessage ? <p className="banner">{receiveMessage}</p> : null}

        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitUrl(inputValue);
          }}
        >
          <div className="input-shell">
            <input
              className="url-input"
              type="text"
              inputMode="url"
              placeholder="https://arxiv.org/abs/1706.03762"
              value={inputValue}
              onInput={(event) => setInputValue(event.currentTarget.value)}
            />
            {inputValue ? (
              <button
                className="input-clear"
                type="button"
                aria-label="Clear saved paper link"
                onClick={() => {
                  setInputValue("");
                  onClearInput();
                }}
              >
                x
              </button>
            ) : null}
          </div>
          <button className="primary-button" type="submit">
            Skim in Reader
          </button>
        </form>
      </section>

      <section className="card library-card">
        <div className="section-heading">
          <h2>Saved Library</h2>
          <p>Local papers render from IndexedDB even when the network is gone.</p>
        </div>

        {loading ? <p className="empty-state">Loading your library…</p> : null}
        {!loading && !papers.length ? (
          <p className="empty-state">
            No saved papers yet. Open one in skim mode and use Save to Library.
          </p>
        ) : null}

        <div className="paper-grid">
          {papers.map((paper) => (
            <article className="paper-card" key={paper.id}>
              <div>
                <p className="paper-id">{paper.id}</p>
                <h3>{paper.title}</h3>
                <p className="paper-meta">
                  Saved {new Date(paper.savedAt).toLocaleString()}
                </p>
                <p className="paper-meta">
                  {paper.assetUrls.length} cached figure
                  {paper.assetUrls.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="paper-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => onOpenPaper(paper.id)}
                >
                  Open Offline
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => onExportPaper(paper.id)}
                >
                  Export HTML
                </button>
                <button
                  className="ghost-button ghost-button--danger"
                  type="button"
                  onClick={() => onDeletePaper(paper.id)}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
