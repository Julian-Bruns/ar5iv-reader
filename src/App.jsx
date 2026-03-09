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
  setSetting
} from "./lib/db";
import {
  downloadBlob,
  exportLibraryBackup,
  exportPaperHtml,
  importLibraryBackup
} from "./lib/exportImport";
import { buildPdfFallbackPaper, fetchPaperById } from "./lib/fetchPaper";
import { rewriteHtmlAssetUrls } from "./lib/assets";
import { extractArxivIdFromIncoming } from "./lib/arxiv";
import { extractPaperMetadata, sanitizePaperHtml } from "./lib/sanitizePaper";
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
  const [toast, setToast] = useState("");
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [libraryInput, setLibraryInput] = useState("");
  const [fallbackNoticeEnabled, setFallbackNoticeEnabled] = useState(true);
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
  const revokeAssetsRef = useRef(() => {});
  const relayClientRef = useRef(null);
  const sessionsRef = useRef(new Map());
  const deviceIdentityRef = useRef(null);
  const pairedDevicesRef = useRef([]);
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
  const pairedPeerIds = pairedDevices
    .map((record) => record.peerDeviceId)
    .filter(Boolean)
    .sort();
  const pairedPeerIdsKey = pairedPeerIds.join(",");

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
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        relayClientRef.current?.start();
        void triggerNearbySync("visible");
      }
    };

    window.addEventListener("popstate", syncRoute);
    document.addEventListener("visibilitychange", handleVisible);

    return () => {
      window.removeEventListener("popstate", syncRoute);
      document.removeEventListener("visibilitychange", handleVisible);
      revokeAssetsRef.current();
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
    let cancelled = false;

    revokeAssetsRef.current();
    revokeAssetsRef.current = () => {};

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
              mode: "saved",
              view: "html"
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

        if (cancelled) {
          return;
        }

        if (sessionPaper.view === "pdf") {
          showToast("Rendered HTML unavailable. Opened PDF fallback.");
          setReader({
            status: "ready",
            error: "",
            paper: {
              ...sessionPaper,
              title: sessionPaper.titleHint || sessionPaper.id,
              mode: "session"
            }
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
            titleHint: route.payload.title || "",
            reason: stringifyError(error)
          });

          showToast("Rendered HTML failed to open. Opened PDF fallback.");
          setReader({
            status: "ready",
            error: "",
            paper: {
              ...pdfFallback,
              title: pdfFallback.titleHint || pdfFallback.id,
              mode: "session"
            }
          });
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

  async function refreshPairedDevices() {
    const nextPairs = await listPairedDevices().catch(() => []);
    setPairedDevices(nextPairs);
    return nextPairs;
  }

  async function loadSettings() {
    try {
      const [fallbackSetting, nextIdentity] = await Promise.all([
        getSetting("pdfFallbackNoticeEnabled"),
        getOrCreateDeviceIdentity(),
        ensurePersistentStorage()
      ]);

      setFallbackNoticeEnabled(fallbackSetting?.value !== false);
      setDeviceIdentity(nextIdentity);
      await refreshPairedDevices();
      void triggerNearbySync("startup");
    } catch (error) {
      console.error("Settings load failed", error);
    }
  }

  function navigate(nextUrl) {
    window.history.pushState({}, "", nextUrl);
    setRouteVersion((value) => value + 1);
  }

  function showToast(message) {
    setToast(message);
  }

  async function disableFallbackNotice() {
    setFallbackNoticeEnabled(false);
    try {
      await setSetting("pdfFallbackNoticeEnabled", false);
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
      await ensurePersistentStorage();
      await savePaper(reader.paper, {
        deviceId: deviceIdentityRef.current?.deviceId || "local"
      });
      await refreshLibrary();
      showToast("Saved for offline reading.");
      navigate(`/?paper=${encodeURIComponent(reader.paper.id)}`);
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
      showToast("Removed from library.");
      if (parseRoute().paperId === paperId) {
        navigate("/");
      }
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

  async function handleImportLibrary(file) {
    setImporting(true);
    try {
      await ensurePersistentStorage();
      await importLibraryBackup(file);
      await refreshLibrary();
      setRouteVersion((value) => value + 1);
      showToast("Imported library backup.");
      void triggerNearbySync("import");
    } catch (error) {
      showToast(stringifyError(error));
    } finally {
      setImporting(false);
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
          fallbackNoticeEnabled={fallbackNoticeEnabled}
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
          importing={importing}
          receiveMessage={receiveMessage}
          defaultInput={defaultInput}
          deviceIdentity={deviceIdentity}
          pairedDevices={pairedDevices}
          nearbyState={nearbyState}
          pairRouteInviteId={route.pairInviteId}
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
          onImportFile={handleImportLibrary}
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
