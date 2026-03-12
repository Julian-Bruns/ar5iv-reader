import { useEffect, useState } from "preact/hooks";
import BookmarkSetupPanel from "./BookmarkSetupPanel";
import SyncPanel from "./SyncPanel";

export default function LibraryView({
  papers,
  loading,
  backupImporting,
  receiveMessage,
  defaultInput,
  backupState,
  showOpenFromArxivHelp,
  deviceIdentity,
  pairedDevices,
  nearbyState,
  pairRouteInviteId,
  onDismissOpenFromArxivHelp,
  onChooseBackupFile,
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
  onDownloadBackup,
  onRestoreBackup,
  formatPairSyncStatus
}) {
  const [inputValue, setInputValue] = useState(defaultInput || "");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [openPaperMenuId, setOpenPaperMenuId] = useState("");

  useEffect(() => {
    setInputValue(defaultInput || "");
  }, [defaultInput]);

  const normalizedQuery = libraryQuery.trim().toLowerCase();
  const filteredPapers = normalizedQuery
    ? papers.filter((paper) => {
        const haystack = `${paper.title} ${paper.id}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : papers;

  return (
    <div className="library-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Offline-first ar5iv reading</p>
          <h1>ar5iv Reader</h1>
        </div>
        <button
          className="ghost-button ghost-button--subtle"
          type="button"
          onClick={() => setToolsExpanded((value) => !value)}
        >
          {toolsExpanded ? "Hide Tools & Settings" : "Tools & Settings"}
        </button>
      </header>

      <section className="card form-card">
        <div className="section-heading">
          <h2>Open Paper</h2>
          <p>Accepts an arXiv URL, ar5iv URL, PDF URL, or plain arXiv ID.</p>
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
                aria-label="Clear paper link"
                onClick={() => {
                  setInputValue("");
                  onClearInput();
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          <button className="primary-button" type="submit">
            Open
          </button>
        </form>
      </section>

      {showOpenFromArxivHelp ? (
        <BookmarkSetupPanel
          inline
          onDismiss={onDismissOpenFromArxivHelp}
        />
      ) : null}

      <section className="card library-card">
        <div className="section-heading">
          <h2>Saved Library</h2>
          <p>Search by title or arXiv ID. Newest updates stay at the top.</p>
        </div>

        <div className="library-toolbar">
          <div className="input-shell">
            <input
              className="url-input"
              type="search"
              placeholder="Search saved papers"
              value={libraryQuery}
              onInput={(event) => setLibraryQuery(event.currentTarget.value)}
            />
          </div>
        </div>

        {loading ? <p className="empty-state">Loading your library…</p> : null}
        {!loading && !papers.length ? (
          <p className="empty-state">
            No saved papers yet. Open one in skim mode and use Save to Library.
          </p>
        ) : null}
        {!loading && papers.length && !filteredPapers.length ? (
          <p className="empty-state">No saved papers match that search.</p>
        ) : null}

        <div className="paper-list">
          {filteredPapers.map((paper) => (
            <article className="paper-row" key={paper.id}>
              <div className="paper-row-copy">
                <h3>{paper.title}</h3>
                <p className="paper-id">{paper.id}</p>
                <p className="paper-meta">
                  Updated {new Date(paper.updatedAt || paper.savedAt).toLocaleString()}
                </p>
              </div>
              <div className="paper-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => onOpenPaper(paper.id)}
                >
                  Open
                </button>
                <div className="paper-menu-shell">
                  <button
                    className="ghost-button"
                    type="button"
                    aria-label={`More actions for ${paper.title}`}
                    onClick={() =>
                      setOpenPaperMenuId((current) => (current === paper.id ? "" : paper.id))
                    }
                  >
                    More
                  </button>
                  {openPaperMenuId === paper.id ? (
                    <div className="paper-menu">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenPaperMenuId("");
                          onExportPaper(paper.id);
                        }}
                      >
                        Export HTML
                      </button>
                      <button
                        className="paper-menu-danger"
                        type="button"
                        onClick={() => {
                          setOpenPaperMenuId("");
                          onDeletePaper(paper.id);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card tools-card">
        <div className="setup-header">
          <div className="section-heading">
            <h2>Tools &amp; Settings</h2>
            <p>Backup, nearby sync, and opening from arXiv live here.</p>
          </div>
          <button
            className="ghost-button ghost-button--subtle"
            type="button"
            onClick={() => setToolsExpanded((value) => !value)}
          >
            {toolsExpanded ? "Collapse" : "Expand"}
          </button>
        </div>

        {toolsExpanded ? (
          <div className="tools-stack">
            <section className="tools-subsection">
              <div className="section-heading section-heading--compact">
                <h2>Backup</h2>
                <p>Download one backup file now, or keep one selected file updated here.</p>
              </div>
              <div className="setup-actions">
                <button className="primary-button" type="button" onClick={onDownloadBackup}>
                  Download Backup
                </button>
                <label className="ghost-button upload-button">
                  {backupImporting ? "Restoring…" : "Restore Backup"}
                  <input
                    type="file"
                    accept="application/json"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) {
                        onRestoreBackup(file);
                      }
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {backupState.supported ? (
                  <button className="ghost-button" type="button" onClick={onChooseBackupFile}>
                    {backupState.enabled ? "Update Backup File" : "Keep Backup File Updated"}
                  </button>
                ) : null}
              </div>
              <p className="status-line">{formatBackupStatus(backupState, papers)}</p>
              {backupState.enabled && backupState.lastWrittenAt ? (
                <p className="paper-meta">
                  {backupState.filename || "Selected backup file"} updated{" "}
                  {new Date(backupState.lastWrittenAt).toLocaleString()}
                </p>
              ) : null}
              {!backupState.supported ? (
                <p className="paper-meta">
                  Automatic backup file updates are not available in this browser.
                </p>
              ) : null}
            </section>

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

            <BookmarkSetupPanel />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function formatBackupStatus(backupState, papers) {
  if (!backupState?.supported) {
    return "No automatic backup file selected.";
  }

  if (!backupState.enabled) {
    return "No automatic backup file selected.";
  }

  const mirroredIds = new Set(
    Array.isArray(backupState.lastMirroredPaperIds) ? backupState.lastMirroredPaperIds : []
  );
  const includedCount = papers.filter((paper) => mirroredIds.has(paper.id)).length;
  return `${includedCount} of ${papers.length} papers included in backup.`;
}
