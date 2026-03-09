import { useEffect, useRef, useState } from "preact/hooks";
import QRCode from "qrcode";
import {
  buildInviteQrValue,
  extractInviteId,
  formatInviteId
} from "../lib/nearby/inviteCode";

export default function SyncPanel({
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
  formatPairSyncStatus
}) {
  const [qrMarkup, setQrMarkup] = useState("");
  const [joinValue, setJoinValue] = useState(formatInviteId(pairRouteInviteId));
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    const nextValue = formatInviteId(pairRouteInviteId);
    if (nextValue) {
      setJoinValue(nextValue);
    }
  }, [pairRouteInviteId]);

  useEffect(() => {
    let cancelled = false;
    const qrValue = buildInviteQrValue(nearbyState.currentInvite?.inviteId);

    if (!qrValue) {
      setQrMarkup("");
      return undefined;
    }

    QRCode.toString(qrValue, {
      errorCorrectionLevel: "M",
      margin: 1,
      type: "svg",
      width: 212
    })
      .then((markup) => {
        if (!cancelled) {
          setQrMarkup(markup);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrMarkup("");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nearbyState.currentInvite?.inviteId]);

  async function handleJoinSubmit(event) {
    event.preventDefault();
    const inviteId = extractInviteId(joinValue);
    if (!inviteId) {
      return;
    }

    const joined = await onJoinInvite(inviteId);
    if (joined) {
      setJoinValue(formatInviteId(inviteId));
    }
  }

  async function handleDetectedInvite(rawValue) {
    const inviteId = extractInviteId(rawValue);
    if (!inviteId) {
      return false;
    }

    setJoinValue(formatInviteId(inviteId));
    return onJoinInvite(inviteId);
  }

  return (
    <>
      <section className="card sync-card">
        <div className="setup-header">
          <div className="section-heading">
            <h2>Nearby Sync</h2>
            <p>
              Pair devices once. After that, opening the app on the same network
              automatically looks for nearby paired devices and syncs your library.
            </p>
          </div>
          <div className="setup-actions">
            <button className="primary-button" type="button" onClick={onCreateInvite}>
              Add Device
            </button>
            <button className="ghost-button" type="button" onClick={onSyncNow}>
              Sync Nearby
            </button>
          </div>
        </div>

        <div className="sync-grid sync-grid--status">
          <div className="sync-identity">
            <p className="sync-label">This Device</p>
            <strong>{deviceIdentity?.label || "Loading device…"}</strong>
            <code className="sync-code">{deviceIdentity?.deviceId || "Generating…"}</code>
            <div className="setup-actions">
              <button className="ghost-button" type="button" onClick={onRenameThisDevice}>
                Rename
              </button>
            </div>
          </div>

          <div className="sync-state">
            <p className="sync-label">Nearby Status</p>
            <p className="sync-summary">{renderNearbySummary(nearbyState, pairRouteInviteId)}</p>
            <p className="paper-meta">
              Relay: {renderRelayState(nearbyState.relayStatus)}
            </p>
            <p className="paper-meta">
              Other paired devices online: {nearbyState.onlinePeerIds.length}
            </p>
          </div>
        </div>

        <div className="sync-grid sync-grid--join">
          <div className="sync-state">
            <p className="sync-label">Join With Code</p>
            <p className="sync-summary">
              Type the 8-character pairing code from the other device, or scan its
              QR code here and stay inside the app.
            </p>
          </div>
          <form className="sync-connect-form" onSubmit={handleJoinSubmit}>
            <div className="input-shell input-shell--action">
              <input
                className="url-input sync-code-input"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
                placeholder="ABCD-EFGH"
                value={joinValue}
                onInput={(event) => setJoinValue(formatInviteInput(event.currentTarget.value))}
              />
              <button
                className="input-icon-button"
                type="button"
                aria-label="Scan nearby pairing QR code"
                onClick={() => setScanOpen(true)}
              >
                <QrIcon />
              </button>
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={nearbyState.joiningInvite || !extractInviteId(joinValue)}
            >
              {nearbyState.joiningInvite ? "Joining…" : "Join Device"}
            </button>
          </form>
        </div>

        <div className="section-heading section-heading--compact">
          <h2>Paired Devices</h2>
          <p>Repeat syncs use these remembered pairings automatically.</p>
        </div>

        {!pairedDevices.length ? (
          <p className="empty-state">
            No devices paired yet. Use Add Device to create a one-time pairing code.
          </p>
        ) : (
          <div className="pair-grid">
            {pairedDevices.map((pair) => (
              <article className="pair-card" key={pair.peerDeviceId}>
                <div>
                  <h3>{pair.peerLabel}</h3>
                  <p className="paper-id">{pair.peerDeviceId}</p>
                  <p className="paper-meta">
                    {renderPairStatus(pair, nearbyState.onlinePeerIds, formatPairSyncStatus)}
                  </p>
                </div>
                <div className="paper-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => onRenamePeer(pair.peerDeviceId)}
                  >
                    Rename
                  </button>
                  <button
                    className="ghost-button ghost-button--danger"
                    type="button"
                    onClick={() => onForgetPeer(pair.peerDeviceId)}
                  >
                    Forget
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <QrScannerDialog
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={handleDetectedInvite}
      />

      {nearbyState.currentInvite || nearbyState.creatingInvite ? (
        <div className="sync-modal-backdrop" role="presentation" onClick={onCloseInvite}>
          <section
            className="card sync-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Pair another device"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="setup-header">
              <div className="section-heading">
                <h2>Pair Another Device</h2>
                <p>
                  On the other device, open Nearby Sync and type this code or tap the
                  camera button there to scan this QR code inside the app.
                </p>
              </div>
              <button className="ghost-button" type="button" onClick={onCloseInvite}>
                Close
              </button>
            </div>

            <div className="sync-grid">
              <div className="sync-identity">
                <p className="sync-label">Pairing Code</p>
                <code className="sync-code sync-code--pair">
                  {formatInviteId(nearbyState.currentInvite?.inviteId) || "Generating code…"}
                </code>
                <p className="paper-meta">
                  Keep both apps open on the same network until pairing finishes.
                </p>
                <div className="setup-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={onCopyInviteLink}
                    disabled={!nearbyState.currentInvite?.link}
                  >
                    Copy Fallback Link
                  </button>
                </div>
                {nearbyState.currentInvite?.expiresAt ? (
                  <p className="paper-meta">
                    Expires {new Date(nearbyState.currentInvite.expiresAt).toLocaleTimeString()}.
                  </p>
                ) : (
                  <p className="paper-meta">Waiting for the nearby relay…</p>
                )}
              </div>
              <div className="sync-qr-shell">
                {qrMarkup ? (
                  <div
                    className="sync-qr"
                    aria-label="Nearby pairing QR code"
                    dangerouslySetInnerHTML={{ __html: qrMarkup }}
                  />
                ) : nearbyState.creatingInvite ? (
                  <p className="paper-meta">Generating QR code…</p>
                ) : (
                  <p className="paper-meta">QR code unavailable.</p>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function QrScannerDialog({ open, onClose, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const activeRef = useRef(false);
  const detectBusyRef = useRef(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) {
      setStatus("");
      return undefined;
    }

    activeRef.current = true;

    const stopScanner = () => {
      activeRef.current = false;
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      const stream = streamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
      streamRef.current = null;
    };

    const startScanner = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("Camera scanning is not available here. Enter the code manually.");
        return;
      }

      if (!window.BarcodeDetector) {
        setStatus("QR scanning is not available on this device yet. Enter the code manually.");
        return;
      }

      try {
        if (window.BarcodeDetector.getSupportedFormats) {
          const supportedFormats = await window.BarcodeDetector.getSupportedFormats();
          if (!supportedFormats.includes("qr_code")) {
            setStatus("This device cannot scan QR codes here. Enter the code manually.");
            return;
          }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: {
              ideal: "environment"
            }
          }
        });

        if (!activeRef.current) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stopScanner();
          return;
        }

        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();

        const detector = new window.BarcodeDetector({
          formats: ["qr_code"]
        });

        setStatus("Point the camera at the nearby pairing QR code.");

        const scanFrame = async () => {
          if (!activeRef.current) {
            return;
          }

          const currentVideo = videoRef.current;
          if (
            currentVideo &&
            currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            !detectBusyRef.current
          ) {
            detectBusyRef.current = true;

            try {
              const results = await detector.detect(currentVideo);
              const rawValue = results[0]?.rawValue || "";

              if (rawValue) {
                const matched = await onDetected(rawValue);
                if (matched) {
                  onClose();
                  return;
                }

                setStatus("That QR code is not a pairing code for this app.");
              }
            } catch {
              // Keep scanning.
            } finally {
              detectBusyRef.current = false;
            }
          }

          frameRef.current = window.requestAnimationFrame(scanFrame);
        };

        frameRef.current = window.requestAnimationFrame(scanFrame);
      } catch (error) {
        if (String(error?.name || "") === "NotAllowedError") {
          setStatus("Camera access was blocked. Enter the code manually or allow camera access.");
          return;
        }

        setStatus("Camera failed to start. Enter the code manually instead.");
      }
    };

    void startScanner();
    return stopScanner;
  }, [open, onClose, onDetected]);

  if (!open) {
    return null;
  }

  return (
    <div className="sync-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="card sync-modal sync-modal--scanner"
        role="dialog"
        aria-modal="true"
        aria-label="Scan nearby pairing QR code"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="setup-header">
          <div className="section-heading">
            <h2>Scan Pairing QR Code</h2>
            <p>Keep the QR code inside the frame. If scanning is unavailable, type the code.</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="scanner-shell">
          <video className="scanner-video" ref={videoRef} muted playsInline />
          <div className="scanner-frame" aria-hidden="true" />
        </div>

        <p className="paper-meta">{status || "Starting camera…"}</p>
      </section>
    </div>
  );
}

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 4h6v6H4V4Zm2 2v2h2V6H6Zm8-2h6v6h-6V4Zm2 2v2h2V6h-2ZM4 14h6v6H4v-6Zm2 2v2h2v-2H6Zm8-2h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-2 2h2v2h-2v-2Zm-2 2h2v2h-2v-2Zm4 0h2v2h-2v-2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function formatInviteInput(value) {
  return String(value || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 8)
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join("-") || "";
}

function renderNearbySummary(nearbyState, pairRouteInviteId) {
  if (nearbyState.joiningInvite || pairRouteInviteId) {
    return "Joining nearby pairing…";
  }

  if (nearbyState.summaryStatus === "relay-unavailable") {
    return "Nearby relay unavailable. Install and reading still work; nearby sync will not.";
  }

  if (nearbyState.summaryStatus === "pairing-expired") {
    return "That pairing code expired. Create a new one from the device you want to pair.";
  }

  if (nearbyState.summaryStatus === "syncing") {
    return "A nearby sync session is running.";
  }

  if (nearbyState.summaryStatus === "no-peer") {
    return "No paired devices are currently online nearby.";
  }

  if (nearbyState.summaryStatus === "failed") {
    return "Nearby sync failed. Open both devices and try again.";
  }

  if (nearbyState.summaryStatus === "paired") {
    return "Pairing complete. The library will sync when both devices are open nearby.";
  }

  if (nearbyState.onlinePeerIds.length) {
    return nearbyState.onlinePeerIds.length === 1
      ? "A paired device is online nearby."
      : "Paired devices are online nearby.";
  }

  return "Ready to pair and sync nearby devices.";
}

function renderRelayState(status) {
  if (status === "connected") {
    return "connected";
  }

  if (status === "connecting") {
    return "connecting";
  }

  if (status === "unavailable") {
    return "disabled";
  }

  return "offline";
}

function renderPairStatus(pair, onlinePeerIds, formatPairSyncStatus) {
  if (onlinePeerIds.includes(pair.peerDeviceId)) {
    if (pair.lastSyncedAt) {
      return `Online nearby. Last synced ${new Date(pair.lastSyncedAt).toLocaleString()}.`;
    }

    return "Online nearby. Waiting for the first sync.";
  }

  return formatPairSyncStatus(pair.lastSyncStatus, pair.lastSyncedAt);
}
