import { buildArxivAbsUrl } from "./arxiv";

const RELAYS = [
  "https://corsproxy.io/?",
  "https://api.allorigins.win/raw?url="
];
const CITATION_TIMEOUT_MS = 6500;
const CROSSCITE_BIBTEX_BASE_URL = "https://data.crosscite.org/application/x-bibtex/";
const ARXIV_API_BASE_URL = "https://export.arxiv.org/api/query";
const CROSSCITE_FIELD_ORDER = ["author", "title", "year", "doi", "url", "publisher", "journal", "note"];
const BIBTEX_CACHE = new Map();

export function primePaperBibtex(id) {
  return loadPaperBibtex(id);
}

export function fetchPaperBibtex(id) {
  return loadPaperBibtex(id);
}

function loadPaperBibtex(id) {
  const normalizedId = normalizeCitationId(id);
  if (!normalizedId) {
    return Promise.reject(new Error("Missing arXiv identifier."));
  }

  const cached = BIBTEX_CACHE.get(normalizedId);
  if (cached) {
    return cached;
  }

  const promise = resolvePaperBibtex(normalizedId).catch((error) => {
    BIBTEX_CACHE.delete(normalizedId);
    throw error;
  });

  BIBTEX_CACHE.set(normalizedId, promise);
  return promise;
}

async function resolvePaperBibtex(id) {
  try {
    const rawBibtex = await fetchTextWithFallback(
      `${CROSSCITE_BIBTEX_BASE_URL}${buildArxivCitationDoi(id)}`,
      {
        accept: "application/x-bibtex, text/plain;q=0.9, */*;q=0.1"
      }
    );
    const normalizedBibtex = normalizeCrossciteBibtex(rawBibtex, id);
    if (normalizedBibtex) {
      return normalizedBibtex;
    }
  } catch {
    // Fall through to the arXiv API metadata fallback.
  }

  const rawXml = await fetchTextWithFallback(
    `${ARXIV_API_BASE_URL}?id_list=${encodeURIComponent(id)}`,
    {
      accept: "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1"
    }
  );

  return buildBibtexFromArxivMetadata(parseArxivApiResponse(rawXml, id));
}

function buildArxivCitationDoi(id) {
  return `10.48550/arXiv.${normalizeCitationId(id)}`;
}

function normalizeCitationId(id) {
  const rawId = String(id || "").trim();
  if (!rawId) {
    return "";
  }

  const withoutVersion = rawId.replace(/v\d+$/i, "");
  return withoutVersion.includes("/") ? withoutVersion.toLowerCase() : withoutVersion;
}

function buildBibtexKey(id) {
  return `arxiv:${normalizeCitationId(id)}`
    .replace(/[^a-z0-9:.]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCrossciteBibtex(rawBibtex, id) {
  const raw = String(rawBibtex || "").trim();
  const typeMatch = raw.match(/^@([a-z]+)\s*\{/i);
  if (!typeMatch) {
    return "";
  }

  const fields = parseBibtexFields(raw);
  const orderedFields = CROSSCITE_FIELD_ORDER.flatMap((name) =>
    fields[name] ? [[name, fields[name]]] : []
  );

  if (!orderedFields.length) {
    return replaceBibtexKey(raw, buildBibtexKey(id));
  }

  return formatBibtexEntry(typeMatch[1].toLowerCase(), buildBibtexKey(id), orderedFields);
}

function parseBibtexFields(rawBibtex) {
  const fields = {};

  for (const line of String(rawBibtex || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z_]+)\s*=\s*\{(.*)\}\s*,?\s*$/i);
    if (!match) {
      continue;
    }

    fields[match[1].toLowerCase()] = normalizeWhitespace(match[2]);
  }

  return fields;
}

function replaceBibtexKey(rawBibtex, key) {
  const normalized = String(rawBibtex || "")
    .trim()
    .replace(/^(@[a-z]+\s*\{)([^,]+)(,)/i, `$1${key}$3`);
  return normalized ? `${normalized}\n` : "";
}

function buildBibtexFromArxivMetadata(metadata) {
  if (!metadata.title) {
    throw new Error("arXiv metadata did not include a title.");
  }

  const fields = [];
  if (metadata.authors.length) {
    fields.push(["author", metadata.authors.join(" and ")]);
  }
  fields.push(["title", metadata.title]);
  if (metadata.year) {
    fields.push(["year", metadata.year]);
  }
  fields.push(["eprint", metadata.id]);
  fields.push(["archivePrefix", "arXiv"]);
  if (metadata.primaryClass) {
    fields.push(["primaryClass", metadata.primaryClass]);
  }
  if (metadata.doi) {
    fields.push(["doi", metadata.doi]);
  }
  fields.push(["url", metadata.url]);
  if (metadata.journalRef) {
    fields.push(["note", `Published in ${metadata.journalRef}`]);
  }

  return formatBibtexEntry("misc", buildBibtexKey(metadata.id), fields);
}

function formatBibtexEntry(type, key, fields) {
  const serializedFields = fields
    .filter(([, value]) => String(value || "").trim())
    .map(([name, value]) => `  ${name} = {${normalizeWhitespace(value)}}`)
    .join(",\n");

  return `@${type}{${key},\n${serializedFields}\n}\n`;
}

function parseArxivApiResponse(rawXml, fallbackId) {
  const entryXml = extractFirstXmlElement(rawXml, "entry");
  if (!entryXml) {
    throw new Error("arXiv API did not return an entry.");
  }

  const title = normalizeWhitespace(decodeXmlEntities(extractFirstXmlText(entryXml, "title")));
  const published = normalizeWhitespace(
    decodeXmlEntities(extractFirstXmlText(entryXml, "published"))
  );
  const entryUrl = normalizeArxivAbsUrl(
    decodeXmlEntities(extractFirstXmlText(entryXml, "id")),
    fallbackId
  );
  const authors = extractXmlElements(entryXml, "author")
    .map((authorXml) => normalizeWhitespace(decodeXmlEntities(extractFirstXmlText(authorXml, "name"))))
    .filter(Boolean);
  const primaryClassMatch = entryXml.match(
    /<(?:[\w-]+:)?primary_category\b[^>]*\bterm="([^"]+)"/i
  );
  const primaryClass = normalizeWhitespace(decodeXmlEntities(primaryClassMatch?.[1] || ""));
  const doi = normalizeWhitespace(decodeXmlEntities(extractFirstXmlText(entryXml, "doi")));
  const journalRef = normalizeWhitespace(
    decodeXmlEntities(extractFirstXmlText(entryXml, "journal_ref"))
  );

  return {
    id: normalizeCitationId(fallbackId),
    title,
    authors,
    year: /^\d{4}/.test(published) ? published.slice(0, 4) : "",
    url: entryUrl,
    primaryClass,
    doi,
    journalRef
  };
}

function extractFirstXmlElement(source, localName) {
  return extractXmlElements(source, localName)[0] || "";
}

function extractXmlElements(source, localName) {
  const pattern = new RegExp(
    `<(?:[\\w-]+:)?${escapeRegex(localName)}\\b[^>]*>[\\s\\S]*?<\\/(?:[\\w-]+:)?${escapeRegex(
      localName
    )}>`,
    "gi"
  );
  return String(source || "").match(pattern) || [];
}

function extractFirstXmlText(source, localName) {
  const pattern = new RegExp(
    `<(?:[\\w-]+:)?${escapeRegex(localName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${escapeRegex(
      localName
    )}>`,
    "i"
  );
  return pattern.exec(String(source || ""))?.[1] || "";
}

function normalizeArxivAbsUrl(value, fallbackId) {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) {
    return buildArxivAbsUrl(normalizeCitationId(fallbackId));
  }

  return rawUrl
    .replace(/^http:/i, "https:")
    .replace(/\/abs\/([^?#]+?)v\d+$/i, "/abs/$1");
}

async function fetchTextWithFallback(targetUrl, { accept = "text/plain, */*;q=0.1", timeoutMs = CITATION_TIMEOUT_MS } = {}) {
  try {
    const response = await fetchWithTimeout(
      targetUrl,
      {
        headers: {
          accept
        }
      },
      timeoutMs
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    const body = await response.text();
    if (!body.trim()) {
      throw new Error("Empty response");
    }

    return body;
  } catch {
    // Fall through to relay fetches when direct cross-origin fetches are blocked.
  }

  return fetchThroughRelays(targetUrl, async (requestUrl) => {
    const response = await fetchWithTimeout(
      requestUrl,
      {
        headers: {
          accept
        }
      },
      timeoutMs
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    const body = await response.text();
    if (!body.trim()) {
      throw new Error("Empty response");
    }

    return body;
  });
}

async function fetchThroughRelays(targetUrl, reader) {
  return Promise.any(
    RELAYS.map(async (relay) => {
      const requestUrl = `${relay}${encodeURIComponent(targetUrl)}`;
      return reader(requestUrl);
    })
  );
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) => String.fromCodePoint(parseInt(codePoint, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
