// March 2026 live samples showed ar5iv-only hits arriving well under 500ms,
// while advertised arXiv HTML usually resolved within 250ms unless it was in a slow tail.
export const AR5IV_PROBE_TIMEOUT_MS = 500;
export const AR5IV_HEDGE_DELAY_MS = 250;

export function summarizeFetchPolicy(
  samples,
  { ar5ivProbeTimeoutMs = AR5IV_PROBE_TIMEOUT_MS } = {}
) {
  const normalizedSamples = Array.isArray(samples) ? samples : [];
  let htmlPaperCount = 0;
  let htmlServedCount = 0;
  let pdfPaperCount = 0;
  let pdfDelayTotalMs = 0;

  for (const sample of normalizedSamples) {
    const advertisedArxivHtml = Boolean(sample?.advertisedArxivHtml);
    const arxivHtmlUsable = Boolean(sample?.arxivHtmlUsable);
    const ar5ivHtmlUsable = Boolean(sample?.ar5ivHtmlUsable);
    const ar5ivResponseMs = Number(sample?.ar5ivResponseMs);
    const clampedAr5ivResponseMs =
      Number.isFinite(ar5ivResponseMs) && ar5ivResponseMs >= 0
        ? ar5ivResponseMs
        : ar5ivProbeTimeoutMs;
    const hasAnyHtml = arxivHtmlUsable || ar5ivHtmlUsable;

    if (hasAnyHtml) {
      htmlPaperCount += 1;
    }

    const servedHtml = advertisedArxivHtml
      ? arxivHtmlUsable || ar5ivHtmlUsable
      : ar5ivHtmlUsable && clampedAr5ivResponseMs <= ar5ivProbeTimeoutMs;

    if (hasAnyHtml && servedHtml) {
      htmlServedCount += 1;
    }

    if (!hasAnyHtml) {
      pdfPaperCount += 1;
      pdfDelayTotalMs += Math.min(clampedAr5ivResponseMs, ar5ivProbeTimeoutMs);
    }
  }

  return {
    htmlCoverageRate: htmlPaperCount ? htmlServedCount / htmlPaperCount : 1,
    averageExtraPdfDelayMs: pdfPaperCount ? pdfDelayTotalMs / pdfPaperCount : 0,
    htmlPaperCount,
    htmlServedCount,
    pdfPaperCount
  };
}
