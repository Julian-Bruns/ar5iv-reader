const INVITE_PREFIX = "ar5iv-pair:";

export function normalizeInviteId(value) {
  const compact = String(value || "")
    .trim()
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

  return /^[a-z0-9]{8}$/.test(compact) ? compact : "";
}

export function extractInviteId(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  const directCode = normalizeInviteId(rawValue);
  if (directCode) {
    return directCode;
  }

  if (rawValue.toLowerCase().startsWith(INVITE_PREFIX)) {
    return normalizeInviteId(rawValue.slice(INVITE_PREFIX.length));
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.type === "ar5iv-pair") {
      return normalizeInviteId(parsed.inviteId);
    }
  } catch {
    // Ignore non-JSON payloads.
  }

  try {
    const url = new URL(rawValue);
    return normalizeInviteId(url.searchParams.get("pair"));
  } catch {
    return "";
  }
}

export function formatInviteId(value) {
  const normalized = normalizeInviteId(value);
  if (!normalized) {
    return "";
  }

  return normalized
    .match(/.{1,4}/g)
    .join("-")
    .toUpperCase();
}

export function buildInviteQrValue(inviteId) {
  const normalized = normalizeInviteId(inviteId);
  return normalized ? `${INVITE_PREFIX}${normalized}` : "";
}
