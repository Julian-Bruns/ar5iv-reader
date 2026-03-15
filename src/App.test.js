import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.resolve(testDir, "./App.jsx");

describe("App PDF fallback integration", () => {
  it("routes both PDF fallback entrypoints through primePdfFallbackPaper", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/function primePdfFallbackPaper\(tabKey, paper\)/);
    expect(source.match(/primePdfFallbackPaper\(activeRouteTab\.key, nextPaper\);/g)).toHaveLength(2);
  });

  it("starts blob preloading and math-service prefetch from the helper", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/void fetchBlobWithFallback\(paper\.pdfUrl\)/);
    expect(source).toMatch(/void pdfMathService\.prefetch\(\)/);
  });

  it("revokes superseded and closed PDF blob URLs through the App-owned lifecycle", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(
      /for \(const blobUrl of getSupersededPdfBlobUrls\(currentTabs, nextTabs\)\) {\s*revokeObjectUrl\(blobUrl\);/s
    );
    expect(source).toMatch(
      /for \(const tab of openTabsRef\.current\) {\s*revokeObjectUrl\(getPdfFallbackBlobUrl\(tab\)\);/s
    );
    expect(source).toMatch(
      /if \(pdfFallbackPrimeRequestIdsRef\.current\.get\(tabKey\) !== requestId\) {\s*revokeObjectUrl\(objectUrl\);/s
    );
  });
});
