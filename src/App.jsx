import { useEffect, useRef, useState } from "preact/hooks";
import LibraryView from "./components/LibraryView";
import ReaderView from "./components/ReaderView";
import Toast from "./components/Toast";
import {
  deletePaper,
  getAssetRecordsForPaper,
  getPaper,
  getSetting,
  listPapers,
  savePaper,
  setSetting,
  SETTING_KEYS
} from "./lib/db";
import {
  downloadBlob,
  exportLibraryBackup,
  exportLibraryUrlManifest,
  exportPaperHtml,
  importLibraryBackup,
  importLibraryUrlManifest
} from "./lib/exportImport";
import {
  buildPdfFallbackPaper,
  fetchPaperById,
  fetchPaperTitleById
} from "./lib/fetchPaper";
import { rewriteHtmlAssetUrls } from "./lib/assets";
import { extractArxivIdFromIncoming } from "./lib/arxiv";
import {
  extractPaperMetadata,
  normalizePaperTitle,
  sanitizePaperHtml
} from "./lib/sanitizePaper";
import { getOrCreateDeviceIdentity, updateDeviceIdentityLabel } from "./lib/nearby/deviceIdentity";
import { extractInviteId } from "./lib/nearby/inviteCode";
import { formatPairSyncStatus } from "./lib/nearby/merge";
import {
  forgetPairedDevice,
  getPairedDevice,
  listPairedDevices,
  pairDevices,
  renamePairedDevice,
  touchPairedDevice
} from "./lib/nearby/pairStore";
import { NearbyRelayClient } from "./lib/nearby/relayClient";
import { runLibrarySyncSession, runPairSession } from "./lib/nearby/syncProtocol";
import { NearbyWebRtcSession } from "./lib/nearby/webrtcSession";
import { ensurePersistentStorage } from "./lib/persistence";
import {
  createRecoveryFileHandle,
  getRecoveryFilePermission,
  isRecoveryFileSupported,
  writeRecoveryFile
} from "./lib/recoveryFile";
import {
  buildUrlManifest,
  buildUrlManifestFilename,
  buildUrlManifestFingerprint,
  restoreFromUrlManifest
} from "./lib/urlManifest";

function normalizeNearbySignalUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  const withProtocol = /^[a-z]+:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (!["ws:", "wss:"].includes(url.protocol)) {
      return "";
    }

    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/ws";
    }

    return url.toString();
  } catch {
    return "";
  }
}

const NEARBY_SIGNAL_URL = normalizeNearbySignalUrl(import.meta.env.VITE_NEARBY_SIGNAL_URL);
const APP_VERSION = "0.3.0";
const AUTO_SYNC_INTERVAL_MS = 60_000;

export default function App() {
  const [routeVersion, setRouteVersion] = useState(0);
  const [library, setLibrary] = useState({ loading: true, papers: [] });
  const [reader, setReader] = useState({ status: "idle", paper: null, error: "" });
  const [openTabs, setOpenTabs] = useState([]);
  const [toast, setToast] = useState("");
  const [backupImporting, setBackupImporting] = useState(false);
  const [urlImporting, setUrlImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [libraryInput, setLibraryInput] = useState("");
  const [fallbackNoticeEnabled, setFallbackNoticeEnabled] = useState(true);
  const [storageDiagnostics, setStorageDiagnostics] = useState(createDefaultStorageDiagnostics());
  const [restoreStatus, setRestoreStatus] = useState(createDefaultRestoreStatus());
  const [recoveryFileState, setRecoveryFileState] = useState(createDefaultRecoveryFileState());
  const [deviceIdentity, setDeviceIdentity] = useState(null);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [nearbyState, setNearbyState] = useState({
    relayStatus: NEARBY_SIGNAL_URL ? "idle" : "unavailable",
    summaryStatus: NEARBY_SIGNAL_URL ? "" : "relay-unavailable",
    onlinePeerIds: [],
    currentInvite: null,
    creatingInvite: false,
    joiningInvite: false,
    activeSessionCount: 0
  });
  const openTabsRef = useRef([]);
  const tabAssetRevokersRef = useRef(new Map());
  const relayClientRef = useRef(null);
  const sessionsRef = useRef(new Map());
  const deviceIdentityRef = useRef(null);
  const pairedDevicesRef = useRef([]);
  const recoveryFileHandleRef = useRef(null);
  const recoveryFingerprintRef = useRef("");
  const onlinePeerIdsRef = useRef(new Set());
  const activeInviteRef = useRef("");
  const pairJoinAttemptRef = useRef("");
  const lastAutoSyncAtRef = useRef(0);
  const savingRef = useRef(false);
  const pendingSyncRef = useRef({
    force: false,
    peerId: "",
    reason: ""
  });
  const route = parseRoute();
  const activeRouteTab = getRouteTab(route);
  const activeTabKey = activeRouteTab?.key || "";
  const libraryFingerprint = buildUrlManifestFingerprint(library.papers);
  const pairedPeerIds = pairedDevices
    .map((record) => record.peerDeviceId)
    .filter(Boolean)
    .sort();
  const pairedPeerIdsKey = pairedPeerIds.join(",");

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    deviceIdentityRef.current = deviceIdentity;
  }, [deviceIdentity]);

  useEffect(() => {
    pairedDevicesRef.current = pairedDevices;
  }, [pairedDevices]);

  useEffect(() => {
    savingRef.current = saving;
    if (!saving) {
      void flushPendingNearbySync();
    }
  }, [saving]);

  useEffect(() => {
    void refreshLibrary();
    void loadSettings();

    const syncRoute = () => setRouteVersion((value) => value + 1);
    const handleInstalled = () => {
      void refreshStorageDiagnostics();
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        relayClientRef.current?.start();
        void triggerNearbySync("visible");
      }
    };

    window.addEventListener("popstate", syncRoute);
    window.addEventListener("appinstalled", handleInstalled);
    document.addEventListener("visibilitychange", handleVisible);

    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("appinstalled", handleInstalled);
      document.removeEventListener("visibilitychange", handleVisible);
      for (const revoke of tabAssetRevokersRef.current.values()) {
        revoke();
      }
      tabAssetRevokersRef.current.clear();
      relayClientRef.current?.stop();
      for (const session of sessionsRef.current.values()) {
        session.close();
      }
      sessionsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("launchQueue" in window)) {
      return;
    }

    window.launchQueue.setConsumer((launchParams) => {
      const targetUrl = launchParams?.targetURL;
      if (!(targetUrl instanceof URL) || targetUrl.origin !== window.location.origin) {
        return;
      }

      const nextUrl = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
      const currentUrl =
        `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (nextUrl === currentUrl) {
        setRouteVersion((value) => value + 1);
        return;
      }

      window.history.pushState({}, "", nextUrl);
      setRouteVersion((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (
      library.loading ||
      !recoveryFileState.enabled ||
      !recoveryFileHandleRef.current ||
      libraryFingerprint === recoveryFingerprintRef.current
    ) {
      return;
    }

    void mirrorRecoveryFile(library.papers);
  }, [library.loading, libraryFingerprint, recoveryFileState.enabled]);

  useEffect(() => {
    let cancelled = false;

    if (route.kind === "library") {
      setReader({ status: "idle", paper: null, error: "" });
      return undefined;
    }

    if (activeRouteTab) {
      const existingTab = openTabsRef.current.find((tab) => tab.key === activeRouteTab.key);
      updateOpenTabs((currentTabs) =>
        upsertReaderTab(currentTabs, {
          key: activeRouteTab.key,
          id: activeRouteTab.id,
          href: activeRouteTab.href,
          title: existingTab?.title || activeRouteTab.title,
          ...(existingTab?.paper
            ? {}
            : {
                status: "loading",
                error: "",
                paper: null
              })
        })
      );

      const nextTab = openTabsRef.current.find((tab) => tab.key === activeRouteTab.key);
      setReader(nextTab ? getReaderStateFromTab(nextTab) : { status: "loading", paper: null, error: "" });
    } else {
      setReader({ status: "loading", paper: null, error: "" });
    }

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

          revokeTabAssets(activeRouteTab?.key || "");
          if (activeRouteTab?.key) {
            tabAssetRevokersRef.current.set(activeRouteTab.key, offlineHtml.revoke);
          }

          const nextPaper = {
            ...record,
            title: normalizePaperTitle(record.title || metadata.title, record.id) || record.id,
            sanitizedHtml,
            mode: "saved",
            view: "html"
          };

          if (activeRouteTab) {
            updateOpenTabs((currentTabs) =>
              upsertReaderTab(currentTabs, {
                key: activeRouteTab.key,
                id: activeRouteTab.id,
                href: buildSavedPaperUrl(activeRouteTab.id),
                title: nextPaper.title || activeRouteTab.id,
                status: "ready",
                error: "",
                paper: nextPaper
              })
            );
          }

          setReader({
            status: "ready",
            error: "",
            paper: nextPaper
          });
          return;
        }

        const id = extractArxivIdFromIncoming(route.payload);
        if (!id) {
          throw new Error(
            "No arXiv identifier was found in the shared payload. Paste a valid arXiv URL or ID."
          );
        }

        const normalizedIncomingTitle = normalizePaperTitle(route.payload.title || "", id) || id;
        void fetchPaperTitleById(id, {
          fallbackTitle: normalizedIncomingTitle
        }).then((resolvedTitle) => {
          if (cancelled || !resolvedTitle) {
            return;
          }

          updateResolvedPaperTitle(id, resolvedTitle, {
            replaceableTitles: [normalizedIncomingTitle, id]
          });
        });

        const cachedTab = openTabsRef.current.find((tab) => tab.key === getPaperTabKey(id));
        if (cachedTab?.paper) {
          setReader(getReaderStateFromTab(cachedTab));
          return;
        }

        const sessionPaper = await fetchPaperById(id, {
          sourceUrl: route.payload.url || route.payload.text || "",
          titleHint: normalizedIncomingTitle
        });

        if (cancelled) {
          return;
        }

        if (sessionPaper.view === "pdf") {
          showToast("Rendered HTML unavailable. Opened PDF fallback.");
          const nextPaper = {
            ...sessionPaper,
            title: normalizePaperTitle(sessionPaper.titleHint, sessionPaper.id) || sessionPaper.id,
            mode: "session"
          };

          if (activeRouteTab) {
            updateOpenTabs((currentTabs) =>
              upsertReaderTab(currentTabs, {
                key: activeRouteTab.key,
                id: activeRouteTab.id,
                href: activeRouteTab.href,
                title: nextPaper.title || activeRouteTab.id,
                status: "ready",
                error: "",
                paper: nextPaper
              })
            );
          }

          setReader({
            status: "ready",
            error: "",
            paper: nextPaper
          });
          return;
        }

        let metadata;
        let sanitizedHtml;

        try {
          metadata = extractPaperMetadata(sessionPaper.html, sessionPaper.id);
          sanitizedHtml = sanitizePaperHtml(sessionPaper.html, {
            baseUrl: sessionPaper.ar5ivUrl
          });
        } catch (error) {
          const pdfFallback = buildPdfFallbackPaper(id, {
            sourceUrl: route.payload.url || route.payload.text || "",
            titleHint: normalizedIncomingTitle,
            reason: stringifyError(error)
          });

          showToast("Rendered HTML failed to open. Opened PDF fallback.");
          const nextPaper = {
            ...pdfFallback,
            title: normalizePaperTitle(pdfFallback.titleHint, pdfFallback.id) || pdfFallback.id,
            mode: "session"
          };

          if (activeRouteTab) {
            updateOpenTabs((currentTabs) =>
              upsertReaderTab(currentTabs, {
                key: activeRouteTab.key,
                id: activeRouteTab.id,
                href: activeRouteTab.href,
                title: nextPaper.title || activeRouteTab.id,
                status: "ready",
                error: "",
                paper: nextPaper
              })
            );
          }

          setReader({
            status: "ready",
            error: "",
            paper: nextPaper
          });
          return;
        }

        const nextPaper = {
          ...sessionPaper,
          title:
            normalizePaperTitle(metadata.title || sessionPaper.titleHint, sessionPaper.id) ||
            sessionPaper.id,
          sanitizedHtml,
          mode: "session"
        };

        if (activeRouteTab) {
          updateOpenTabs((currentTabs) =>
            upsertReaderTab(currentTabs, {
              key: activeRouteTab.key,
              id: activeRouteTab.id,
              href: activeRouteTab.href,
              title: nextPaper.title || activeRouteTab.id,
              status: "ready",
              error: "",
              paper: nextPaper
            })
          );
        }

        setReader({
          status: "ready",
          error: "",
          paper: nextPaper
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = stringifyError(error);

        if (activeRouteTab) {
          updateOpenTabs((currentTabs) =>
            upsertReaderTab(currentTabs, {
              key: activeRouteTab.key,
              id: activeRouteTab.id,
              href: activeRouteTab.href,
              title: activeRouteTab.title,
              status: "error",
              error: message,
              paper: null
            })
          );
        }

        setReader({
          status: "error",
          paper: null,
          error: message
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [routeVersion]);

  useEffect(() => {
    if (route.kind !== "receive") {
      return;
    }

    const incomingValue =
      route.payload.url || route.payload.text || route.payload.title || "";

    if (incomingValue) {
      setLibraryInput(incomingValue);
    }
  }, [route.kind, route.payload?.text, route.payload?.title, route.payload?.url]);

  useEffect(() => {
    if (!deviceIdentity) {
      return;
    }

    if (!NEARBY_SIGNAL_URL) {
      setNearbyState((current) => ({
        ...current,
        relayStatus: "unavailable",
        summaryStatus: "relay-unavailable"
      }));
      return;
    }

    if (!relayClientRef.current) {
      const relay = new NearbyRelayClient({
        url: NEARBY_SIGNAL_URL,
        deviceId: deviceIdentity.deviceId,
        label: deviceIdentity.label,
        appVersion: APP_VERSION
      });
      relay.addEventListener("status", handleRelayStatus);
      relay.addEventListener("message", handleRelayMessage);
      relayClientRef.current = relay;
    }

    relayClientRef.current.setIdentity(deviceIdentity);
    relayClientRef.current.start();
  }, [deviceIdentity?.deviceId, deviceIdentity?.label]);

  useEffect(() => {
    if (!deviceIdentity || !relayClientRef.current) {
      return;
    }

    relayClientRef.current.setPeerIds(pairedPeerIds);
  }, [deviceIdentity?.deviceId, pairedPeerIdsKey]);

  useEffect(() => {
    if (!deviceIdentity || !route.pairInviteId || !relayClientRef.current) {
      return;
    }

    if (nearbyState.relayStatus !== "connected") {
      return;
    }

    if (pairJoinAttemptRef.current === route.pairInviteId) {
      return;
    }

    void handleJoinInvite(route.pairInviteId);
  }, [deviceIdentity?.deviceId, nearbyState.relayStatus, route.pairInviteId]);

  const receiveMessage =
    route.kind === "receive" && reader.status === "error" ? reader.error : "";
  const defaultInput =
    route.kind === "receive"
      ? route.payload.url || route.payload.text || route.payload.title || libraryInput
      : libraryInput;

  async function refreshLibrary() {
    const papers = await listPapers().catch((error) => {
      console.error("Library load failed", error);
      setToast("Failed to load the local library.");
      return [];
    });

    setLibrary({ loading: false, papers });
  }

  function applyStorageDiagnostics(value) {
    setStorageDiagnostics(normalizeStorageDiagnostics(value));
  }

  async function refreshStorageDiagnostics() {
    const diagnostics = normalizeStorageDiagnostics(await ensurePersistentStorage());
    setStorageDiagnostics(diagnostics);
    await setSetting(SETTING_KEYS.storageDiagnostics, diagnostics);
    return diagnostics;
  }

  async function persistRecoveryFileState(value) {
    const normalized = normalizeRecoveryFileState(value);
    setRecoveryFileState(normalized);
    await setSetting(SETTING_KEYS.recoveryFileState, normalized);
    return normalized;
  }

  async function clearRecoveryFile(reason = "") {
    recoveryFileHandleRef.current = null;
    recoveryFingerprintRef.current = "";
    await setSetting(SETTING_KEYS.recoveryFileHandle, null);
    await persistRecoveryFileState({
      supported: isRecoveryFileSupported(),
      enabled: false,
      permission: reason || "unknown",
      lastWrittenAt: "",
      filename: ""
    });
  }

  async function refreshRecoveryFilePermission() {
    const handle = recoveryFileHandleRef.current;
    if (!handle) {
      return persistRecoveryFileState({
        ...recoveryFileState,
        supported: isRecoveryFileSupported(),
        enabled: false,
        permission: "unknown"
      });
    }

    const permission = await getRecoveryFilePermission(handle);
    return persistRecoveryFileState({
      ...recoveryFileState,
      supported: isRecoveryFileSupported(),
      enabled: permission === "granted" && normalizeRecoveryFileState(recoveryFileState).enabled,
      permission,
      filename: String(handle.name || recoveryFileState.filename || "").trim()
    });
  }

  async function mirrorRecoveryFile(papers, { showSuccessToast = false } = {}) {
    const handle = recoveryFileHandleRef.current;
    if (!handle) {
      return false;
    }

    const permission = await getRecoveryFilePermission(handle);
    if (permission !== "granted") {
      await clearRecoveryFile(permission);
      showToast("Recovery file access was lost. Re-enable it to keep backups updated.");
      return false;
    }

    try {
      const manifest = buildUrlManifest(papers, APP_VERSION);
      const nextFingerprint = buildUrlManifestFingerprint(papers);
      const writeResult = await writeRecoveryFile(handle, manifest);
      recoveryFingerprintRef.current = nextFingerprint;
      await persistRecoveryFileState({
        supported: isRecoveryFileSupported(),
        enabled: true,
        permission,
        lastWrittenAt: writeResult.lastWrittenAt,
        filename: writeResult.filename
      });
      if (showSuccessToast) {
        showToast("Recovery file will stay updated on this device.");
      }
      return true;
    } catch (error) {
      console.error("Failed to mirror recovery file", error);
      if (isPermissionError(error)) {
        await clearRecoveryFile("denied");
        showToast("Recovery file access was lost. Re-enable it to keep backups updated.");
        return false;
      }

      showToast("Recovery file update failed.");
      return false;
    }
  }

  async function refreshPairedDevices() {
    const nextPairs = await listPairedDevices().catch(() => []);
    setPairedDevices(nextPairs);
    return nextPairs;
  }

  async function loadSettings() {
    try {
      const [
        fallbackSetting,
        nextIdentity,
        storedStorageDiagnostics,
        storedRecoveryFileState,
        storedRecoveryFileHandle
      ] = await Promise.all([
        getSetting(SETTING_KEYS.pdfFallbackNoticeEnabled),
        getOrCreateDeviceIdentity(),
        getSetting(SETTING_KEYS.storageDiagnostics),
        getSetting(SETTING_KEYS.recoveryFileState),
        getSetting(SETTING_KEYS.recoveryFileHandle)
      ]);

      setFallbackNoticeEnabled(fallbackSetting?.value !== false);
      setDeviceIdentity(nextIdentity);
      applyStorageDiagnostics(storedStorageDiagnostics?.value);
      recoveryFileHandleRef.current = storedRecoveryFileHandle?.value || null;
      setRecoveryFileState(normalizeRecoveryFileState(storedRecoveryFileState?.value));
      await refreshPairedDevices();
      await refreshStorageDiagnostics();
      await refreshRecoveryFilePermission();
      void triggerNearbySync("startup");
    } catch (error) {
      console.error("Settings load failed", error);
    }
  }

  function navigate(nextUrl) {
    window.history.pushState({}, "", nextUrl);
    setRouteVersion((value) => value + 1);
  }

  function updateOpenTabs(updater) {
    const nextTabs =
      typeof updater === "function" ? updater(openTabsRef.current) : updater;
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
  }

  function updateResolvedPaperTitle(paperId, nextTitle, { replaceableTitles = [] } = {}) {
    const normalizedNextTitle = normalizePaperTitle(nextTitle, paperId);
    if (!normalizedNextTitle) {
      return;
    }

    updateOpenTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.id !== paperId) {
          return tab;
        }

        const currentTitle = tab.paper?.title || tab.title || tab.id;
        if (
          !shouldReplacePaperTitle(currentTitle, normalizedNextTitle, paperId, replaceableTitles)
        ) {
          return tab;
        }

        return {
          ...tab,
          title: normalizedNextTitle,
          paper: tab.paper
            ? {
                ...tab.paper,
                title: normalizedNextTitle
              }
            : tab.paper
        };
      })
    );

    setReader((current) => {
      if (!current.paper || current.paper.id !== paperId) {
        return current;
      }

      if (
        !shouldReplacePaperTitle(
          current.paper.title,
          normalizedNextTitle,
          paperId,
          replaceableTitles
        )
      ) {
        return current;
      }

      return {
        ...current,
        paper: {
          ...current.paper,
          title: normalizedNextTitle
        }
      };
    });
  }

  function revokeTabAssets(tabKey) {
    if (!tabKey) {
      return;
    }

    const revoke = tabAssetRevokersRef.current.get(tabKey);
    if (!revoke) {
      return;
    }

    revoke();
    tabAssetRevokersRef.current.delete(tabKey);
  }

  function switchToTab(tabKey) {
    const tab = openTabsRef.current.find((entry) => entry.key === tabKey);
    if (!tab) {
      return;
    }

    navigate(tab.href || buildSavedPaperUrl(tab.id));
  }

  function closeTab(tabKey) {
    const currentTabs = openTabsRef.current;
    const nextTabs = currentTabs.filter((tab) => tab.key !== tabKey);
    if (nextTabs.length === currentTabs.length) {
      return;
    }

    revokeTabAssets(tabKey);
    updateOpenTabs(nextTabs);

    if (getRouteTab(parseRoute())?.key !== tabKey) {
      return;
    }

    if (!nextTabs.length) {
      navigate("/");
      return;
    }

    navigate(nextTabs[0].href || buildSavedPaperUrl(nextTabs[0].id));
  }

  function showToast(message) {
    setToast(message);
  }

  async function disableFallbackNotice() {
    setFallbackNoticeEnabled(false);
    try {
      await setSetting(SETTING_KEYS.pdfFallbackNoticeEnabled, false);
    } catch (error) {
      console.error("Failed to persist PDF fallback notice preference", error);
      showToast("Could not save the PDF fallback notice setting.");
    }
  }

  function openReceiveInput(value) {
    const trimmed = value.trim();
    if (!trimmed) {
      setToast("Paste an arXiv URL or ID first.");
      return;
    }

    setLibraryInput(trimmed);
    const target = new URL("/receive", window.location.origin);
    target.searchParams.set("url", trimmed);
    navigate(`${target.pathname}${target.search}`);
  }

  async function handleSave() {
    if (!reader.paper || reader.paper.mode !== "session" || reader.paper.view !== "html") {
      if (reader.paper?.view === "pdf") {
        showToast("PDF fallback sessions cannot be saved offline yet.");
      }
      return;
    }

    setSaving(true);
    try {
      await refreshStorageDiagnostics();
      await savePaper(reader.paper, {
        deviceId: deviceIdentityRef.current?.deviceId || "local"
      });
      await refreshLibrary();
      await refreshStorageDiagnostics();
      const savedPaper = {
        ...reader.paper,
        mode: "saved"
      };
      updateOpenTabs((currentTabs) =>
        upsertReaderTab(currentTabs, {
          key: getPaperTabKey(reader.paper.id),
          id: reader.paper.id,
          href: buildSavedPaperUrl(reader.paper.id),
          title: savedPaper.title || reader.paper.id,
          status: "ready",
          error: "",
          paper: savedPaper
        })
      );
      setReader({
        status: "ready",
        error: "",
        paper: savedPaper
      });
      showToast("Saved for offline reading.");
      navigate(buildSavedPaperUrl(reader.paper.id));
      void triggerNearbySync("save", {
        force: true
      });
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
      await deletePaper(paperId, {
        deviceId: deviceIdentityRef.current?.deviceId || "local"
      });
      await refreshLibrary();
      await refreshStorageDiagnostics();
      closeTab(getPaperTabKey(paperId));
      showToast("Removed from library.");
      void triggerNearbySync("delete");
    } catch (error) {
      showToast(stringifyError(error));
    }
  }

  async function handleExportLibrary() {
    try {
      const blob = await exportLibraryBackup();
      downloadBlob(blob, `ar5iv-reader-backup-${new Date().toISOString().slice(0, 10)}.json`);
      showToast("Downloaded full library backup.");
    } catch (error) {
      showToast(stringifyError(error));
    }
  }

  async function handleExportUrls() {
    try {
      const blob = await exportLibraryUrlManifest(APP_VERSION);
      downloadBlob(blob, buildUrlManifestFilename());
      showToast("Downloaded URL recovery file.");
    } catch (error) {
      showToast(stringifyError(error));
    }
  }

  async function handleImportLibrary(file) {
    setBackupImporting(true);
    try {
      await refreshStorageDiagnostics();
      await importLibraryBackup(file);
      await refreshLibrary();
      await refreshStorageDiagnostics();
      setRouteVersion((value) => value + 1);
      showToast("Imported library backup.");
      void triggerNearbySync("import");
    } catch (error) {
      showToast(stringifyError(error));
    } finally {
      setBackupImporting(false);
    }
  }

  async function handleImportUrls(file) {
    setUrlImporting(true);
    setRestoreStatus(createDefaultRestoreStatus());

    try {
      await refreshStorageDiagnostics();
      const manifest = await importLibraryUrlManifest(file);
      const result = await restoreFromUrlManifest(manifest, {
        deviceId: deviceIdentityRef.current?.deviceId || "local",
        concurrency: 2,
        onProgress: (progress) => {
          setRestoreStatus({
            active: progress.completed < progress.total,
            total: progress.total,
            completed: progress.completed,
            currentId: progress.currentId,
            result: progress.result
          });
        }
      });

      await refreshLibrary();
      await refreshStorageDiagnostics();
      setRouteVersion((value) => value + 1);
      setRestoreStatus({
        active: false,
        total: manifest.papers.length,
        completed: manifest.papers.length,
        currentId: "",
        result
      });

      if (result.restoredIds.length) {
        void triggerNearbySync("import", {
          force: true
        });
      }

      showToast(
        `Restored ${result.restoredIds.length}, skipped ${result.skippedIds.length}, failed ${result.failed.length}.`
      );
    } catch (error) {
      setRestoreStatus(createDefaultRestoreStatus());
      showToast(stringifyError(error));
    } finally {
      setUrlImporting(false);
    }
  }

  async function handleEnableRecoveryFile() {
    if (!isRecoveryFileSupported()) {
      showToast("Recovery files are not supported in this browser.");
      return;
    }

    try {
      const handle = await createRecoveryFileHandle();
      const permission = handle.requestPermission
        ? await handle.requestPermission({
            mode: "readwrite"
          })
        : "granted";

      if (permission !== "granted") {
        throw new Error("Recovery file permission was not granted.");
      }

      recoveryFileHandleRef.current = handle;
      recoveryFingerprintRef.current = "";
      await setSetting(SETTING_KEYS.recoveryFileHandle, handle);
      await persistRecoveryFileState({
        supported: true,
        enabled: true,
        permission,
        lastWrittenAt: recoveryFileState.lastWrittenAt,
        filename: String(handle.name || recoveryFileState.filename || "").trim()
      });
      await mirrorRecoveryFile(library.papers, {
        showSuccessToast: true
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }

      console.error("Failed to enable recovery file", error);
      showToast(stringifyError(error));
    }
  }

  async function handleRelayStatus(event) {
    const relayStatus = event.detail;
    setNearbyState((current) => ({
      ...current,
      relayStatus,
      summaryStatus:
        relayStatus === "connected"
          ? current.summaryStatus === "relay-unavailable"
            ? ""
            : current.summaryStatus
          : relayStatus === "error"
            ? "relay-unavailable"
            : current.summaryStatus
    }));
  }

  async function handleRelayMessage(event) {
    const message = event.detail;

    if (message.type === "peer-online") {
      onlinePeerIdsRef.current.add(message.peerDeviceId);
      setNearbyState((current) => ({
        ...current,
        onlinePeerIds: [...onlinePeerIdsRef.current].sort(),
        summaryStatus: current.summaryStatus === "syncing" ? current.summaryStatus : ""
      }));
      await touchPairedDevice(message.peerDeviceId, {
        peerLabel: message.peerLabel,
        lastSeenAt: Date.now()
      });
      await refreshPairedDevices();
      void triggerNearbySync("peer-online", {
        peerId: message.peerDeviceId
      });
      return;
    }

    if (message.type === "peer-offline") {
      onlinePeerIdsRef.current.delete(message.peerDeviceId);
      setNearbyState((current) => ({
        ...current,
        onlinePeerIds: [...onlinePeerIdsRef.current].sort(),
        summaryStatus:
          current.activeSessionCount > 0
            ? current.summaryStatus
            : onlinePeerIdsRef.current.size
              ? ""
              : "no-peer"
      }));
      return;
    }

    if (message.type === "invite-created") {
      activeInviteRef.current = message.inviteId;
      setNearbyState((current) => ({
        ...current,
        currentInvite: {
          inviteId: message.inviteId,
          expiresAt: message.expiresAt,
          link: buildPairInviteLink(message.inviteId)
        },
        creatingInvite: false,
        joiningInvite: false
      }));
      return;
    }

    if (message.type === "invite-joined") {
      pairJoinAttemptRef.current = "";
      setNearbyState((current) => ({
        ...current,
        joiningInvite: false
      }));
      if (new URL(window.location.href).searchParams.get("pair") === message.inviteId) {
        clearPairQueryParam();
      }

      if (activeInviteRef.current === message.inviteId) {
        activeInviteRef.current = "";
        void startPairSession(
          {
            deviceId: message.peerDeviceId,
            label: message.peerLabel
          },
          { initiator: true }
        );
      }
      return;
    }

    if (message.type === "signal") {
      void handleIncomingSignal(message);
      return;
    }

    if (message.type === "error") {
      pairJoinAttemptRef.current = "";
      if (new URL(window.location.href).searchParams.get("pair")) {
        clearPairQueryParam();
      }

      setNearbyState((current) => ({
        ...current,
        creatingInvite: false,
        joiningInvite: false,
        summaryStatus:
          message.code === "invite_not_found" ? "pairing-expired" : current.summaryStatus
      }));

      if (message.code === "invite_not_found") {
        showToast("That nearby pairing code has expired.");
      }
    }
  }

  async function createInvite() {
    if (!NEARBY_SIGNAL_URL || !relayClientRef.current) {
      setNearbyState((current) => ({
        ...current,
        summaryStatus: "relay-unavailable"
      }));
      return;
    }

    setNearbyState((current) => ({
      ...current,
      creatingInvite: true,
      currentInvite: null
    }));

    try {
      await relayClientRef.current.waitForConnected();
      const sent = relayClientRef.current.createInvite();
      if (!sent) {
        throw new Error("Nearby relay unavailable.");
      }
    } catch (error) {
      console.error("Failed to create nearby invite", error);
      setNearbyState((current) => ({
        ...current,
        creatingInvite: false,
        currentInvite: null,
        summaryStatus: "relay-unavailable"
      }));
      showToast(stringifyError(error));
    }
  }

  function closeInvite() {
    activeInviteRef.current = "";
    setNearbyState((current) => ({
      ...current,
      creatingInvite: false,
      currentInvite: null
    }));
  }

  async function triggerNearbySync(reason, { force = false, peerId = "" } = {}) {
    if (!NEARBY_SIGNAL_URL || !relayClientRef.current || !deviceIdentityRef.current) {
      setNearbyState((current) => ({
        ...current,
        summaryStatus: "relay-unavailable"
      }));
      return false;
    }

    if (savingRef.current) {
      if (shouldRetrySync(reason, force)) {
        queueNearbySync(reason, { force, peerId });
      }
      return false;
    }

    relayClientRef.current.start();

    if (!force && Date.now() - lastAutoSyncAtRef.current < AUTO_SYNC_INTERVAL_MS) {
      return false;
    }

    lastAutoSyncAtRef.current = Date.now();

    const targetPeerIds = peerId
      ? [peerId]
      : [...onlinePeerIdsRef.current].filter((entry) =>
          pairedDevicesRef.current.some((record) => record.peerDeviceId === entry)
        );

    if (!targetPeerIds.length) {
      setNearbyState((current) => ({
        ...current,
        summaryStatus: "no-peer"
      }));
      if (shouldRetrySync(reason, force)) {
        queueNearbySync(reason, { force, peerId });
      }
      return false;
    }

    let started = false;

    for (const nextPeerId of targetPeerIds) {
      if (hasActiveSession(nextPeerId)) {
        if (shouldRetrySync(reason, force)) {
          queueNearbySync(reason, {
            force,
            peerId: nextPeerId
          });
        }
        continue;
      }

      if (deviceIdentityRef.current.deviceId < nextPeerId) {
        started = true;
        void startSyncSession(nextPeerId, { initiator: true });
        continue;
      }

      const sent = relayClientRef.current.sendSignal(nextPeerId, crypto.randomUUID(), {
        type: "sync-request",
        mode: "sync"
      });
      if (sent) {
        started = true;
      } else if (shouldRetrySync(reason, force)) {
        queueNearbySync(reason, {
          force,
          peerId: nextPeerId
        });
      }
    }

    if (started) {
      setNearbyState((current) => ({
        ...current,
        summaryStatus: "syncing"
      }));
      return true;
    }

    return false;
  }

  function queueNearbySync(reason, { force = false, peerId = "" } = {}) {
    const pending = pendingSyncRef.current;
    pendingSyncRef.current = {
      reason: pending.reason || reason,
      force: pending.force || force,
      peerId: pending.peerId || peerId
    };
  }

  async function flushPendingNearbySync() {
    const pending = pendingSyncRef.current;
    if (!pending.reason) {
      return false;
    }

    pendingSyncRef.current = {
      force: false,
      peerId: "",
      reason: ""
    };

    return triggerNearbySync(pending.reason, {
      force: pending.force,
      peerId: pending.peerId
    });
  }

  function shouldRetrySync(reason, force) {
    if (force) {
      return true;
    }

    return ["delete", "import", "pairing", "save"].includes(reason);
  }

  async function handleIncomingSignal(message) {
    const existingSession = sessionsRef.current.get(message.sessionId);
    if (existingSession) {
      await existingSession.handleSignal(message.payload);
      return;
    }

    if (message.payload?.type === "sync-request") {
      if (deviceIdentityRef.current?.deviceId < message.fromDeviceId && !hasActiveSession(message.fromDeviceId)) {
        void startSyncSession(message.fromDeviceId, { initiator: true });
      }
      return;
    }

    if (!["offer", "answer", "candidate"].includes(message.payload?.type)) {
      return;
    }

    const mode = message.payload.mode || "sync";
    if (mode === "sync") {
      const pairRecord = await getPairedDevice(message.fromDeviceId);
      if (!pairRecord) {
        return;
      }

      const session = createSession(message.sessionId, message.fromDeviceId, {
        initiator: false,
        mode: "sync"
      });
      void runSyncSession(session, pairRecord);
      await session.handleSignal(message.payload);
      return;
    }

    const session = createSession(message.sessionId, message.fromDeviceId, {
      initiator: false,
      mode: "pair"
    });
    void runPairingSession(session, {
      deviceId: message.fromDeviceId,
      label:
        pairedDevicesRef.current.find((entry) => entry.peerDeviceId === message.fromDeviceId)?.peerLabel ||
        "Nearby device"
    });
    await session.handleSignal(message.payload);
  }

  function createSession(sessionId, remoteDeviceId, { initiator, mode }) {
    const session = new NearbyWebRtcSession({
      sessionId,
      remoteDeviceId,
      relayClient: relayClientRef.current,
      initiator,
      mode
    });

    sessionsRef.current.set(sessionId, session);
    setNearbyState((current) => ({
      ...current,
      activeSessionCount: current.activeSessionCount + 1,
      summaryStatus: "syncing"
    }));

    session.addEventListener("close", () => {
      sessionsRef.current.delete(sessionId);
      setNearbyState((current) => ({
        ...current,
        activeSessionCount: Math.max(0, current.activeSessionCount - 1),
        summaryStatus:
          sessionsRef.current.size > 0
            ? "syncing"
            : onlinePeerIdsRef.current.size
              ? ""
              : current.summaryStatus === "relay-unavailable"
                ? current.summaryStatus
                : "no-peer"
      }));
      if (!sessionsRef.current.size) {
        void flushPendingNearbySync();
      }
    });

    void session.start();
    return session;
  }

  async function startPairSession(remoteDevice, { initiator }) {
    if (hasActiveSession(remoteDevice.deviceId)) {
      return;
    }

    const session = createSession(crypto.randomUUID(), remoteDevice.deviceId, {
      initiator,
      mode: "pair"
    });
    await runPairingSession(session, remoteDevice);
  }

  async function runPairingSession(session, remoteDevice) {
    try {
      const pairRecord = await runPairSession(session, {
        localDevice: deviceIdentityRef.current,
        onPaired: async ({ pairSecret, remoteDevice: incomingRemote }) => {
          const mergedRemote = {
            ...remoteDevice,
            ...incomingRemote
          };
          const existing = await getPairedDevice(mergedRemote.deviceId);
          const nextPair = await pairDevices(
            deviceIdentityRef.current,
            mergedRemote,
            pairSecret || existing?.pairSecret || ""
          );
          return nextPair;
        }
      });
      await refreshPairedDevices();
      setNearbyState((current) => ({
        ...current,
        summaryStatus: "paired"
      }));
      showToast(`Paired with ${remoteDevice.label || "nearby device"}.`);
      void triggerNearbySync("pairing", {
        force: true,
        peerId: pairRecord.peerDeviceId
      });
    } catch (error) {
      console.error("Nearby pairing failed", error);
      setNearbyState((current) => ({
        ...current,
        summaryStatus: "failed"
      }));
    }
  }

  async function startSyncSession(peerDeviceId, { initiator }) {
    const pairRecord = pairedDevicesRef.current.find((record) => record.peerDeviceId === peerDeviceId);
    if (!pairRecord) {
      return;
    }

    const session = createSession(crypto.randomUUID(), peerDeviceId, {
      initiator,
      mode: "sync"
    });
    await runSyncSession(session, pairRecord);
  }

  async function runSyncSession(session, pairRecord) {
    try {
      const result = await runLibrarySyncSession(session, {
        pairRecord
      });
      await touchPairedDevice(pairRecord.peerDeviceId, {
        lastSeenAt: Date.now(),
        lastSyncedAt: Date.now(),
        lastSyncStatus: "synced"
      });
      await refreshPairedDevices();
      if (result.pulledCount) {
        await refreshLibrary();
        if (parseRoute().kind === "saved-paper") {
          setRouteVersion((value) => value + 1);
        }
      }
      setNearbyState((current) => ({
        ...current,
        summaryStatus: onlinePeerIdsRef.current.size ? "" : "no-peer"
      }));
    } catch (error) {
      console.error("Nearby sync failed", error);
      await touchPairedDevice(pairRecord.peerDeviceId, {
        lastSeenAt: Date.now(),
        lastSyncStatus: "failed"
      });
      await refreshPairedDevices();
      setNearbyState((current) => ({
        ...current,
        summaryStatus: "failed"
      }));
    }
  }

  function hasActiveSession(peerDeviceId) {
    for (const session of sessionsRef.current.values()) {
      if (session.remoteDeviceId === peerDeviceId) {
        return true;
      }
    }

    return false;
  }

  async function handleCopyInviteLink() {
    if (!nearbyState.currentInvite?.link) {
      return;
    }

    try {
      await navigator.clipboard.writeText(nearbyState.currentInvite.link);
      showToast("Copied fallback pairing link.");
    } catch {
      showToast("Clipboard copy failed.");
    }
  }

  async function handleJoinInvite(value) {
    const inviteId = extractInviteId(value);
    if (!inviteId) {
      showToast("Enter a valid nearby pairing code.");
      return false;
    }

    if (!NEARBY_SIGNAL_URL || !relayClientRef.current) {
      setNearbyState((current) => ({
        ...current,
        summaryStatus: "relay-unavailable"
      }));
      showToast("Nearby relay unavailable.");
      return false;
    }

    pairJoinAttemptRef.current = inviteId;
    setNearbyState((current) => ({
      ...current,
      joiningInvite: true,
      summaryStatus: ""
    }));

    try {
      await relayClientRef.current.waitForConnected();
      const sent = relayClientRef.current.joinInvite(inviteId);
      if (!sent) {
        throw new Error("Nearby relay unavailable.");
      }

      return true;
    } catch (error) {
      pairJoinAttemptRef.current = "";
      setNearbyState((current) => ({
        ...current,
        joiningInvite: false,
        summaryStatus: current.relayStatus === "error" ? "relay-unavailable" : current.summaryStatus
      }));
      showToast(stringifyError(error));
      return false;
    }
  }

  async function handleRenameThisDevice() {
    const nextLabel = window.prompt("Rename this device", deviceIdentityRef.current?.label || "");
    if (!nextLabel?.trim()) {
      return;
    }

    try {
      const nextIdentity = await updateDeviceIdentityLabel(nextLabel.trim());
      setDeviceIdentity(nextIdentity);
    } catch (error) {
      showToast(stringifyError(error));
    }
  }

  async function handleRenamePeer(peerDeviceId) {
    const existing = pairedDevicesRef.current.find((record) => record.peerDeviceId === peerDeviceId);
    if (!existing) {
      return;
    }

    const nextLabel = window.prompt("Rename paired device", existing.peerLabel);
    if (!nextLabel?.trim()) {
      return;
    }

    try {
      await renamePairedDevice(peerDeviceId, nextLabel.trim());
      await refreshPairedDevices();
    } catch (error) {
      showToast(stringifyError(error));
    }
  }

  async function handleForgetPeer(peerDeviceId) {
    const existing = pairedDevicesRef.current.find((record) => record.peerDeviceId === peerDeviceId);
    if (!existing) {
      return;
    }

    if (!window.confirm(`Forget ${existing.peerLabel}?`)) {
      return;
    }

    await forgetPairedDevice(peerDeviceId);
    onlinePeerIdsRef.current.delete(peerDeviceId);
    await refreshPairedDevices();
    setNearbyState((current) => ({
      ...current,
      onlinePeerIds: [...onlinePeerIdsRef.current].sort()
    }));
  }

  const showReader = route.kind !== "library" && (reader.status === "loading" || Boolean(activeTabKey));

  return (
    <main className="app-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      {showReader ? (
        <ReaderView
          tabs={openTabs}
          activeTabKey={activeTabKey}
          paper={reader.paper}
          busy={saving}
          error={reader.error}
          fallbackNoticeEnabled={fallbackNoticeEnabled}
          onSelectTab={switchToTab}
          onCloseTab={closeTab}
          onBack={() => navigate("/")}
          onDisableFallbackNotice={disableFallbackNotice}
          onSave={handleSave}
          onExport={() => handleExportPaper(reader.paper.id)}
          onDelete={() => handleDeletePaper(reader.paper.id)}
          showToast={showToast}
        />
      ) : (
        <LibraryView
          papers={library.papers}
          loading={library.loading}
          backupImporting={backupImporting}
          urlImporting={urlImporting}
          receiveMessage={receiveMessage}
          defaultInput={defaultInput}
          storageDiagnostics={storageDiagnostics}
          restoreStatus={restoreStatus}
          recoveryFileState={recoveryFileState}
          deviceIdentity={deviceIdentity}
          pairedDevices={pairedDevices}
          nearbyState={nearbyState}
          pairRouteInviteId={route.pairInviteId}
          onEnableRecoveryFile={handleEnableRecoveryFile}
          onCreateInvite={createInvite}
          onCloseInvite={closeInvite}
          onJoinInvite={handleJoinInvite}
          onCopyInviteLink={handleCopyInviteLink}
          onRenameThisDevice={handleRenameThisDevice}
          onRenamePeer={handleRenamePeer}
          onForgetPeer={handleForgetPeer}
          onSyncNow={() => triggerNearbySync("manual", { force: true })}
          onClearInput={() => setLibraryInput("")}
          onSubmitUrl={openReceiveInput}
          onOpenPaper={(paperId) => navigate(`/?paper=${encodeURIComponent(paperId)}`)}
          onExportPaper={handleExportPaper}
          onDeletePaper={handleDeletePaper}
          onExportLibrary={handleExportLibrary}
          onExportUrls={handleExportUrls}
          onImportFile={handleImportLibrary}
          onImportUrlFile={handleImportUrls}
          formatPairSyncStatus={formatPairSyncStatus}
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
  const pairInviteId =
    extractInviteId(url.searchParams.get("pair")) ||
    extractProtocolPairId(url.searchParams.get("protocol"));

  if (pathname === "/receive") {
    const protocolPayload = parseProtocolPayload(url.searchParams.get("protocol"));
    return {
      kind: "receive",
      paperId: "",
      pairInviteId,
      payload: {
        url: url.searchParams.get("url") || protocolPayload.url || "",
        text: url.searchParams.get("text") || protocolPayload.text || "",
        title: url.searchParams.get("title") || protocolPayload.title || ""
      }
    };
  }

  if (paperId) {
    return {
      kind: "saved-paper",
      paperId,
      pairInviteId,
      payload: null
    };
  }

  return {
    kind: "library",
    paperId: "",
    pairInviteId,
    payload: null
  };
}

function shouldReplacePaperTitle(currentTitle, nextTitle, paperId, replaceableTitles = []) {
  const normalizedCurrent = normalizePaperTitle(currentTitle, paperId);
  const normalizedNext = normalizePaperTitle(nextTitle, paperId);
  if (!normalizedNext || normalizedCurrent === normalizedNext) {
    return false;
  }

  const replaceable = new Set(
    replaceableTitles
      .map((value) => normalizePaperTitle(value, paperId))
      .filter(Boolean)
  );

  return !normalizedCurrent || normalizedCurrent === paperId || replaceable.has(normalizedCurrent);
}

function extractProtocolPairId(protocolValue) {
  return extractInviteId(parseProtocolPayload(protocolValue).pair);
}

function parseProtocolPayload(protocolValue) {
  const rawValue = String(protocolValue || "").trim();
  if (!rawValue) {
    return {
      pair: "",
      text: "",
      title: "",
      url: ""
    };
  }

  try {
    const protocolUrl = new URL(rawValue);
    return {
      pair: protocolUrl.searchParams.get("pair") || "",
      text: protocolUrl.searchParams.get("text") || "",
      title: protocolUrl.searchParams.get("title") || "",
      url: protocolUrl.searchParams.get("url") || ""
    };
  } catch {
    return {
      pair: "",
      text: "",
      title: "",
      url: ""
    };
  }
}

function buildPairInviteLink(inviteId) {
  const url = new URL(window.location.origin);
  url.searchParams.set("pair", inviteId);
  return url.toString();
}

function getRouteTab(route) {
  if (route.kind === "saved-paper" && route.paperId) {
    return {
      key: getPaperTabKey(route.paperId),
      id: route.paperId,
      href: buildSavedPaperUrl(route.paperId),
      title: route.paperId
    };
  }

  if (route.kind !== "receive") {
    return null;
  }

  const paperId = extractArxivIdFromIncoming(route.payload);
  if (!paperId) {
    return null;
  }

  return {
    key: getPaperTabKey(paperId),
    id: paperId,
    href: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    title: normalizePaperTitle(route.payload.title || "", paperId) || paperId
  };
}

function getPaperTabKey(paperId) {
  return paperId ? `paper:${paperId}` : "";
}

function buildSavedPaperUrl(paperId) {
  return `/?paper=${encodeURIComponent(paperId)}`;
}

function upsertReaderTab(currentTabs, nextTab) {
  const existingTab = currentTabs.find((tab) => tab.key === nextTab.key);
  const mergedTab = {
    ...(existingTab || {}),
    ...nextTab
  };

  return [mergedTab, ...currentTabs.filter((tab) => tab.key !== nextTab.key)];
}

function getReaderStateFromTab(tab) {
  return {
    status: tab.status || (tab.paper ? "ready" : "idle"),
    paper: tab.paper || null,
    error: tab.error || ""
  };
}

function clearPairQueryParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("pair")) {
    return;
  }

  url.searchParams.delete("pair");
  const nextSearch = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function stringifyError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
