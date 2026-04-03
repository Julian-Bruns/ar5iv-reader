const MODERN_ID = /\b\d{4}\.\d{4,5}(?:v\d+)?\b/i;
const LEGACY_ID = /\b[a-z-]+(?:\.[a-z-]+)?\/\d{7}(?:v\d+)?\b/i;

export function normalizeArxivId(input) {
  if (!input) {
    return null;
  }

  const raw = String(input).trim();
  if (!raw) {
    return null;
  }

  const directId = matchArxivId(raw);
  if (directId) {
    return directId;
  }

  try {
    const url = new URL(raw);
    const pathname = url.pathname.replace(/\.pdf$/i, "");
    const fromUrl = matchArxivId(`${url.hostname}${pathname}`) || matchArxivId(pathname);
    if (fromUrl) {
      return fromUrl;
    }
  } catch {
    // Not a URL. Fall through to text scanning.
  }

  const decoded = safeDecodeURIComponent(raw);
  return matchArxivId(decoded);
}

export function extractArxivIdFromIncoming({ url = "", text = "", title = "" }) {
  return normalizeArxivId(url) || normalizeArxivId(text) || normalizeArxivId(title);
}

export function buildAr5ivUrl(id) {
  return `https://ar5iv.labs.arxiv.org/html/${id}`;
}

export function buildArxivHtmlUrl(id) {
  return `https://arxiv.org/html/${id}#view=FitH`;
}

export function buildArxivPdfUrl(id) {
  return `https://arxiv.org/pdf/${id}`;
}

export function buildArxivAbsUrl(id) {
  return `https://arxiv.org/abs/${id}`;
}

export function buildArxivSourceUrl(id) {
  return `https://export.arxiv.org/e-print/${id}`;
}

export function buildArxivBibtexUrl(id) {
  return `https://arxiv.org/bibtex/${id}`;
}

function matchArxivId(value) {
  const modern = value.match(MODERN_ID)?.[0];
  if (modern) {
    return modern;
  }

  const legacy = value.match(LEGACY_ID)?.[0];
  return legacy ? legacy.toLowerCase() : null;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
