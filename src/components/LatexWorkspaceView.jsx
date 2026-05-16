import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import "katex/dist/katex.min.css";
import { renderLatexDocument } from "../lib/latexProjects";

const AUTOSAVE_DELAY_MS = 900;

const INSERT_SNIPPETS = [
  {
    label: "Section",
    source: "\\section{New Section}\n\n"
  },
  {
    label: "Equation",
    source: "\\[\n  \n\\]\n"
  },
  {
    label: "Theorem",
    source: "\\begin{theorem}\n\n\\end{theorem}\n"
  },
  {
    label: "Proof",
    source: "\\begin{proof}\n\n\\end{proof}\n"
  },
  {
    label: "Citation",
    source: "\\cite{}"
  }
];

export default function LatexWorkspaceView({
  project,
  status,
  error,
  onBack,
  onSave,
  onExportSource,
  onExportHtml,
  onExportPdfBuild,
  showToast
}) {
  const textareaRef = useRef(null);
  const previewRef = useRef(null);
  const lastSavedFingerprintRef = useRef("");
  const pendingProjectHydrationRef = useRef("");
  const saveRequestRef = useRef(0);
  const [title, setTitle] = useState(project?.title || "");
  const [source, setSource] = useState(project?.source || "");
  const [autosaveStatus, setAutosaveStatus] = useState("saved");
  const [compileVersion, setCompileVersion] = useState(0);
  const [layoutMode, setLayoutMode] = useState("split");

  useEffect(() => {
    pendingProjectHydrationRef.current = project?.id || "";
    setTitle(project?.title || "");
    setSource(project?.source || "");
    lastSavedFingerprintRef.current = buildProjectFingerprint(project?.title, project?.source);
    setAutosaveStatus("saved");
  }, [project?.id]);

  const rendered = useMemo(
    () => renderLatexDocument(source, { projectTitle: title }),
    [source, title, compileVersion]
  );

  useEffect(() => {
    if (status !== "ready" || !project?.id) {
      return undefined;
    }

    const nextFingerprint = buildProjectFingerprint(title, source);
    if (pendingProjectHydrationRef.current === project.id) {
      if (nextFingerprint !== lastSavedFingerprintRef.current) {
        return undefined;
      }
      pendingProjectHydrationRef.current = "";
    }

    if (nextFingerprint === lastSavedFingerprintRef.current) {
      setAutosaveStatus("saved");
      return undefined;
    }

    setAutosaveStatus("unsaved");
    const timer = window.setTimeout(() => {
      void saveProject();
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [title, source, project?.id, status]);

  async function saveProject() {
    if (!project?.id || !onSave) {
      return null;
    }

    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setAutosaveStatus("saving");

    try {
      const savedProject = await onSave({
        ...project,
        title: title.trim() || rendered.title || "Untitled LaTeX Project",
        source
      });
      if (saveRequestRef.current === requestId) {
        lastSavedFingerprintRef.current = buildProjectFingerprint(savedProject?.title || title, savedProject?.source || source);
        setAutosaveStatus("saved");
      }
      return savedProject;
    } catch (saveError) {
      console.error("LaTeX project save failed", saveError);
      if (saveRequestRef.current === requestId) {
        setAutosaveStatus("error");
      }
      showToast?.("LaTeX project save failed.");
      return null;
    }
  }

  function insertSnippet(snippet) {
    const textarea = textareaRef.current;
    const insertion = String(snippet?.source || "");
    if (!textarea || !insertion) {
      setSource((current) => `${current}${insertion}`);
      return;
    }

    const selectionStart = textarea.selectionStart ?? source.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const nextSource = `${source.slice(0, selectionStart)}${insertion}${source.slice(selectionEnd)}`;
    setSource(nextSource);

    window.requestAnimationFrame(() => {
      textarea.focus();
      const cursorOffset = insertion.includes("\n  \n")
        ? insertion.indexOf("\n  \n") + 3
        : insertion.endsWith("{}")
          ? insertion.length - 1
          : insertion.length;
      const nextCursor = selectionStart + cursorOffset;
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function scrollToSection(id) {
    const target = previewRef.current?.querySelector(`#${id}`);
    target?.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior: "smooth"
    });
  }

  if (status === "loading") {
    return (
      <main className="latex-workspace-shell">
        <p className="empty-state">Loading LaTeX project...</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="latex-workspace-shell">
        <div className="reader-topbar">
          <button className="icon-button" type="button" aria-label="Back to library" onClick={onBack}>
            <BackIcon />
          </button>
        </div>
        <p className="banner banner--error">{error || "LaTeX project could not be opened."}</p>
      </main>
    );
  }

  const dirty = buildProjectFingerprint(title, source) !== lastSavedFingerprintRef.current;
  const visibleDiagnostics = rendered.diagnostics.filter((diagnostic) => diagnostic.message);

  return (
    <main className="latex-workspace-shell">
      <header className="latex-topbar">
        <div className="latex-title-group">
          <button
            className="icon-button"
            type="button"
            aria-label="Back to library"
            title="Back to library"
            onClick={onBack}
          >
            <BackIcon />
          </button>
          <span className={`latex-save-state latex-save-state--${autosaveStatus}`}>
            {formatAutosaveStatus(autosaveStatus, dirty)}
          </span>
        </div>

        <div className="latex-insert-strip" role="toolbar" aria-label="Insert LaTeX snippets">
          <p className="sync-label">Insert</p>
          {INSERT_SNIPPETS.map((snippet) => (
            <button className="ghost-button" type="button" key={snippet.label} onClick={() => insertSnippet(snippet)}>
              {snippet.label}
            </button>
          ))}
        </div>

        <div className="latex-actions">
          <div className="latex-segmented" role="group" aria-label="Workspace layout">
            {["split", "source", "preview"].map((mode) => (
              <button
                className={layoutMode === mode ? "latex-segmented-active" : ""}
                type="button"
                key={mode}
                onClick={() => setLayoutMode(mode)}
              >
                {mode === "split" ? "Split" : mode === "source" ? "Source" : "Preview"}
              </button>
            ))}
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setCompileVersion((value) => value + 1);
              showToast?.("Rendered LaTeX preview.");
            }}
          >
            Render
          </button>
          <button
            className="ghost-button"
            type="button"
            title="Download PDF build kit"
            onClick={() => onExportPdfBuild?.({ ...project, title, source })}
          >
            <PdfBuildIcon />
            Compile PDF
          </button>
          <div className="reader-menu-shell">
            <button className="icon-button icon-button--menu" type="button" aria-label="Export source" onClick={() => onExportSource?.({ ...project, title, source })}>
              <DownloadIcon />
            </button>
          </div>
          <button className="ghost-button" type="button" onClick={() => onExportHtml?.({ ...project, title, source }, rendered)}>
            Export HTML
          </button>
        </div>
      </header>

      {error ? <p className="banner banner--error">{error}</p> : null}

      <section className={`latex-workspace latex-workspace--${layoutMode}`}>
        <aside className="latex-sidebar">
          <div className="latex-sidebar-section">
            <p className="sync-label">Outline</p>
            {rendered.outline.length ? (
              <div className="latex-outline">
                {rendered.outline.map((entry) => (
                  <button
                    className={`latex-outline-item latex-outline-item--level-${entry.level}`}
                    type="button"
                    key={entry.id}
                    onClick={() => scrollToSection(entry.id)}
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
            ) : (
              <p className="paper-meta">No sections yet.</p>
            )}
          </div>

          {visibleDiagnostics.length ? (
            <div className="latex-sidebar-section">
              <p className="sync-label">Log</p>
              <div className="latex-diagnostics">
                {visibleDiagnostics.map((diagnostic, index) => (
                  <p className={`latex-diagnostic latex-diagnostic--${diagnostic.level}`} key={`${diagnostic.level}-${index}`}>
                    {diagnostic.message}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <section className="latex-editor-panel" aria-label="LaTeX source editor">
          <textarea
            ref={textareaRef}
            className="latex-source-input"
            spellCheck={false}
            value={source}
            onInput={(event) => setSource(event.currentTarget.value)}
          />
        </section>

        <section className="latex-preview-panel" aria-label="Rendered LaTeX preview">
          <div
            ref={previewRef}
            className="latex-preview-surface"
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        </section>
      </section>
    </main>
  );
}

function buildProjectFingerprint(title, source) {
  return `${String(title || "").trim()}\n${String(source || "")}`;
}

function formatAutosaveStatus(status, dirty) {
  if (status === "saving") {
    return "Saving";
  }
  if (status === "error") {
    return "Save failed";
  }
  if (dirty || status === "unsaved") {
    return "Unsaved";
  }
  return "Saved";
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m7 10 5 5 5-5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 21h14" />
    </svg>
  );
}

function PdfBuildIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l3 3v4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v4h4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v18h10" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 14h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 11l3 3-3 3" />
    </svg>
  );
}
