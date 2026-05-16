import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const libraryViewPath = path.resolve(testDir, "./LibraryView.jsx");

describe("LibraryView theorem notes integration", () => {
  it("organizes the library workspace behind sidebar pages", () => {
    const source = fs.readFileSync(libraryViewPath, "utf8");

    expect(source).toMatch(/LIBRARY_PAGE_IDS = \["home", "browse", "library", "notes", "edit"\]/);
    expect(source).toMatch(/const \[activeLibraryPage, setActiveLibraryPage\]/);
    expect(source).toMatch(/LibraryNavIcon/);
    expect(source).toMatch(/Paper Gallery/);
    expect(source).toMatch(/setLibraryPageInUrl/);
  });

  it("renders a central notes repository with theorem and note text", () => {
    const source = fs.readFileSync(libraryViewPath, "utf8");

    expect(source).toMatch(/theoremNotes/);
    expect(source).toMatch(/Search notes/);
    expect(source).toMatch(/Your saved theorem notes live here\./);
    expect(source).toMatch(/note-card-theorem/);
    expect(source).toMatch(/note-card-body/);
    expect(source).toMatch(/note-card-latex/);
    expect(source).toMatch(/Open paper/);
  });

  it("renders recent searched papers as open-paper suggestions with tab prefix completion", () => {
    const source = fs.readFileSync(libraryViewPath, "utf8");

    expect(source).toMatch(/paperSuggestions = \[\]/);
    expect(source).toMatch(/open-paper-suggestions/);
    expect(source).toMatch(/paper-suggestion-title/);
    expect(source).toMatch(/paper-suggestion-url/);
    expect(source).toMatch(/function completeOpenPaperUrlPrefix\(value\)/);
    expect(source).toMatch(/event\.key === "Tab"/);
    expect(source).toMatch(/https:\/\/arxiv\.org\/abs\//);
  });

  it("renders a LaTeX project repository with project creation and opening actions", () => {
    const source = fs.readFileSync(libraryViewPath, "utf8");

    expect(source).toMatch(/latexProjects = \[\]/);
    expect(source).toMatch(/LaTeX Projects/);
    expect(source).toMatch(/New Project/);
    expect(source).toMatch(/Search LaTeX projects/);
    expect(source).toMatch(/onCreateLatexProject/);
    expect(source).toMatch(/onOpenLatexProject\(project\.id\)/);
    expect(source).toMatch(/onDeleteLatexProject\(project\.id\)/);
  });

  it("keeps backup and URL-list restore on one upload control", () => {
    const source = fs.readFileSync(libraryViewPath, "utf8");

    expect(source).toMatch(/restore a backup or URL list/);
    expect(source).toMatch(/Restoring…"\s*:\s*"Restore Backup"/);
    expect(source).not.toMatch(/onRestoreUrls/);
    expect(source).not.toMatch(/Restore From URLs/);
  });
});
