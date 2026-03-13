export function isReceiveIngressUrl(url, protocolPayload = null) {
  const pathname = normalizePathname(url.pathname);
  if (pathname === "/receive") {
    return true;
  }

  return pathname === "/" && hasReceivePayload(url, protocolPayload);
}

export function readReceivePayload(url, protocolPayload = null) {
  return {
    url: url.searchParams.get("url") || protocolPayload?.url || "",
    text: url.searchParams.get("text") || protocolPayload?.text || "",
    title: url.searchParams.get("title") || protocolPayload?.title || ""
  };
}

function hasReceivePayload(url, protocolPayload) {
  return Boolean(
    url.searchParams.get("url") ||
      url.searchParams.get("text") ||
      url.searchParams.get("title") ||
      protocolPayload?.url ||
      protocolPayload?.text ||
      protocolPayload?.title
  );
}

function normalizePathname(pathname) {
  return String(pathname || "").replace(/\/+$/, "") || "/";
}
