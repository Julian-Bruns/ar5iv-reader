import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const libraryViewPath = path.resolve(testDir, "./LibraryView.jsx");

describe("LibraryView theorem notes integration", () => {
  it("renders a central notes repository with theorem and note text", () => {
    const source = fs.readFileSync(libraryViewPath, "utf8");

    expect(source).toMatch(/theoremNotes/);
    expect(source).toMatch(/Search notes/);
    expect(source).toMatch(/Your saved theorem notes live here\./);
    expect(source).toMatch(/note-card-theorem/);
    expect(source).toMatch(/note-card-body/);
    expect(source).toMatch(/Open paper/);
  });
});
