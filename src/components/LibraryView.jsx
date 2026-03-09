import { useEffect, useState } from "preact/hooks";
import InstallButton from "./InstallButton";
import BookmarkSetupPanel from "./BookmarkSetupPanel";
import SyncPanel from "./SyncPanel";

export default function LibraryView({
  papers,
  loading,
  importing,
  receiveMessage,
  defaultInput,
  deviceIdentity,
  pairedDevices,
  nearbyState,
  pairRouteInviteId,
  onCreateInvite,
  onCloseInvite,
  onJoinInvite,
  onCopyInviteLink,
  onRenameThisDevice,
  onRenamePeer,
  onForgetPeer,
  onSyncNow,
  onClearInput,
  onSubmitUrl,
  onOpenPaper,
  onExportPaper,
  onDeletePaper,
  onExportLibrary,
  onImportFile,
  formatPairSyncStatus
}) {
  const [inputValue, setInputValue] = useState(defaultInput || "");
  const [showBookmarkSetup, setShowBookmarkSetup] = useState(false);

  useEffect(() => {
    setInputValue(defaultInput || "");
  }, [defaultInput]);

  useEffect(() => {
    const handleInstalled = () => setShowBookmarkSetup(true);
    window.addEventListener("appinstalled", handleInstalled);
    return () => window.removeEventListener("appinstalled", handleInstalled);
  }, []);

  return (
    <div className="library-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">Offline-first ar5iv reading</p>
          <h1>ar5iv Reader</h1>
          <p className="hero-copy">
            Paste an arXiv URL, open from the bookmark flow, save papers for offline
            reading, and nearby-sync the same library when two paired devices are
            open on the same network.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={onExportLibrary}>
            Export Backup
          </button>
          <label className="ghost-button upload-button">
            {importing ? "Importing…" : "Import Backup"}
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
          <button
            className="ghost-button"
            type="button"
            onClick={() => setShowBookmarkSetup((value) => !value)}
          >
            {showBookmarkSetup ? "Hide Bookmark Setup" : "Bookmark Setup"}
          </button>
          <InstallButton />
        </div>
      </header>

      <BookmarkSetupPanel
        open={showBookmarkSetup}
        onClose={() => setShowBookmarkSetup(false)}
      />

      <SyncPanel
        deviceIdentity={deviceIdentity}
        pairedDevices={pairedDevices}
        nearbyState={nearbyState}
        pairRouteInviteId={pairRouteInviteId}
        onCreateInvite={onCreateInvite}
        onCloseInvite={onCloseInvite}
        onJoinInvite={onJoinInvite}
        onCopyInviteLink={onCopyInviteLink}
        onRenameThisDevice={onRenameThisDevice}
        onRenamePeer={onRenamePeer}
        onForgetPeer={onForgetPeer}
        onSyncNow={onSyncNow}
        formatPairSyncStatus={formatPairSyncStatus}
      />

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
          <p>Saved papers stay local for offline reading and can be pulled to paired devices.</p>
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
                  Updated {new Date(paper.updatedAt || paper.savedAt).toLocaleString()}
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
