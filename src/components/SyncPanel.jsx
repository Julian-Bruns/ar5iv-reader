import { useEffect, useState } from "preact/hooks";
import QRCode from "qrcode";

export default function SyncPanel({
  deviceIdentity,
  pairedDevices,
  nearbyState,
  pairRouteInviteId,
  onCreateInvite,
  onCloseInvite,
  onCopyInviteLink,
  onRenameThisDevice,
  onRenamePeer,
  onForgetPeer,
  onSyncNow,
  formatPairSyncStatus
}) {
  const [qrMarkup, setQrMarkup] = useState("");

  useEffect(() => {
    let cancelled = false;
    const inviteLink = nearbyState.currentInvite?.link || "";

    if (!inviteLink) {
      setQrMarkup("");
      return undefined;
    }

    QRCode.toString(inviteLink, {
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
  }, [nearbyState.currentInvite?.link]);

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

        <div className="section-heading section-heading--compact">
          <h2>Paired Devices</h2>
          <p>Repeat syncs use these remembered pairings automatically.</p>
        </div>

        {!pairedDevices.length ? (
          <p className="empty-state">
            No devices paired yet. Use Add Device to create a one-time nearby pairing link.
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
                  Open this link on the other device while both apps are on the same
                  network. After this one-time step, later nearby syncs are automatic.
                </p>
              </div>
              <button className="ghost-button" type="button" onClick={onCloseInvite}>
                Close
              </button>
            </div>

            <div className="sync-grid">
              <div className="sync-identity">
                <p className="sync-label">Pairing Link</p>
                <code className="sync-code">
                  {nearbyState.currentInvite?.link || "Generating pairing link…"}
                </code>
                <div className="setup-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={onCopyInviteLink}
                    disabled={!nearbyState.currentInvite?.link}
                  >
                    Copy Link
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

function renderNearbySummary(nearbyState, pairRouteInviteId) {
  if (pairRouteInviteId && nearbyState.joiningInvite) {
    return "Joining nearby pairing…";
  }

  if (nearbyState.summaryStatus === "relay-unavailable") {
    return "Nearby relay unavailable. Install and reading still work; nearby sync will not.";
  }

  if (nearbyState.summaryStatus === "pairing-expired") {
    return "That pairing link expired. Create a new one from the device you want to pair.";
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
