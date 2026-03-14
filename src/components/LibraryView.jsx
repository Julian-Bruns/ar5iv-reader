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
  deviceIdentity,
  pairedDevices,
  nearbyState,
  pairRouteInviteId,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sortDirection, setSortDirection] = useState("desc");
  const [openPaperMenuId, setOpenPaperMenuId] = useState("");

  useEffect(() => {
    setInputValue(defaultInput || "");
  }, [defaultInput]);

  useEffect(() => {
    if (!openPaperMenuId) {
      return undefined;
    }

    const handleDocumentClick = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".paper-menu-shell")) {
        return;
      }

      setOpenPaperMenuId("");
    };

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, [openPaperMenuId]);

  const normalizedQuery = libraryQuery.trim().toLowerCase();
  const sortedPapers = [...papers].sort((left, right) => {
    const leftTime = Number(left.updatedAt || left.savedAt || 0);
    const rightTime = Number(right.updatedAt || right.savedAt || 0);
    return sortDirection === "desc" ? rightTime - leftTime : leftTime - rightTime;
  });

  const filteredPapers = normalizedQuery
    ? sortedPapers.filter((paper) => {
        const haystack = `${paper.title} ${paper.id}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : sortedPapers;

  const sortButtonLabel = sortDirection === "desc" ? "Sort by newest first" : "Sort by oldest first";

  return (
    <>
      <div className="library-shell">
        <header className="dashboard-header">
          <div>
            <p className="dashboard-subtext">copying math formulas has never been easier</p>
            <h1>ar5iv Reader</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </button>
        </header>

        <section className="card form-card">
          <div className="section-heading">
            <h2>Open Paper</h2>
            <p>Paste an arXiv URL, or use the bookmarklet found in settings.</p>
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

        <section className="card library-card">
          <div className="library-heading">
            <div className="section-heading section-heading--compact">
              <h2>Saved Library</h2>
              <p>Search by title or arXiv ID.</p>
            </div>
            <button
              className="sort-button"
              type="button"
              aria-label={sortButtonLabel}
              title={sortButtonLabel}
              onClick={() =>
                setSortDirection((current) => (current === "desc" ? "asc" : "desc"))
              }
            >
              {sortDirection === "desc" ? <ArrowDownIcon /> : <ArrowUpIcon />}
            </button>
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
              <article
                className={`paper-row${openPaperMenuId === paper.id ? " paper-row--menu-open" : ""}`}
                key={paper.id}
              >
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
                      className="icon-button icon-button--menu"
                      type="button"
                      aria-label={`More actions for ${paper.title}`}
                      aria-expanded={openPaperMenuId === paper.id}
                      aria-haspopup="menu"
                      onClick={() =>
                        setOpenPaperMenuId((current) => (current === paper.id ? "" : paper.id))
                      }
                    >
                      <MoreIcon />
                    </button>
                    {openPaperMenuId === paper.id ? (
                      <div className="paper-menu" role="menu" aria-label={`Actions for ${paper.title}`}>
                        <button
                          role="menuitem"
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
                          role="menuitem"
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
      </div>

      {settingsOpen ? (
        <div className="settings-modal-backdrop" role="presentation">
          <section
            className="card settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
          >
            <div className="settings-modal-header">
              <div className="section-heading section-heading--compact">
                <h2>Settings</h2>
                <p>Backup, nearby sync, and the bookmarklet live here.</p>
              </div>
              <button
                className="icon-button icon-button--close"
                type="button"
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="settings-modal-scroll">
              <div className="settings-stack">
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
            </div>
          </section>
        </div>
      ) : null}
    </>
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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.22-1.13.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zm-7.14 2.56A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
      />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 19a1 1 0 0 1-.71-.29l-5-5a1 1 0 1 1 1.42-1.42L11 15.59V5a1 1 0 1 1 2 0v10.59l3.29-3.3a1 1 0 0 1 1.42 1.42l-5 5A1 1 0 0 1 12 19Z"
      />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5a1 1 0 0 1 .71.29l5 5a1 1 0 1 1-1.42 1.42L13 8.41V19a1 1 0 1 1-2 0V8.41l-3.29 3.3a1 1 0 1 1-1.42-1.42l5-5A1 1 0 0 1 12 5Z"
      />
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
