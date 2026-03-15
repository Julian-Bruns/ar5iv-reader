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
});
