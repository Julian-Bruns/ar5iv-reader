import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const workspacePath = path.join(testDir, "LatexWorkspaceView.jsx");

describe("LatexWorkspaceView editing controls", () => {
  it("keeps insertion controls in the sticky topbar and relies on autosave", () => {
    const source = fs.readFileSync(workspacePath, "utf8");

    expect(source).toContain('className="latex-insert-strip"');
    expect(source).toContain('aria-label="Insert LaTeX snippets"');
    expect(source).toContain("onExportPdfBuild");
    expect(source).toContain("Compile PDF");
    expect(source).toContain("pendingProjectHydrationRef");
    expect(source).not.toContain('onClick={() => void saveProject("manual")}');
    expect(source).not.toContain('className="latex-title-input"');
    expect(source).not.toContain("onDelete?.(project?.id)");
    expect(source).not.toContain('className="latex-panel-header"');
    expect(source).not.toContain("source.length.toLocaleString()");
  });

  it("only renders the diagnostic log when diagnostics exist", () => {
    const source = fs.readFileSync(workspacePath, "utf8");

    expect(source).not.toContain("No render issues.");
    expect(source).not.toContain('"Ready"');
    expect(source).toContain("{visibleDiagnostics.length ? (");
    expect(source).toContain('className="latex-diagnostics"');
  });
});
