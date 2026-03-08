import { useEffect, useRef, useState } from "preact/hooks";
import LibraryView from "./components/LibraryView";
import ReaderView from "./components/ReaderView";
import Toast from "./components/Toast";
import {
  deletePaper,
  getAssetRecordsForPaper,
  getPaper,
  listPapers,
  savePaper
} from "./lib/db";
import {
  downloadBlob,
  exportLibraryIds,
  exportPaperHtml,
  importLibraryIds
} from "./lib/exportImport";
import { fetchPaperById } from "./lib/fetchPaper";
import { rewriteHtmlAssetUrls } from "./lib/assets";
import { extractArxivIdFromIncoming } from "./lib/arxiv";
import { extractPaperMetadata, sanitizePaperHtml } from "./lib/sanitizePaper";

export default function App() {
  const [routeVersion, setRouteVersion] = useState(0);
  const [library, setLibrary] = useState({ loading: true, papers: [] });
  const [reader, setReader] = useState({ status: "idle", paper: null, error: "" });
  const [toast, setToast] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const revokeAssetsRef = useRef(() => {});

  useEffect(() => {
    void refreshLibrary();

    const syncRoute = () => setRouteVersion((value) => value + 1);
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    revokeAssetsRef.current();
    revokeAssetsRef.current = () => {};

    const route = parseRoute();

    if (route.kind === "library") {
      setReader({ status: "idle", paper: null, error: "" });
      return undefined;
    }

    setReader({ status: "loading", paper: null, error: "" });

    const load = async () => {
      try {
        if (route.kind === "saved-paper") {
          const record = await getPaper(route.paperId);
          if (!record) {
            throw new Error(`Paper ${route.paperId} is not saved in this library.`);
          }

          const assets = await getAssetRecordsForPaper(route.paperId);
          const offlineHtml = rewriteHtmlAssetUrls(record.html, assets, record.ar5ivUrl);
          const metadata = extractPaperMetadata(record.html, record.id);
          const sanitizedHtml = sanitizePaperHtml(offlineHtml.html, {
            baseUrl: record.ar5ivUrl
          });

          if (cancelled) {
            offlineHtml.revoke();
            return;
          }

          revokeAssetsRef.current = offlineHtml.revoke;
          setReader({
            status: "ready",
            error: "",
            paper: {
              ...record,
              title: record.title || metadata.title || record.id,
              sanitizedHtml,
              mode: "saved"
            }
          });
          return;
        }

        const id = extractArxivIdFromIncoming(route.payload);
        if (!id) {
          throw new Error(
            "No arXiv identifier was found in the shared payload. Paste a valid arXiv URL or ID."
          );
        }

        const sessionPaper = await fetchPaperById(id, {
          sourceUrl: route.payload.url || route.payload.text || "",
          titleHint: route.payload.title || ""
        });
        const metadata = extractPaperMetadata(sessionPaper.html, sessionPaper.id);
        const sanitizedHtml = sanitizePaperHtml(sessionPaper.html, {
          baseUrl: sessionPaper.ar5ivUrl
        });

        if (cancelled) {
          return;
        }

        setReader({
          status: "ready",
          error: "",
          paper: {
            ...sessionPaper,
            title: metadata.title || sessionPaper.titleHint || sessionPaper.id,
            sanitizedHtml,
            mode: "session"
          }
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setReader({
          status: "error",
          paper: null,
          error: stringifyError(error)
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [routeVersion]);

  useEffect(() => {
    return () => revokeAssetsRef.current();
  }, []);

  const route = parseRoute();
  const receiveMessage =
    route.kind === "receive" && reader.status === "error" ? reader.error : "";
  const defaultInput =
    route.kind === "receive"
      ? route.payload.url || route.payload.text || route.payload.title || ""
      : "";

  async function refreshLibrary() {
    const papers = await listPapers().catch((error) => {
      console.error("Library load failed", error);
      setToast("Failed to load the local library.");
      return [];
    });

    setLibrary({ loading: false, papers });
  }

  function navigate(nextUrl) {
    window.history.pushState({}, "", nextUrl);
    setRouteVersion((value) => value + 1);
  }

  function showToast(message) {
    setToast(message);
  }

  function openReceiveInput(value) {
    const trimmed = value.trim();
    if (!trimmed) {
      setToast("Paste an arXiv URL or ID first.");
      return;
    }

    const target = new URL("/receive", window.location.origin);
    target.searchParams.set("url", trimmed);
    navigate(`${target.pathname}${target.search}`);
  }

  async function handleSave() {
    if (!reader.paper || reader.paper.mode !== "session") {
      return;
    }

    setSaving(true);
    try {
      await savePaper(reader.paper);
      await refreshLibrary();
      showToast("Saved for offline reading.");
      navigate(`/?paper=${encodeURIComponent(reader.paper.id)}`);
    } catch (error) {
      showToast("Save failed.");
      setReader((current) => ({
        ...current,
        error: stringifyError(error)
      }));
    } finally {
      setSaving(false);
    }
  }

  async function handleExportPaper(paperId) {
    try {
      const blob = await exportPaperHtml(paperId);
      downloadBlob(blob, `${paperId}.html`);
      showToast("Downloaded raw HTML snapshot.");
    } catch (error) {
      showToast(stringifyError(error));
    }
  }

  async function handleDeletePaper(paperId) {
    if (!window.confirm(`Remove ${paperId} from the offline library?`)) {
      return;
    }

    try {
      await deletePaper(paperId);
      await refreshLibrary();
      showToast("Removed from library.");
      if (parseRoute().paperId === paperId) {
        navigate("/");
      }
    } catch (error) {
      showToast(stringifyError(error));
    }
  }

  async function handleExportLibrary() {
    try {
      const blob = await exportLibraryIds();
      downloadBlob(blob, "paper-library-ids.json");
      showToast("Downloaded library ID export.");
    } catch (error) {
      showToast(stringifyError(error));
    }
  }

  async function handleImportLibrary(file) {
    setImporting(true);
    try {
      const { importedIds, failedIds } = await importLibraryIds(file);
      await refreshLibrary();

      if (failedIds.length) {
        showToast(
          `Imported ${importedIds.length}. Failed: ${failedIds.join(", ")}`
        );
      } else {
        showToast(`Imported ${importedIds.length} paper IDs.`);
      }
    } catch (error) {
      showToast(stringifyError(error));
    } finally {
      setImporting(false);
    }
  }

  const showReader = reader.status === "loading" || Boolean(reader.paper);

  return (
    <main className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      {showReader ? (
        <ReaderView
          paper={reader.paper}
          busy={saving}
          error={reader.error}
          onBack={() => navigate("/")}
          onSave={handleSave}
          onExport={() => handleExportPaper(reader.paper.id)}
          onDelete={() => handleDeletePaper(reader.paper.id)}
          showToast={showToast}
        />
      ) : (
        <LibraryView
          papers={library.papers}
          loading={library.loading}
          importing={importing}
          receiveMessage={receiveMessage}
          defaultInput={defaultInput}
          onSubmitUrl={openReceiveInput}
          onOpenPaper={(paperId) => navigate(`/?paper=${encodeURIComponent(paperId)}`)}
          onExportPaper={handleExportPaper}
          onDeletePaper={handleDeletePaper}
          onExportLibrary={handleExportLibrary}
          onImportFile={handleImportLibrary}
        />
      )}

      <Toast message={toast} />
    </main>
  );
}

function parseRoute() {
  const url = new URL(window.location.href);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const paperId = url.searchParams.get("paper")?.trim() || "";

  if (pathname === "/receive") {
    return {
      kind: "receive",
      paperId: "",
      payload: {
        url: url.searchParams.get("url") || "",
        text: url.searchParams.get("text") || "",
        title: url.searchParams.get("title") || ""
      }
    };
  }

  if (paperId) {
    return {
      kind: "saved-paper",
      paperId,
      payload: null
    };
  }

  return {
    kind: "library",
    paperId: "",
    payload: null
  };
}

function stringifyError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
