import { useEffect, useRef, useState } from "preact/hooks";
import BookmarkSetupPanel from "./BookmarkSetupPanel";
import SyncPanel from "./SyncPanel";
import { buildArxivPdfUrl } from "../lib/arxiv";
import { fetchBlobWithFallback } from "../lib/fetchPaper";
import { getCachedPdfRender } from "../lib/pdfRenderCache";
import { loadPdfJs } from "./pdfJsClient";

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
const LIBRARY_PAGE_IDS = ["home", "browse", "library", "notes", "edit"];
const PAPER_THUMBNAIL_WIDTH = 420;
const PAPER_THUMBNAIL_CACHE_LIMIT = 60;
const PAPER_THUMBNAIL_INTERSECTION_MARGIN = "360px 0px";
const paperThumbnailCache = new Map();
const paperThumbnailRequests = new Map();

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
  const [activeLibraryPage, setActiveLibraryPage] = useState(() => getInitialLibraryPage());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setInputValue(defaultInput || "");
  }, [defaultInput]);

  useEffect(() => {
    const handlePopState = () => {
      setActiveLibraryPage(getInitialLibraryPage());
      setOpenPaperMenuId("");
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

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
  const recentViewedPapers = filterOpenPaperSuggestions(paperSuggestions, "").slice(0, 8);
  const recentSavedPapers = sortedPapers.slice(0, 8);
  const sidebarItems = [
    { id: "home", label: "Gallery", count: "" },
    { id: "browse", label: "Browse Papers", count: recentViewedPapers.length },
    { id: "library", label: "Library", count: papers.length },
    { id: "notes", label: "Notes", count: theoremNotes.length },
    { id: "edit", label: "Edit Papers", count: latexProjects.length }
  ];

  const applyOpenPaperSuggestion = (suggestion) => {
    const nextValue = getOpenPaperSuggestionUrl(suggestion);
    setInputValue(nextValue);
    setOpenSuggestionsOpen(false);
    setActiveOpenSuggestionIndex(-1);
  };

  const navigateLibraryPage = (pageId) => {
    const nextPage = normalizeLibraryPage(pageId);
    setActiveLibraryPage(nextPage);
    setLibraryPageInUrl(nextPage);
    setOpenPaperMenuId("");
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

  const renderOpenPaperCard = (className = "form-card") => (
    <section className={`card ${className}`}>
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
  );

  const renderRecentPreviews = (items = recentViewedPapers) => (
    <div className="document-gallery">
      {items.map((suggestion) => (
        <RecentPaperPreview
          key={suggestion.id}
          suggestion={suggestion}
          onOpen={() => onSubmitUrl(getOpenPaperSuggestionUrl(suggestion))}
        />
      ))}
    </div>
  );

  const renderSavedPreviews = (items) => (
    <div className="document-gallery">
      {items.map((paper) => (
        <SavedPaperPreview
          key={paper.id}
          paper={paper}
          menuOpen={openPaperMenuId === paper.id}
          onOpen={() => onOpenPaper(paper.id)}
          onToggleMenu={() =>
            setOpenPaperMenuId((current) => (current === paper.id ? "" : paper.id))
          }
          onExport={() => {
            setOpenPaperMenuId("");
            onExportPaper(paper.id);
          }}
          onDelete={() => {
            setOpenPaperMenuId("");
            onDeletePaper(paper.id);
          }}
        />
      ))}
    </div>
  );

  const renderProjectPreviews = (items) => (
    <div className="document-gallery document-gallery--projects">
      {items.map((project) => {
        const menuId = getLatexProjectMenuId(project.id);
        return (
          <LatexProjectPreview
            key={project.id}
            project={project}
            menuOpen={openPaperMenuId === menuId}
            onOpen={() => onOpenLatexProject(project.id)}
            onToggleMenu={() =>
              setOpenPaperMenuId((current) => (current === menuId ? "" : menuId))
            }
            onDelete={() => {
              setOpenPaperMenuId("");
              onDeleteLatexProject(project.id);
            }}
          />
        );
      })}
    </div>
  );

  const renderHomePage = () => (
    <div className="library-page">
      <header className="dashboard-header">
        <div className="dashboard-copy">
          <p className="dashboard-subtext">Recently viewed and saved papers</p>
          <h1>Paper Gallery</h1>
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
            <span>Drafts</span>
          </div>
        </div>
      </header>

      {renderOpenPaperCard("form-card gallery-search-card")}

      <section className="card gallery-section">
        <div className="library-heading">
          <div className="section-heading section-heading--compact">
            <h2>Recently Viewed</h2>
            <p>Recent paper searches and opens appear here.</p>
          </div>
          <button className="ghost-button" type="button" onClick={() => navigateLibraryPage("browse")}>
            Browse Papers
          </button>
        </div>
        {recentViewedPapers.length ? (
          renderRecentPreviews(recentViewedPapers.slice(0, 6))
        ) : (
          <p className="empty-state">No recent papers yet.</p>
        )}
      </section>

      <section className="card gallery-section">
        <div className="library-heading">
          <div className="section-heading section-heading--compact">
            <h2>Saved Papers</h2>
            <p>Open a saved document preview from your library.</p>
          </div>
          <button className="ghost-button" type="button" onClick={() => navigateLibraryPage("library")}>
            View Library
          </button>
        </div>
        {loading ? <p className="empty-state">Loading your library…</p> : null}
        {!loading && recentSavedPapers.length ? (
          renderSavedPreviews(recentSavedPapers.slice(0, 6))
        ) : null}
        {!loading && !recentSavedPapers.length ? (
          <p className="empty-state">
            No saved papers yet. Open one in skim mode and use Save to Library.
          </p>
        ) : null}
      </section>
    </div>
  );

  const renderBrowsePage = () => (
    <div className="library-page">
      <header className="dashboard-header">
        <div className="dashboard-copy">
          <p className="dashboard-subtext">Search arXiv and reopen recent documents</p>
          <h1>Browse Papers</h1>
        </div>
      </header>

      {renderOpenPaperCard("form-card gallery-search-card")}

      <section className="card gallery-section">
        <div className="section-heading">
          <h2>Recently Viewed</h2>
          <p>Recent paper searches and opens appear here.</p>
        </div>
        {recentViewedPapers.length ? (
          renderRecentPreviews(recentViewedPapers)
        ) : (
          <p className="empty-state">No recent papers yet.</p>
        )}
      </section>
    </div>
  );

  const renderLibraryPage = () => (
    <div className="library-page">
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
        {filteredPapers.length ? renderSavedPreviews(filteredPapers) : null}
      </section>
    </div>
  );

  const renderNotesPage = () => (
    <div className="library-page">
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
            <article className="note-card note-card--preview" key={note.id}>
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
  );

  const renderEditPage = () => (
    <div className="library-page">
      <section className="card latex-card">
        <div className="library-heading">
          <div className="section-heading section-heading--compact">
            <h2>Edit Papers</h2>
            <p>LaTeX Projects and drafts with rendered math preview.</p>
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
        {filteredLatexProjects.length ? renderProjectPreviews(filteredLatexProjects) : null}
      </section>
    </div>
  );

  const renderActivePage = () => {
    if (activeLibraryPage === "browse") {
      return renderBrowsePage();
    }
    if (activeLibraryPage === "library") {
      return renderLibraryPage();
    }
    if (activeLibraryPage === "notes") {
      return renderNotesPage();
    }
    if (activeLibraryPage === "edit") {
      return renderEditPage();
    }
    return renderHomePage();
  };

  return (
    <>
      <div className="library-shell">
        <div
          className={`library-layout${
            sidebarCollapsed ? " library-layout--sidebar-collapsed" : ""
          }`}
        >
          <aside
            className={`library-sidebar${
              sidebarCollapsed ? " library-sidebar--collapsed" : ""
            }`}
            aria-label="Workspace navigation"
          >
            <div className="library-brand">
              <button
                className="library-brand-button"
                type="button"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => setSidebarCollapsed((current) => !current)}
              >
                <img src="/icons/icon.svg" alt="" aria-hidden="true" />
              </button>
              <div>
                <p className="dashboard-subtext">ar5iv Reader</p>
                <h1>Workspace</h1>
              </div>
            </div>

            <nav className="library-nav" aria-label="Library sections">
              {sidebarItems.map((item) => (
                <button
                  className={`library-nav-button${
                    activeLibraryPage === item.id ? " library-nav-button--active" : ""
                  }`}
                  type="button"
                  key={item.id}
                  aria-label={item.label}
                  aria-current={activeLibraryPage === item.id ? "page" : undefined}
                  title={sidebarCollapsed ? item.label : undefined}
                  onClick={() => navigateLibraryPage(item.id)}
                >
                  <LibraryNavIcon id={item.id} />
                  <span>{item.label}</span>
                  {item.count !== "" ? <strong>{item.count}</strong> : null}
                </button>
              ))}
            </nav>

            <button
              className="library-settings-button"
              type="button"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
              <span>Settings & Sync</span>
            </button>
          </aside>

          <div className="library-main">{renderActivePage()}</div>
        </div>
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
      url: String(suggestion?.url || "").trim(),
      searchedAt: String(suggestion?.searchedAt || "").trim()
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

function getInitialLibraryPage() {
  if (typeof window === "undefined") {
    return "home";
  }

  try {
    return normalizeLibraryPage(new URL(window.location.href).searchParams.get("view"));
  } catch {
    return "home";
  }
}

function normalizeLibraryPage(pageId) {
  const normalizedPageId = String(pageId || "").trim().toLowerCase();
  return LIBRARY_PAGE_IDS.includes(normalizedPageId) ? normalizedPageId : "home";
}

function setLibraryPageInUrl(pageId) {
  if (typeof window === "undefined") {
    return;
  }

  const nextPage = normalizeLibraryPage(pageId);
  const url = new URL(window.location.href);
  if (nextPage === "home") {
    url.searchParams.delete("view");
  } else {
    url.searchParams.set("view", nextPage);
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextPath !== currentPath) {
    window.history.pushState({}, "", nextPath);
  }
}

function formatDateTime(value) {
  const timestamp = Date.parse(value || "");
  return timestamp ? new Date(timestamp).toLocaleString() : "Unknown date";
}

function RecentPaperPreview({ suggestion, onOpen }) {
  const title = suggestion.title || suggestion.id || "Untitled paper";
  const url = getOpenPaperSuggestionUrl(suggestion);

  return (
    <article className="paper-preview-card paper-preview-card--paper">
      <button className="paper-preview-main" type="button" onClick={onOpen}>
        <PaperPreviewThumbnail
          label="arXiv"
          paperId={suggestion.id}
          pdfUrl={buildArxivPdfUrl(suggestion.id)}
          title={title}
        />
        <span className="paper-preview-copy">
          <span className="paper-preview-kicker">Recently viewed</span>
          <span className="paper-preview-title">{title}</span>
          <span className="paper-preview-meta">
            <span className="paper-id">{suggestion.id}</span>
            {suggestion.searchedAt ? (
              <span>Viewed {formatDateTime(suggestion.searchedAt)}</span>
            ) : null}
          </span>
          <span className="paper-preview-url">{url}</span>
        </span>
      </button>
    </article>
  );
}

function SavedPaperPreview({ paper, menuOpen, onOpen, onToggleMenu, onExport, onDelete }) {
  const title = paper.title || paper.id || "Untitled paper";
  const previewLabel = paper.contentType === "pdf" ? "PDF" : "HTML";
  const previewPdfUrl = paper.pdfUrl || buildArxivPdfUrl(paper.id);

  return (
    <article
      className={`paper-preview-card paper-preview-card--paper${
        menuOpen ? " paper-row--menu-open" : ""
      }`}
    >
      <button className="paper-preview-main" type="button" onClick={onOpen}>
        <PaperPreviewThumbnail
          label={previewLabel}
          paperId={paper.id}
          pdfUrl={previewPdfUrl}
          pdfFingerprint={paper.pdfFingerprint}
          title={title}
        />
        <span className="paper-preview-copy">
          <span className="paper-preview-kicker">Saved paper</span>
          <span className="paper-preview-title">{title}</span>
          <span className="paper-preview-meta">
            <span className="paper-id">{paper.id}</span>
            <span>Updated {formatDateTime(paper.updatedAt || paper.savedAt)}</span>
          </span>
        </span>
      </button>
      <div className="paper-preview-actions paper-menu-shell">
        <button
          className="icon-button icon-button--menu"
          type="button"
          aria-label={`More actions for ${title}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={onToggleMenu}
        >
          <MoreIcon />
        </button>
        {menuOpen ? (
          <div className="paper-menu" role="menu" aria-label={`Actions for ${title}`}>
            <button role="menuitem" type="button" onClick={onExport}>
              Export HTML
            </button>
            <button className="paper-menu-danger" role="menuitem" type="button" onClick={onDelete}>
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function LatexProjectPreview({ project, menuOpen, onOpen, onToggleMenu, onDelete }) {
  const title = project.title || "Untitled project";

  return (
    <article className={`paper-preview-card${menuOpen ? " paper-row--menu-open" : ""}`}>
      <button className="paper-preview-main" type="button" onClick={onOpen}>
        <PaperPreviewPlaceholder label="TeX" />
        <span className="paper-preview-copy">
          <span className="paper-preview-kicker">Draft</span>
          <span className="paper-preview-title">{title}</span>
          <span className="paper-preview-meta">
            <span>Updated {formatDateTime(project.updatedAt || project.createdAt)}</span>
          </span>
        </span>
      </button>
      <div className="paper-preview-actions paper-menu-shell">
        <button
          className="icon-button icon-button--menu"
          type="button"
          aria-label={`More actions for ${title}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={onToggleMenu}
        >
          <MoreIcon />
        </button>
        {menuOpen ? (
          <div className="paper-menu" role="menu" aria-label={`Actions for ${title}`}>
            <button className="paper-menu-danger" role="menuitem" type="button" onClick={onDelete}>
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function PaperPreviewThumbnail({ label, paperId = "", pdfUrl = "", pdfFingerprint = "", title = "" }) {
  const thumbnailRef = useRef(null);
  const cacheKey = buildPaperThumbnailCacheKey({ paperId, pdfUrl, pdfFingerprint });
  const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState(() =>
    getMemoryCachedPaperThumbnail(cacheKey)
  );
  const [thumbnailStatus, setThumbnailStatus] = useState(thumbnailDataUrl ? "ready" : "idle");

  useEffect(() => {
    const element = thumbnailRef.current;
    if (!(element instanceof Element) || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }

        setIsVisible(true);
        observer.disconnect();
      },
      {
        rootMargin: PAPER_THUMBNAIL_INTERSECTION_MARGIN
      }
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [cacheKey]);

  useEffect(() => {
    const cached = getMemoryCachedPaperThumbnail(cacheKey);
    setThumbnailDataUrl(cached);
    setThumbnailStatus(cached ? "ready" : "idle");

    if (!cacheKey || cached || !isVisible) {
      return undefined;
    }

    let cancelled = false;
    setThumbnailStatus("loading");
    void loadPaperThumbnail({ cacheKey, paperId, pdfUrl, pdfFingerprint })
      .then((dataUrl) => {
        if (cancelled) {
          return;
        }

        setThumbnailDataUrl(dataUrl);
        setThumbnailStatus("ready");
      })
      .catch((error) => {
        console.warn("Paper thumbnail render failed", paperId, error);
        if (!cancelled) {
          setThumbnailStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, isVisible, paperId, pdfUrl, pdfFingerprint]);

  return (
    <span
      className={`paper-preview-thumbnail paper-preview-thumbnail--document paper-preview-thumbnail--${thumbnailStatus}`}
      aria-hidden="true"
      ref={thumbnailRef}
    >
      {thumbnailDataUrl ? (
        <img src={thumbnailDataUrl} alt="" decoding="async" loading="lazy" />
      ) : (
        <span className="paper-preview-placeholder">
          <span className="paper-preview-label">{label}</span>
          <span className="paper-preview-loading">
            {thumbnailStatus === "error" ? "Preview unavailable" : "Loading preview"}
          </span>
        </span>
      )}
      {title ? <span className="paper-preview-thumbnail-title">{title}</span> : null}
    </span>
  );
}

function PaperPreviewPlaceholder({ label }) {
  return (
    <span className="paper-preview-thumbnail" aria-hidden="true">
      <span className="paper-preview-label">{label}</span>
      <span className="paper-preview-glyph" />
    </span>
  );
}

function buildPaperThumbnailCacheKey({ paperId = "", pdfUrl = "", pdfFingerprint = "" }) {
  const normalizedPaperId = String(paperId || "").trim();
  const normalizedPdfUrl = String(pdfUrl || "").trim();
  if (!normalizedPaperId || !normalizedPdfUrl) {
    return "";
  }

  return [String(pdfFingerprint || "").trim(), normalizedPaperId, normalizedPdfUrl].join("::");
}

function getMemoryCachedPaperThumbnail(cacheKey) {
  if (!cacheKey || !paperThumbnailCache.has(cacheKey)) {
    return "";
  }

  const dataUrl = paperThumbnailCache.get(cacheKey);
  paperThumbnailCache.delete(cacheKey);
  paperThumbnailCache.set(cacheKey, dataUrl);
  return dataUrl;
}

function rememberPaperThumbnail(cacheKey, dataUrl) {
  if (!cacheKey || !dataUrl) {
    return;
  }

  paperThumbnailCache.set(cacheKey, dataUrl);
  while (paperThumbnailCache.size > PAPER_THUMBNAIL_CACHE_LIMIT) {
    paperThumbnailCache.delete(paperThumbnailCache.keys().next().value);
  }
}

async function loadPaperThumbnail({ cacheKey, paperId, pdfUrl, pdfFingerprint }) {
  const cached = getMemoryCachedPaperThumbnail(cacheKey);
  if (cached) {
    return cached;
  }

  const activeRequest = paperThumbnailRequests.get(cacheKey);
  if (activeRequest) {
    return activeRequest;
  }

  const request = renderPaperThumbnailDataUrl({ paperId, pdfUrl, pdfFingerprint })
    .then((dataUrl) => {
      rememberPaperThumbnail(cacheKey, dataUrl);
      return dataUrl;
    })
    .finally(() => {
      paperThumbnailRequests.delete(cacheKey);
    });

  paperThumbnailRequests.set(cacheKey, request);
  return request;
}

async function renderPaperThumbnailDataUrl({ paperId, pdfUrl, pdfFingerprint }) {
  if (pdfFingerprint) {
    const cachedRender = await getCachedPdfRender({
      pdfFingerprint,
      pageNumber: 1,
      quality: "low"
    }).catch(() => null);
    if (cachedRender?.blob instanceof Blob) {
      return rasterBlobToThumbnailDataUrl(cachedRender.blob);
    }
  }

  try {
    return await renderPdfUrlThumbnail(pdfUrl);
  } catch (error) {
    console.warn("Direct PDF thumbnail render failed", paperId, error);
  }

  const { blob } = await fetchBlobWithFallback(pdfUrl);
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await renderPdfUrlThumbnail(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderPdfUrlThumbnail(pdfUrl) {
  const pdfjs = await loadPdfJs();
  let loadingTask = null;
  let documentNode = null;

  try {
    loadingTask = pdfjs.getDocument({
      url: pdfUrl,
      disableAutoFetch: true,
      enableHWA: true
    });
    documentNode = await loadingTask.promise;
    const page = await documentNode.getPage(1);
    const viewport = getThumbnailViewport(page, PAPER_THUMBNAIL_WIDTH);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", {
      alpha: false
    });
    if (!context) {
      throw new Error("Canvas rendering context unavailable.");
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({
      canvasContext: context,
      viewport
    }).promise;
    page.cleanup?.();
    return canvas.toDataURL("image/webp", 0.76);
  } finally {
    try {
      documentNode?.destroy?.();
    } catch {
      // Best-effort cleanup for completed thumbnail renders.
    }
    try {
      loadingTask?.destroy?.();
    } catch {
      // Best-effort cleanup for cancelled thumbnail loading tasks.
    }
  }
}

function getThumbnailViewport(page, targetWidth) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale =
    baseViewport.width > 0 ? targetWidth / baseViewport.width : 0.64;
  return page.getViewport({
    scale: Math.max(0.2, Math.min(scale, 1.1))
  });
}

async function rasterBlobToThumbnailDataUrl(blob) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      return imageSourceToThumbnailDataUrl(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close?.();
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      try {
        resolve(imageSourceToThumbnailDataUrl(image, image.naturalWidth, image.naturalHeight));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Cached thumbnail image could not be decoded."));
    };
    image.src = objectUrl;
  });
}

function imageSourceToThumbnailDataUrl(source, sourceWidth, sourceHeight) {
  const width = Math.max(1, Math.min(PAPER_THUMBNAIL_WIDTH, Number(sourceWidth || 0)));
  const height = Math.max(
    1,
    Math.round(width * (Number(sourceHeight || 1) / Math.max(1, Number(sourceWidth || 1))))
  );
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false
  });
  if (!context) {
    throw new Error("Canvas rendering context unavailable.");
  }

  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/webp", 0.76);
}

function LibraryNavIcon({ id }) {
  if (id === "browse") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M10.8 4a6.8 6.8 0 0 1 5.35 11l3.42 3.43a1 1 0 0 1-1.42 1.41l-3.42-3.42A6.8 6.8 0 1 1 10.8 4Zm0 2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z"
        />
      </svg>
    );
  }

  if (id === "library") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 4.5A2.5 2.5 0 0 1 7.5 2h9A2.5 2.5 0 0 1 19 4.5v15a1 1 0 0 1-1.46.89L12 17.52l-5.54 2.87A1 1 0 0 1 5 19.5v-15Zm2.5-.5a.5.5 0 0 0-.5.5v13.36l4.54-2.35a1 1 0 0 1 .92 0L17 17.86V4.5a.5.5 0 0 0-.5-.5h-9Z"
        />
      </svg>
    );
  }

  if (id === "notes") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6 3h9.6a1 1 0 0 1 .7.3l2.4 2.4a1 1 0 0 1 .3.7V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 2v14h11V7.41L14.59 5H6Zm2 5h7v2H8v-2Zm0 4h7v2H8v-2Z"
        />
      </svg>
    );
  }

  if (id === "edit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M16.86 3.59a2 2 0 0 1 2.83 0l.72.72a2 2 0 0 1 0 2.83l-9.9 9.9a1 1 0 0 1-.45.26l-4.12 1.18a1 1 0 0 1-1.24-1.24l1.18-4.12a1 1 0 0 1 .26-.45l9.9-9.9Zm1.41 1.42-9.53 9.53-.46 1.6 1.6-.46 9.53-9.53-.72-.72-.42-.42Z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 5a2 2 0 0 1 2-2h5v8H4V5Zm9-2h5a2 2 0 0 1 2 2v5h-7V3ZM4 13h7v8H6a2 2 0 0 1-2-2v-6Zm9 0h7v6a2 2 0 0 1-2 2h-5v-8Z"
      />
    </svg>
  );
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
