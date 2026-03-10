import { useEffect, useState } from "preact/hooks";
import InstallButton from "./InstallButton";
import BookmarkSetupPanel from "./BookmarkSetupPanel";
import SyncPanel from "./SyncPanel";

export default function LibraryView({
  papers,
  loading,
  backupImporting,
  urlImporting,
  receiveMessage,
  defaultInput,
  storageDiagnostics,
  restoreStatus,
  recoveryFileState,
  deviceIdentity,
  pairedDevices,
  nearbyState,
  pairRouteInviteId,
  onEnableRecoveryFile,
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
  onExportUrls,
  onImportFile,
  onImportUrlFile,
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
            {backupImporting ? "Importing…" : "Import Backup"}
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
          <button className="ghost-button" type="button" onClick={onExportUrls}>
            Export URLs
          </button>
          <label className="ghost-button upload-button">
            {urlImporting ? "Restoring…" : "Import URLs"}
            <input
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  onImportUrlFile(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </label>
          {recoveryFileState.supported ? (
            <button className="ghost-button" type="button" onClick={onEnableRecoveryFile}>
              {recoveryFileState.enabled ? "Update Recovery File Target" : "Keep Recovery File Updated"}
            </button>
          ) : null}
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

      <section className="card status-card">
        <div className="section-heading">
          <h2>Local Storage</h2>
          <p>{storageDiagnostics.persisted ? "Storage protected" : "Browser may evict local data"}</p>
        </div>
        <p className={`status-line ${storageDiagnostics.persisted ? "status-line--good" : "status-line--warn"}`}>
          {formatStorageStatus(storageDiagnostics)}
        </p>
        <p className="status-line">
          {formatRecoveryFileStatus(recoveryFileState)}
        </p>
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

      {restoreStatus.active || restoreStatus.result ? (
        <section className="card status-card">
          <div className="section-heading">
            <h2>URL Restore</h2>
            <p>
              {restoreStatus.active
                ? `Restoring ${restoreStatus.completed} of ${restoreStatus.total}`
                : "Latest restore summary"}
            </p>
          </div>
          {restoreStatus.active ? (
            <p className="status-line">
              {restoreStatus.currentId
                ? `Fetching ${restoreStatus.currentId}...`
                : "Preparing restore job..."}
            </p>
          ) : null}
          {restoreStatus.result ? (
            <div className="restore-summary">
              <p className="status-line">
                Restored {restoreStatus.result.restoredIds.length}, skipped {restoreStatus.result.skippedIds.length}, failed {restoreStatus.result.failed.length}.
              </p>
              {restoreStatus.result.failed.length ? (
                <p className="status-line status-line--warn">
                  Failed: {restoreStatus.result.failed.map((entry) => `${entry.id} (${entry.reason})`).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

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

function formatStorageStatus(storageDiagnostics) {
  if (!storageDiagnostics?.supported) {
    return "Persistent storage is not supported in this browser.";
  }

  const usage = formatBytes(storageDiagnostics.usage);
  const quota = formatBytes(storageDiagnostics.quota);
  return storageDiagnostics.persisted
    ? `Browser persistence is granted. Using ${usage} of ${quota}.`
    : `Persistence is not guaranteed. Using ${usage} of ${quota}.`;
}

function formatRecoveryFileStatus(recoveryFileState) {
  if (!recoveryFileState?.supported) {
    return "Recovery file mirroring is unavailable in this browser.";
  }

  if (!recoveryFileState.enabled) {
    return "Recovery file mirroring is off.";
  }

  const lastWrittenAt = recoveryFileState.lastWrittenAt
    ? new Date(recoveryFileState.lastWrittenAt).toLocaleString()
    : "not written yet";
  return `Recovery file: ${recoveryFileState.filename || "selected file"}; last updated ${lastWrittenAt}.`;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let nextSize = size;
  while (nextSize >= 1024 && unitIndex < units.length - 1) {
    nextSize /= 1024;
    unitIndex += 1;
  }

  const rounded = nextSize >= 10 || unitIndex === 0 ? Math.round(nextSize) : nextSize.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}
