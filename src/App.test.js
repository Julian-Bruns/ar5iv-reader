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

  it("starts session PDFs in direct-url mode without eagerly warming the PDF math runtime", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).not.toMatch(/function primePdfFallbackPaper\(tabKey, paper\) \{[\s\S]*void fetchBlobWithFallback\(paper\.pdfUrl\)/);
    expect(source).not.toMatch(/void pdfMathService\.prefetch\(\)/);
  });

  it("only initializes the PDF math runtime through the first-click activation helper", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/async function ensurePdfMathReady\(tabKey\)/);
    expect(source).toMatch(/const acquirePromise = Promise\.resolve\(pdfMathService\.ensureReady\(\)\)/);
    expect(source).toMatch(/onPdfMathActivationRequest=\{\(\) => ensurePdfMathReady\(activeTabKey\)\}/);
  });

  it("wires ReaderView PDF render callbacks back into App-owned pdfState", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/function handlePdfFirstPageRender\(tabKey, documentUrl\)/);
    expect(source).toMatch(/function handlePdfRenderFailure\(tabKey, documentUrl\)/);
    expect(source).toMatch(/onPdfFirstPageRender=\{\(documentUrl\) =>/);
    expect(source).toMatch(/handlePdfFirstPageRender\([\s\S]*documentUrl \|\| reader\.paper\?\.pdfState\?\.documentUrl \|\| ""/);
    expect(source).toMatch(/onPdfRenderFailure=\{\(_error, documentUrl\) =>/);
    expect(source).toMatch(/handlePdfRenderFailure\([\s\S]*documentUrl \|\| reader\.paper\?\.pdfState\?\.documentUrl \|\| ""/);
  });

  it("marks PDF render readiness in App and retries remote-direct failures through blob fallback", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(
      /function handlePdfFirstPageRender\(tabKey, documentUrl\) \{[\s\S]*currentPaper\.pdfState\.documentUrl !== documentUrl[\s\S]*loadStatus: "ready"/
    );
    expect(source).toMatch(
      /function handlePdfRenderFailure\(tabKey, documentUrl\) \{[\s\S]*currentTab\.paper\.pdfState\.sourceMode !== "remote-direct"[\s\S]*documentUrl: ""[\s\S]*sourceMode: ""[\s\S]*loadStatus: "error"/
    );
    expect(source).toMatch(
      /void fetchBlobWithFallback\(currentTab\.paper\.pdfUrl\)[\s\S]*documentUrl: objectUrl,[\s\S]*sourceMode: "blob-fallback"/
    );
  });

  it("boots saved PDFs from blob-backed document URLs", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/documentUrl: blobUrl,/);
    expect(source).toMatch(/sourceMode: "saved-blob",/);
  });

  it("persists theorem notes and wires them into reader and library views", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/const \[theoremNotes, setTheoremNotes\] = useState\(\[\]\);/);
    expect(source).toMatch(/getSetting\(SETTING_KEYS\.theoremNotes\)/);
    expect(source).toMatch(/setSetting\(SETTING_KEYS\.theoremNotes, nextNotes\)/);
    expect(source).toMatch(/onCreateTheoremNote=\{handleCreateTheoremNote\}/);
    expect(source).toMatch(/theoremNotes=\{theoremNotes\}/);
  });

  it("uses the same restore picker for local backups and URL lists", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/async function importLibraryFile\(file\)/);
    expect(source).toMatch(/inspectImportContents\(contents\)/);
    expect(source).toMatch(/importLibraryBackup\(file, \{\s*contents,/s);
    expect(source).toMatch(
      /async function handleImportLibrary\(file\) \{\s*return importLibraryFile\(file\);\s*\}/
    );
    expect(source).not.toMatch(/Use Restore from URLs instead/);
    expect(source).not.toMatch(/Use Restore Local Backup instead/);
    expect(source).toMatch(/Restored URL list:/);
  });

  it("persists searched papers and passes them to the open paper box", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(
      /const \[openPaperSearchHistory, setOpenPaperSearchHistory\] = useState\(\[\]\);/
    );
    expect(source).toMatch(/getSetting\(SETTING_KEYS\.openPaperSearchHistory\)/);
    expect(source).toMatch(/setSetting\(SETTING_KEYS\.openPaperSearchHistory, nextHistory\)/);
    expect(source).toMatch(/function rememberSearchedPaper\(record\)/);
    expect(source).toMatch(/normalizeOpenPaperSearchHistory\(storedOpenPaperSearchHistory\?\.value\)/);
    expect(source).toMatch(/paperSuggestions=\{openPaperSearchHistory\}/);
  });

  it("wires local LaTeX projects through library, routes, persistence, and export handlers", () => {
    const source = fs.readFileSync(appPath, "utf8");

    expect(source).toMatch(/const \[latexProjects, setLatexProjects\] = useState\(\[\]\);/);
    expect(source).toMatch(/const \[latexWorkspace, setLatexWorkspace\] = useState/);
    expect(source).toMatch(/listLatexProjects\(\)/);
    expect(source).toMatch(/getLatexProject\(route\.latexProjectId\)/);
    expect(source).toMatch(/saveLatexProject\(project/);
    expect(source).toMatch(/deleteLatexProject\(projectId/);
    expect(source).toMatch(/buildLatexProjectUrl\(projectId\)/);
    expect(source).toMatch(/<LatexWorkspaceView/);
    expect(source).toMatch(/latexProjects=\{latexProjects\}/);
    expect(source).toMatch(/onCreateLatexProject=\{handleCreateLatexProject\}/);
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
      /if \(!didApply\) {\s*revokeObjectUrl\(objectUrl\);/s
    );
  });
});
