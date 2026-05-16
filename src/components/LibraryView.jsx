import { useEffect, useState } from "preact/hooks";
import BookmarkSetupPanel from "./BookmarkSetupPanel";
import SyncPanel from "./SyncPanel";

const OPEN_PAPER_URL_PREFIX = "https://arxiv.org/abs/";
const OPEN_PAPER_URL_PREFIX_ALIASES = [
  "http://arxiv.org/abs/",
  "https://www.arxiv.org/abs/",
  "http://www.arxiv.org/abs/",
  "arxiv.org/abs/",
  "www.arxiv.org/abs/",
  "/abs/",
  "abs/"
];
const OPEN_PAPER_SUGGESTION_LIMIT = 6;

export default function LibraryView({
  papers,
  latexProjects = [],
  paperSuggestions = [],
  theoremNotes,
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
  onCreateLatexProject,
  onOpenLatexProject,
  onDeleteLatexProject,
  onOpenNotePaper,
  onExportPaper,
  onDeletePaper,
  onDownloadBackup,
  onRestoreBackup,
  formatPairSyncStatus
}) {
  const [inputValue, setInputValue] = useState(defaultInput || "");
  const [openSuggestionsOpen, setOpenSuggestionsOpen] = useState(false);
  const [activeOpenSuggestionIndex, setActiveOpenSuggestionIndex] = useState(-1);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [latexProjectQuery, setLatexProjectQuery] = useState("");
  const [noteQuery, setNoteQuery] = useState("");
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
  const sortedLatexProjects = [...latexProjects].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || "") || 0;
    const rightTime = Date.parse(right.updatedAt || right.createdAt || "") || 0;
    return rightTime - leftTime;
  });
  const normalizedLatexProjectQuery = latexProjectQuery.trim().toLowerCase();
  const filteredLatexProjects = normalizedLatexProjectQuery
    ? sortedLatexProjects.filter((project) => {
        const haystack = `${project.title} ${project.id} ${project.source}`.toLowerCase();
        return haystack.includes(normalizedLatexProjectQuery);
      })
    : sortedLatexProjects;
  const normalizedNoteQuery = noteQuery.trim().toLowerCase();
  const filteredNotes = normalizedNoteQuery
    ? theoremNotes.filter((note) => {
        const haystack = [
          note.paperTitle,
          note.paperId,
          note.theoremTitle,
          note.theoremText,
          note.noteText,
          note.referenceLabel,
          note.speechTranscript,
          note.mathLatex
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedNoteQuery);
      })
    : theoremNotes;

  const sortButtonLabel = sortDirection === "desc" ? "Sort by newest first" : "Sort by oldest first";
  const openPaperSuggestions = filterOpenPaperSuggestions(paperSuggestions, inputValue);
  const showOpenPaperSuggestions = openSuggestionsOpen && openPaperSuggestions.length > 0;
  const hasActiveOpenSuggestion =
    activeOpenSuggestionIndex >= 0 && activeOpenSuggestionIndex < openPaperSuggestions.length;

  const applyOpenPaperSuggestion = (suggestion) => {
    const nextValue = getOpenPaperSuggestionUrl(suggestion);
    setInputValue(nextValue);
    setOpenSuggestionsOpen(false);
    setActiveOpenSuggestionIndex(-1);
  };

  const handleOpenPaperKeyDown = (event) => {
    if (event.key === "Tab" && !event.shiftKey) {
      const completion = completeOpenPaperUrlPrefix(event.currentTarget.value);
      if (completion && completion !== event.currentTarget.value) {
        const inputElement = event.currentTarget;
        event.preventDefault();
        setInputValue(completion);
        window.requestAnimationFrame(() => {
          inputElement.setSelectionRange(completion.length, completion.length);
        });
        return;
      }

      if (showOpenPaperSuggestions && hasActiveOpenSuggestion) {
        event.preventDefault();
        applyOpenPaperSuggestion(openPaperSuggestions[activeOpenSuggestionIndex]);
      }
      return;
    }

    if (event.key === "ArrowDown" && openPaperSuggestions.length) {
      event.preventDefault();
      setOpenSuggestionsOpen(true);
      setActiveOpenSuggestionIndex((current) =>
        current < 0 ? 0 : Math.min(current + 1, openPaperSuggestions.length - 1)
      );
      return;
    }

    if (event.key === "ArrowUp" && openPaperSuggestions.length) {
      event.preventDefault();
      setOpenSuggestionsOpen(true);
      setActiveOpenSuggestionIndex((current) =>
        current <= 0 ? openPaperSuggestions.length - 1 : current - 1
      );
      return;
    }

    if (
      event.key === "Enter" &&
      showOpenPaperSuggestions &&
      hasActiveOpenSuggestion
    ) {
      event.preventDefault();
      const suggestion = openPaperSuggestions[activeOpenSuggestionIndex];
      const nextValue = getOpenPaperSuggestionUrl(suggestion);
      applyOpenPaperSuggestion(suggestion);
      onSubmitUrl(nextValue);
      return;
    }

    if (event.key === "Escape") {
      setOpenSuggestionsOpen(false);
      setActiveOpenSuggestionIndex(-1);
    }
  };

  return (
    <>
      <div className="library-shell">
        <header className="dashboard-header">
          <div className="dashboard-copy">
            <p className="dashboard-subtext">arXiv papers, LaTeX projects, notes, and offline sync</p>
            <h1>ar5iv Reader</h1>
          </div>
          <div className="dashboard-actions">
            <div className="dashboard-stat" aria-label={`${papers.length} saved papers`}>
              <strong>{papers.length}</strong>
              <span>Papers</span>
            </div>
            <div className="dashboard-stat" aria-label={`${theoremNotes.length} saved notes`}>
              <strong>{theoremNotes.length}</strong>
              <span>Notes</span>
            </div>
            <div className="dashboard-stat" aria-label={`${latexProjects.length} LaTeX projects`}>
              <strong>{latexProjects.length}</strong>
              <span>LaTeX</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </button>
          </div>
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
            <div className="input-shell open-paper-shell">
              <input
                className="url-input"
                type="text"
                inputMode="url"
                placeholder="https://arxiv.org/abs/1706.03762"
                value={inputValue}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="open-paper-suggestions"
                aria-expanded={showOpenPaperSuggestions}
                aria-activedescendant={
                  hasActiveOpenSuggestion
                    ? `open-paper-suggestion-${activeOpenSuggestionIndex}`
                    : undefined
                }
                onFocus={() => setOpenSuggestionsOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => {
                    setOpenSuggestionsOpen(false);
                    setActiveOpenSuggestionIndex(-1);
                  }, 120);
                }}
                onInput={(event) => {
                  setInputValue(event.currentTarget.value);
                  setOpenSuggestionsOpen(true);
                  setActiveOpenSuggestionIndex(-1);
                }}
                onKeyDown={handleOpenPaperKeyDown}
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
              {showOpenPaperSuggestions ? (
                <div
                  className="open-paper-suggestions"
                  id="open-paper-suggestions"
                  role="listbox"
                  aria-label="Recent paper searches"
                >
                  {openPaperSuggestions.map((suggestion, index) => (
                    <button
                      className={`paper-suggestion${
                        activeOpenSuggestionIndex === index ? " paper-suggestion--active" : ""
                      }`}
                      id={`open-paper-suggestion-${index}`}
                      key={suggestion.id}
                      role="option"
                      aria-selected={activeOpenSuggestionIndex === index}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyOpenPaperSuggestion(suggestion);
                      }}
                    >
                      <span className="paper-suggestion-title">{suggestion.title}</span>
                      <span className="paper-suggestion-url">
                        {getOpenPaperSuggestionUrl(suggestion)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button className="primary-button" type="submit">
              Open
            </button>
          </form>
        </section>

        <section className="card latex-card">
          <div className="library-heading">
            <div className="section-heading section-heading--compact">
              <h2>LaTeX Projects</h2>
              <p>Draft papers and research notes with rendered math preview.</p>
            </div>
            <button className="primary-button" type="button" onClick={onCreateLatexProject}>
              New Project
            </button>
          </div>

          <div className="library-toolbar">
            <div className="input-shell">
              <input
                className="url-input"
                type="search"
                placeholder="Search LaTeX projects"
                value={latexProjectQuery}
                onInput={(event) => setLatexProjectQuery(event.currentTarget.value)}
              />
            </div>
          </div>

          {!latexProjects.length ? (
            <p className="empty-state">No LaTeX projects yet.</p>
          ) : null}
          {latexProjects.length && !filteredLatexProjects.length ? (
            <p className="empty-state">No LaTeX projects match that search.</p>
          ) : null}

          <div className="paper-list latex-project-list">
            {filteredLatexProjects.map((project) => {
              const menuId = getLatexProjectMenuId(project.id);
              return (
                <article
                  className={`paper-row latex-project-row${
                    openPaperMenuId === menuId ? " paper-row--menu-open" : ""
                  }`}
                  key={project.id}
                >
                  <div className="paper-row-copy">
                    <h3>{project.title}</h3>
                    <p className="paper-id">{project.id}</p>
                    <p className="paper-meta">
                      Updated {new Date(project.updatedAt || project.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="paper-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => onOpenLatexProject(project.id)}
                    >
                      Open
                    </button>
                    <div className="paper-menu-shell">
                      <button
                        className="icon-button icon-button--menu"
                        type="button"
                        aria-label={`More actions for ${project.title}`}
                        aria-expanded={openPaperMenuId === menuId}
                        aria-haspopup="menu"
                        onClick={() =>
                          setOpenPaperMenuId((current) => (current === menuId ? "" : menuId))
                        }
                      >
                        <MoreIcon />
                      </button>
                      {openPaperMenuId === menuId ? (
                        <div className="paper-menu" role="menu" aria-label={`Actions for ${project.title}`}>
                          <button
                            className="paper-menu-danger"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setOpenPaperMenuId("");
                              onDeleteLatexProject(project.id);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
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

        <section className="card notes-card">
          <div className="library-heading">
            <div className="section-heading section-heading--compact">
              <h2>Notes</h2>
              <p>Your saved theorem notes live here.</p>
            </div>
            <p className="notes-count">{theoremNotes.length} saved</p>
          </div>

          <div className="library-toolbar">
            <div className="input-shell">
              <input
                className="url-input"
                type="search"
                placeholder="Search notes"
                value={noteQuery}
                onInput={(event) => setNoteQuery(event.currentTarget.value)}
              />
            </div>
          </div>

          {!theoremNotes.length ? (
            <p className="empty-state">No notes yet. Right-click a theorem and choose Create note.</p>
          ) : null}
          {theoremNotes.length && !filteredNotes.length ? (
            <p className="empty-state">No notes match that search.</p>
          ) : null}

          <div className="notes-list">
            {filteredNotes.map((note) => (
              <article className="note-card" key={note.id}>
                <div className="note-card-header">
                  <div>
                    <h3>{note.paperTitle || note.paperId || "Untitled paper"}</h3>
                    <p className="paper-id">{note.paperId || "Unlinked paper"}</p>
                  </div>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => onOpenNotePaper(note.paperId)}
                    disabled={!note.paperId}
                  >
                    Open paper
                  </button>
                </div>

                <div className="note-card-reference">
                  <span className="sync-label">Reference</span>
                  {note.referenceUrl ? (
                    <a href={note.referenceUrl} target="_blank" rel="noreferrer">
                      {note.referenceLabel || note.referenceUrl}
                    </a>
                  ) : (
                    <span>{note.referenceLabel || "Reference unavailable"}</span>
                  )}
                </div>

                <p className="note-card-theorem">{note.theoremText}</p>
                <p className="note-card-body">{note.noteText}</p>
                {note.speechTranscript && note.speechTranscript !== note.noteText ? (
                  <div className="note-card-ai">
                    <p className="sync-label">Transcript</p>
                    <p className="note-card-transcript">{note.speechTranscript}</p>
                  </div>
                ) : null}
                {note.mathLatex ? (
                  <div className="note-card-ai">
                    <p className="sync-label">LaTeX</p>
                    <pre className="note-card-latex">
                      <code>{note.mathLatex}</code>
                    </pre>
                  </div>
                ) : null}
                <p className="paper-meta">
                  Saved {new Date(note.updatedAt || note.createdAt).toLocaleString()}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>

      {settingsOpen ? (
        <div className="settings-modal-backdrop" role="presentation">
          <section
            className="settings-modal"
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
                    <p>Download one backup file now, restore a backup or URL list, optionally write a paper folder export, or keep one selected file updated here.</p>
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
                  <p className="status-line">{formatBackupStatus(backupState, papers, latexProjects)}</p>
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

function filterOpenPaperSuggestions(suggestions, inputValue) {
  const query = String(inputValue || "").trim().toLowerCase();
  const seenIds = new Set();
  const normalizedSuggestions = Array.isArray(suggestions) ? suggestions : [];

  return normalizedSuggestions
    .map((suggestion) => ({
      id: String(suggestion?.id || "").trim(),
      title: String(suggestion?.title || suggestion?.id || "").trim(),
      url: String(suggestion?.url || "").trim()
    }))
    .filter((suggestion) => {
      if (!suggestion.id || seenIds.has(suggestion.id)) {
        return false;
      }

      seenIds.add(suggestion.id);
      if (!query) {
        return true;
      }

      return `${suggestion.title} ${suggestion.id} ${getOpenPaperSuggestionUrl(suggestion)}`
        .toLowerCase()
        .includes(query);
    })
    .slice(0, OPEN_PAPER_SUGGESTION_LIMIT);
}

function getOpenPaperSuggestionUrl(suggestion) {
  const id = String(suggestion?.id || "").trim();
  return String(suggestion?.url || "").trim() || `${OPEN_PAPER_URL_PREFIX}${id}`;
}

function completeOpenPaperUrlPrefix(value) {
  const rawValue = String(value || "");
  const leadingWhitespace = rawValue.match(/^\s*/)?.[0] || "";
  const trimmedStartValue = rawValue.trimStart();
  const lowerValue = trimmedStartValue.toLowerCase();

  if (!lowerValue || /\s/.test(lowerValue)) {
    return "";
  }

  if (
    OPEN_PAPER_URL_PREFIX.startsWith(lowerValue) &&
    OPEN_PAPER_URL_PREFIX !== trimmedStartValue
  ) {
    return `${leadingWhitespace}${OPEN_PAPER_URL_PREFIX}`;
  }

  for (const alias of OPEN_PAPER_URL_PREFIX_ALIASES) {
    if (alias.startsWith(lowerValue)) {
      return `${leadingWhitespace}${OPEN_PAPER_URL_PREFIX}`;
    }

    if (lowerValue.startsWith(alias)) {
      return `${leadingWhitespace}${OPEN_PAPER_URL_PREFIX}${trimmedStartValue.slice(alias.length)}`;
    }
  }

  return "";
}

function getLatexProjectMenuId(projectId) {
  return `tex:${projectId}`;
}

function formatBackupStatus(backupState, papers, latexProjects = []) {
  if (!backupState?.supported) {
    return "No automatic backup file selected.";
  }

  if (!backupState.enabled) {
    return "No automatic backup file selected.";
  }

  const mirroredIds = new Set(
    Array.isArray(backupState.lastMirroredPaperIds) ? backupState.lastMirroredPaperIds : []
  );
  const mirroredProjectIds = new Set(
    Array.isArray(backupState.lastMirroredLatexProjectIds)
      ? backupState.lastMirroredLatexProjectIds
      : []
  );
  const includedCount = papers.filter((paper) => mirroredIds.has(paper.id)).length;
  const includedProjectCount = latexProjects.filter((project) => mirroredProjectIds.has(project.id)).length;
  return `${includedCount} of ${papers.length} papers and ${includedProjectCount} of ${latexProjects.length} LaTeX projects included in backup.`;
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
