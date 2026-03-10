import { describe, expect, it } from "vitest";
import {
  AR5IV_HEDGE_DELAY_MS,
  AR5IV_PROBE_TIMEOUT_MS,
  summarizeFetchPolicy
} from "./fetchPolicy";

describe("fetchPolicy", () => {
  it("keeps advertised arXiv HTML papers in the HTML bucket", () => {
    const summary = summarizeFetchPolicy([
      {
        advertisedArxivHtml: true,
        arxivHtmlUsable: true,
        ar5ivHtmlUsable: false,
        ar5ivResponseMs: 900
      },
      {
        advertisedArxivHtml: true,
        arxivHtmlUsable: false,
        ar5ivHtmlUsable: true,
        ar5ivResponseMs: 700
      }
    ]);

    expect(summary.htmlCoverageRate).toBe(1);
    expect(summary.averageExtraPdfDelayMs).toBe(0);
  });

  it("caps non-advertised ar5iv probes at the configured timeout", () => {
    const summary = summarizeFetchPolicy([
      {
        advertisedArxivHtml: false,
        arxivHtmlUsable: false,
        ar5ivHtmlUsable: true,
        ar5ivResponseMs: 240
      },
      {
        advertisedArxivHtml: false,
        arxivHtmlUsable: false,
        ar5ivHtmlUsable: true,
        ar5ivResponseMs: 620
      },
      {
        advertisedArxivHtml: false,
        arxivHtmlUsable: false,
        ar5ivHtmlUsable: false,
        ar5ivResponseMs: 120
      },
      {
        advertisedArxivHtml: false,
        arxivHtmlUsable: false,
        ar5ivHtmlUsable: false,
        ar5ivResponseMs: 900
      }
    ]);

    expect(summary.htmlCoverageRate).toBe(0.5);
    expect(summary.averageExtraPdfDelayMs).toBe(310);
  });

  it("exports the tuned hedge and probe budgets", () => {
    expect(AR5IV_PROBE_TIMEOUT_MS).toBe(500);
    expect(AR5IV_HEDGE_DELAY_MS).toBe(250);
  });
});
