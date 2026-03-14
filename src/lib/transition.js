export function createInstallMeta({
  appVersion = "",
  buildId = "",
  paperCount = 0,
  libraryFingerprint = "",
  seenAt = ""
} = {}) {
  return {
    lastSeenAppVersion: String(appVersion || "").trim(),
    lastSeenBuildId: String(buildId || "").trim(),
    lastKnownPaperCount: Math.max(0, Number(paperCount || 0) || 0),
    lastKnownLibraryFingerprint: String(libraryFingerprint || ""),
    lastSeenAt: String(seenAt || "")
  };
}

export function normalizeRecoveryState(value) {
  return {
    status: ["idle", "suspicious", "ignored"].includes(value?.status) ? value.status : "idle",
    reason: String(value?.reason || "").trim(),
    detectedAt: String(value?.detectedAt || ""),
    dismissedAt: String(value?.dismissedAt || "")
  };
}

export function evaluateUpgradeTransition({
  previousInstallMeta,
  currentAppVersion = "",
  currentBuildId = "",
  currentPaperCount = 0,
  currentLibraryFingerprint = ""
} = {}) {
  const previous = normalizeInstallMeta(previousInstallMeta);
  const current = createInstallMeta({
    appVersion: currentAppVersion,
    buildId: currentBuildId,
    paperCount: currentPaperCount,
    libraryFingerprint: currentLibraryFingerprint
  });
  const hasPreviousVersion =
    Boolean(previous.lastSeenAppVersion) || Boolean(previous.lastSeenBuildId);
  const buildChanged =
    hasPreviousVersion &&
    (previous.lastSeenAppVersion !== current.lastSeenAppVersion ||
      previous.lastSeenBuildId !== current.lastSeenBuildId);

  if (!buildChanged) {
    return {
      status: "idle",
      reason: "",
      buildChanged: false,
      previous,
      current
    };
  }

  if (current.lastKnownPaperCount > 0) {
    return {
      status: "healthy",
      reason: "",
      buildChanged: true,
      previous,
      current
    };
  }

  if (previous.lastKnownPaperCount > 0 && current.lastKnownPaperCount === 0) {
    return {
      status: "suspicious",
      reason: "missing-library-after-upgrade",
      buildChanged: true,
      previous,
      current
    };
  }

  return {
    status: "idle",
    reason: "",
    buildChanged: true,
    previous,
    current
  };
}

export function prioritizeRecoveryActions({
  hasReadableBackupFile = false,
  hasOnlinePairedDevices = false
} = {}) {
  const actions = [];

  if (hasReadableBackupFile) {
    actions.push("backup-file");
  }

  if (hasOnlinePairedDevices) {
    actions.push("nearby-sync");
  }

  actions.push("backup-upload");
  actions.push("url-manifest");

  return actions;
}

export function normalizeInstallMeta(value) {
  return {
    lastSeenAppVersion: String(value?.lastSeenAppVersion || value?.appVersion || "").trim(),
    lastSeenBuildId: String(value?.lastSeenBuildId || value?.buildId || "").trim(),
    lastKnownPaperCount:
      Math.max(0, Number(value?.lastKnownPaperCount ?? value?.paperCount ?? 0) || 0),
    lastKnownLibraryFingerprint: String(
      value?.lastKnownLibraryFingerprint || value?.libraryFingerprint || ""
    ),
    lastSeenAt: String(value?.lastSeenAt || value?.seenAt || "")
  };
}
