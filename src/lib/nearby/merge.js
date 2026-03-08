export function comparePaperVersions(left, right) {
  const leftRevisionMs = Number(left?.revisionMs || 0);
  const rightRevisionMs = Number(right?.revisionMs || 0);

  if (leftRevisionMs !== rightRevisionMs) {
    return leftRevisionMs - rightRevisionMs;
  }

  return String(left?.revisionDeviceId || "").localeCompare(String(right?.revisionDeviceId || ""));
}

export function shouldReplacePaper(currentPaper, nextPaper) {
  if (!currentPaper) {
    return true;
  }

  return comparePaperVersions(nextPaper, currentPaper) > 0;
}

export function formatPairSyncStatus(status, syncedAt = 0) {
  if (!status) {
    return "Waiting for the first nearby sync.";
  }

  if (status === "syncing") {
    return "Syncing with a nearby device…";
  }

  if (status === "relay-unavailable") {
    return "Nearby relay unavailable.";
  }

  if (status === "no-peer") {
    return "No nearby paired devices found.";
  }

  if (status === "failed") {
    return "Nearby sync failed.";
  }

  if (status === "paired") {
    return "Paired. Waiting for the first nearby sync.";
  }

  if (status === "synced" && syncedAt) {
    return `Last synced ${new Date(syncedAt).toLocaleString()}.`;
  }

  return "Nearby sync ready.";
}
