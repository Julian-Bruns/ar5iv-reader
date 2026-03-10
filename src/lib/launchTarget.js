export function resolveLaunchTarget({ currentUrl = "", targetUrl = "", origin = "" }) {
  const baseOrigin = normalizeOrigin(origin);
  if (!baseOrigin) {
    return { type: "ignore", nextUrl: "" };
  }

  const nextTargetUrl = parseLaunchUrl(targetUrl, baseOrigin);
  if (!nextTargetUrl || nextTargetUrl.origin !== baseOrigin) {
    return { type: "ignore", nextUrl: "" };
  }

  const nextUrl = `${nextTargetUrl.pathname}${nextTargetUrl.search}${nextTargetUrl.hash}`;
  const currentTargetUrl = parseLaunchUrl(currentUrl, baseOrigin);
  if (currentTargetUrl) {
    const normalizedCurrentUrl =
      `${currentTargetUrl.pathname}${currentTargetUrl.search}${currentTargetUrl.hash}`;
    if (normalizedCurrentUrl === nextUrl) {
      return { type: "refresh", nextUrl };
    }
  }

  return { type: "navigate", nextUrl };
}

function normalizeOrigin(origin) {
  try {
    return new URL(String(origin)).origin;
  } catch {
    return "";
  }
}

function parseLaunchUrl(value, baseOrigin) {
  if (!value) {
    return null;
  }

  if (value instanceof URL) {
    return value;
  }

  try {
    const rawValue = String(value).trim();
    if (!rawValue) {
      return null;
    }

    const isAbsoluteUrl = /^[a-z]+:\/\//i.test(rawValue);
    const isRelativeAppUrl = /^[/?#]/.test(rawValue);
    if (!isAbsoluteUrl && !isRelativeAppUrl) {
      return null;
    }

    return new URL(rawValue, baseOrigin);
  } catch {
    return null;
  }
}
