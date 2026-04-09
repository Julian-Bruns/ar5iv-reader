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

  it("starts blob preloading without eagerly warming the PDF math runtime", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/void fetchBlobWithFallback\(paper\.pdfUrl\)/);
    expect(source).not.toMatch(/void pdfMathService\.prefetch\(\)/);
  });

  it("only acquires the PDF math runtime through the first-click activation helper", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/async function ensurePdfMathReady\(tabKey\)/);
    expect(source).toMatch(/const acquirePromise = Promise\.resolve\(pdfMathService\.acquire\(\)\)/);
    expect(source).toMatch(/onPdfMathActivationRequest=\{\(\) => ensurePdfMathReady\(activeTabKey\)\}/);
  });

  it("wires ReaderView PDF render callbacks back into App-owned pdfState", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/function handlePdfFirstPageRender\(tabKey, blobUrl\)/);
    expect(source).toMatch(/function handlePdfRenderFailure\(tabKey, blobUrl\)/);
    expect(source).toMatch(/onPdfFirstPageRender=\{\(\) =>/);
    expect(source).toMatch(/handlePdfFirstPageRender\(activeTabKey, reader\.paper\?\.pdfState\?\.blobUrl \|\| ""\)/);
    expect(source).toMatch(/onPdfRenderFailure=\{\(\) =>/);
    expect(source).toMatch(/handlePdfRenderFailure\(activeTabKey, reader\.paper\?\.pdfState\?\.blobUrl \|\| ""\)/);
  });

  it("marks PDF render readiness in App and clears failed blob URLs through the normal tab lifecycle", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(
      /function handlePdfFirstPageRender\(tabKey, blobUrl\) \{[\s\S]*currentPaper\.pdfState\.blobUrl !== blobUrl[\s\S]*loadStatus: "ready"/
    );
    expect(source).toMatch(
      /function handlePdfRenderFailure\(tabKey, blobUrl\) \{[\s\S]*currentPaper\.pdfState\.blobUrl !== blobUrl[\s\S]*blobUrl: ""[\s\S]*loadStatus: "error"/
    );
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
