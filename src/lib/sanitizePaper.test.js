import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sanitizePaperPath = path.resolve(testDir, "./sanitizePaper.js");

describe("sanitizePaper module shape", () => {
  it("declares getPurifier only once", () => {
    const source = fs.readFileSync(sanitizePaperPath, "utf8");
    const matches = source.match(/function getPurifier\(/g) || [];

    expect(matches).toHaveLength(1);
  });
});
