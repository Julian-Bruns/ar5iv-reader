const THEOREM_SELECTOR = ".ltx_theorem";
const NOISE_SELECTORS = [
  "annotation",
  "annotation-xml",
  ".MJX_Assistive_MathML",
  "mjx-assistive-mml",
  "script",
  "style",
  "noscript"
];

export function findTheoremFromTarget(target) {
  return target instanceof Element ? target.closest(THEOREM_SELECTOR) : null;
}

export function buildTheoremPayload(theoremNode, paper, currentUrl = "") {
  if (!(theoremNode instanceof Element)) {
    return null;
  }

  const theoremId = resolveTheoremId(theoremNode);
  const theoremTitle = extractTheoremTitle(theoremNode);
  const paperId = String(paper?.id || "").trim();
  const theoremTextWithProof = extractReadableText(theoremNode);
  const theoremTextWithoutProof = extractReadableText(stripProofs(theoremNode));
  const referenceUrl = buildTheoremReferenceUrl(paper, theoremId, currentUrl);
  const referenceLabel =
    [paperId, theoremTitle || (theoremId ? `#${theoremId}` : "")]
      .filter(Boolean)
      .join(" • ") || "Paper reference";

  return {
    theoremId,
    theoremTitle,
    theoremTextWithProof,
    theoremTextWithoutProof,
    referenceLabel,
    referenceUrl,
    paperId,
    paperTitle: String(paper?.title || paper?.titleHint || paper?.id || "").trim()
  };
}

export function buildTheoremCopyText(payload, { includeProof = false } = {}) {
  if (!payload) {
    return "";
  }

  const theoremText = includeProof
    ? payload.theoremTextWithProof
    : payload.theoremTextWithoutProof;
  const segments = [theoremText];

  if (payload.referenceUrl) {
    segments.push(`Reference: ${payload.referenceUrl}`);
  } else if (payload.referenceLabel) {
    segments.push(`Reference: ${payload.referenceLabel}`);
  }

  return segments.filter(Boolean).join("\n\n").trim();
}

export function createTheoremNoteRecord(payload, noteText) {
  const normalizedNote = String(noteText || "").trim();
  if (!payload || !normalizedNote) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const entropy = Math.random().toString(36).slice(2, 10);

  return {
    id: `${payload.paperId || "paper"}::${payload.theoremId || "theorem"}::${Date.now()}::${entropy}`,
    paperId: payload.paperId,
    paperTitle: payload.paperTitle,
    theoremId: payload.theoremId,
    theoremTitle: payload.theoremTitle,
    theoremText: payload.theoremTextWithoutProof,
    referenceLabel: payload.referenceLabel,
    referenceUrl: payload.referenceUrl,
    noteText: normalizedNote,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function normalizeTheoremNotes(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry, index) => {
      const noteText = String(entry?.noteText || "").trim();
      const theoremText = String(entry?.theoremText || "").trim();

      if (!noteText || !theoremText) {
        return null;
      }

      const createdAt = normalizeTimestamp(entry?.createdAt);
      const updatedAt = normalizeTimestamp(entry?.updatedAt || createdAt);

      return {
        id: String(entry?.id || `note-${index + 1}`).trim(),
        paperId: String(entry?.paperId || "").trim(),
        paperTitle: String(entry?.paperTitle || "").trim(),
        theoremId: String(entry?.theoremId || "").trim(),
        theoremTitle: String(entry?.theoremTitle || "").trim(),
        theoremText,
        referenceLabel: String(entry?.referenceLabel || "").trim(),
        referenceUrl: String(entry?.referenceUrl || "").trim(),
        noteText,
        createdAt,
        updatedAt
      };
    })
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function resolveTheoremId(theoremNode) {
  if (theoremNode.id) {
    return theoremNode.id;
  }

  const labeledNode =
    theoremNode.querySelector("[id]") || theoremNode.querySelector('a[id], span[id], div[id]');
  return String(labeledNode?.id || "").trim();
}

function extractTheoremTitle(theoremNode) {
  const titleNode =
    theoremNode.querySelector(":scope > .ltx_title") || theoremNode.querySelector(".ltx_title");
  return normalizeWhitespace(titleNode?.textContent || "");
}

function stripProofs(theoremNode) {
  const clone = theoremNode.cloneNode(true);
  for (const proofNode of clone.querySelectorAll(".ltx_proof")) {
    proofNode.remove();
  }
  return clone;
}

function extractReadableText(node) {
  if (!(node instanceof Element)) {
    return "";
  }

  const clone = node.cloneNode(true);
  for (const selector of NOISE_SELECTORS) {
    for (const noiseNode of clone.querySelectorAll(selector)) {
      noiseNode.remove();
    }
  }

  for (const mathNode of clone.querySelectorAll("math[alttext], .ltx_Math[alttext]")) {
    const replacement = normalizeWhitespace(mathNode.getAttribute("alttext") || "");
    mathNode.replaceWith(replacement ? ` ${replacement} ` : " ");
  }

  for (const lineBreak of clone.querySelectorAll("br")) {
    lineBreak.replaceWith("\n");
  }

  return normalizeWhitespace(clone.textContent || "");
}

function buildTheoremReferenceUrl(paper, theoremId, currentUrl) {
  const baseUrl =
    String(paper?.ar5ivUrl || paper?.sourceUrl || currentUrl || "").trim();
  const fallbackCurrentUrl =
    currentUrl || (typeof window !== "undefined" ? window.location.href : "");

  if (!baseUrl) {
    return theoremId ? `#${theoremId}` : "";
  }

  try {
    const url = new URL(baseUrl, fallbackCurrentUrl || undefined);
    if (theoremId) {
      url.hash = theoremId;
    }
    return url.toString();
  } catch {
    return theoremId ? `${baseUrl}#${theoremId}` : baseUrl;
  }
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}
