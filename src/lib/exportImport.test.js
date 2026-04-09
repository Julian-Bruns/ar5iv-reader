import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyLibrarySnapshot: vi.fn(),
  exportLibrarySnapshot: vi.fn(),
  getPaper: vi.fn()
}));

vi.mock("./db", () => ({
  applyLibrarySnapshot: mocks.applyLibrarySnapshot,
  exportLibrarySnapshot: mocks.exportLibrarySnapshot,
  getPaper: mocks.getPaper
}));

describe("exportImport", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.applyLibrarySnapshot.mockReset();
    mocks.exportLibrarySnapshot.mockReset();
    mocks.getPaper.mockReset();
  });

  it("merges imported snapshots with the current library instead of replacing newer papers", async () => {
    mocks.exportLibrarySnapshot.mockResolvedValue({
      schemaVersion: 2,
      exportedAt: "2026-03-14T10:00:00.000Z",
      papers: [
        {
          id: "2401.00001",
          title: "Newer local",
          sourceUrl: "https://arxiv.org/abs/2401.00001",
          ar5ivUrl: "https://arxiv.org/html/2401.00001",
          savedAt: "2026-03-14T10:00:00.000Z",
          updatedAt: "2026-03-14T10:00:00.000Z",
          revisionMs: 20,
          revisionDeviceId: "local",
          deletedAtMs: 0,
          deletedAt: "",
          html: "<article>new</article>",
          assetUrls: ["https://cdn.example/new.png"]
        }
      ],
      assets: [
        {
          key: "2401.00001::https://cdn.example/new.png",
          paperId: "2401.00001",
          assetUrl: "https://cdn.example/new.png",
          contentType: "image/png",
          data: "new"
        }
      ],
      settings: []
    });

    const { importLibraryBackup } = await import("./exportImport");
    const file = {
      text: async () =>
        JSON.stringify({
          format: "ar5iv-reader-backup",
          schemaVersion: 2,
          appVersion: "0.3.0",
          buildId: "old-build",
          paperCount: 1,
          fingerprint: "old",
          librarySnapshot: {
            schemaVersion: 2,
            exportedAt: "2026-03-13T10:00:00.000Z",
            papers: [
              {
                id: "2401.00001",
                title: "Older backup",
                sourceUrl: "https://arxiv.org/abs/2401.00001",
                ar5ivUrl: "https://arxiv.org/html/2401.00001",
                savedAt: "2026-03-13T10:00:00.000Z",
                updatedAt: "2026-03-13T10:00:00.000Z",
                revisionMs: 10,
                revisionDeviceId: "backup",
                deletedAtMs: 0,
                deletedAt: "",
                html: "<article>old</article>",
                assetUrls: ["https://cdn.example/old.png"]
              }
            ],
            assets: [
              {
                key: "2401.00001::https://cdn.example/old.png",
                paperId: "2401.00001",
                assetUrl: "https://cdn.example/old.png",
                contentType: "image/png",
                data: "old"
              }
            ],
            settings: []
          },
          manifest: {
            schemaVersion: 1,
            exportedAt: "2026-03-13T10:00:00.000Z",
            appVersion: "0.3.0",
            origin: "https://reader.example",
            papers: []
          }
        })
    };

    const result = await importLibraryBackup(file);

    expect(result).toEqual({
      kind: "snapshot",
      paperCount: 1
    });
    expect(mocks.applyLibrarySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        papers: [
          expect.objectContaining({
            id: "2401.00001",
            title: "Newer local",
            revisionMs: 20
          })
        ],
        assets: [
          expect.objectContaining({
            assetUrl: "https://cdn.example/new.png",
            data: "new"
          })
        ]
      })
    );
  });

  it("writes a folder export with saved papers and open tabs", async () => {
    const {
      buildFolderExportName,
      exportLibraryFolder
    } = await import("./exportImport");
    const rootDirectory = createFakeDirectoryHandle("Documents");
    const exportedAt = new Date("2026-04-09T12:34:56.000Z");

    const result = await exportLibraryFolder(rootDirectory, {
      backupPayload: {
        librarySnapshot: {
          papers: [
            {
              id: "2401.00001",
              title: "Saved paper",
              sourceUrl: "https://arxiv.org/abs/2401.00001",
              ar5ivUrl: "https://arxiv.org/html/2401.00001",
              savedAt: "2026-04-01T00:00:00.000Z",
              updatedAt: "2026-04-09T10:00:00.000Z",
              deletedAtMs: 0,
              html: "<article><h1>Saved paper</h1><p>Cross attention text.</p></article>"
            },
            {
              id: "2400.00001",
              title: "Deleted paper",
              deletedAtMs: 1,
              html: "<article>ignore me</article>"
            }
          ]
        }
      },
      openTabs: [
        {
          id: "2401.00001",
          href: "/?paper=2401.00001",
          title: "Saved paper",
          status: "ready",
          paper: {
            id: "2401.00001",
            title: "Saved paper",
            sourceUrl: "https://arxiv.org/abs/2401.00001",
            ar5ivUrl: "https://arxiv.org/html/2401.00001",
            mode: "saved",
            view: "html",
            html: "<article><p>Saved paper tab text.</p></article>"
          }
        },
        {
          id: "2402.00002",
          href: "/?url=https://arxiv.org/abs/2402.00002",
          title: "PDF fallback",
          status: "ready",
          paper: {
            id: "2402.00002",
            titleHint: "PDF fallback",
            sourceUrl: "https://arxiv.org/abs/2402.00002",
            pdfUrl: "https://arxiv.org/pdf/2402.00002",
            mode: "session",
            view: "pdf",
            notice: "Showing the PDF."
          }
        },
        {
          id: "2403.00003",
          href: "/?url=https://arxiv.org/abs/2403.00003",
          title: "Broken tab",
          status: "error",
          error: "Failed to load",
          paper: null
        }
      ],
      appVersion: "0.3.0",
      buildId: "test-build",
      exportedAt
    });

    expect(result).toEqual({
      folderName: buildFolderExportName(exportedAt),
      savedPaperCount: 1,
      openTabCount: 3
    });

    const exportDirectory = rootDirectory.getDirectory(result.folderName);
    const manifest = JSON.parse(exportDirectory.readFile("manifest.json"));
    expect(manifest.savedPaperCount).toBe(1);
    expect(manifest.openTabCount).toBe(3);

    const savedPaperDirectory = exportDirectory
      .getDirectory("saved")
      .getDirectory("001-2401.00001");
    expect(savedPaperDirectory.readFile("paper.html")).toContain("Cross attention text.");
    expect(savedPaperDirectory.readFile("paper.txt")).toContain("Cross attention text.");
    expect(JSON.parse(savedPaperDirectory.readFile("meta.json"))).toMatchObject({
      collection: "saved",
      id: "2401.00001",
      hasHtml: true,
      hasText: true
    });

    const savedOpenTabDirectory = exportDirectory
      .getDirectory("open-tabs")
      .getDirectory("001-2401.00001");
    expect(savedOpenTabDirectory.readFile("paper.txt")).toContain("Saved paper tab text.");

    const pdfTabDirectory = exportDirectory
      .getDirectory("open-tabs")
      .getDirectory("002-2402.00002");
    expect(pdfTabDirectory.readFile("paper.html")).toBeNull();
    expect(JSON.parse(pdfTabDirectory.readFile("meta.json"))).toMatchObject({
      id: "2402.00002",
      view: "pdf",
      hasHtml: false
    });

    const errorTabDirectory = exportDirectory
      .getDirectory("open-tabs")
      .getDirectory("003-2403.00003");
    expect(JSON.parse(errorTabDirectory.readFile("meta.json"))).toMatchObject({
      id: "2403.00003",
      status: "error",
      error: "Failed to load"
    });
  });
});

function createFakeDirectoryHandle(name) {
  return new FakeDirectoryHandle(name);
}

class FakeDirectoryHandle {
  constructor(name) {
    this.name = name;
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) {
      if (!create) {
        throw new Error(`Missing directory ${name}`);
      }
      this.directories.set(name, new FakeDirectoryHandle(name));
    }

    return this.directories.get(name);
  }

  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) {
        throw new Error(`Missing file ${name}`);
      }
      this.files.set(name, "");
    }

    return new FakeFileHandle(this.files, name);
  }

  getDirectory(name) {
    const directory = this.directories.get(name);
    if (!directory) {
      throw new Error(`Missing directory ${name}`);
    }

    return directory;
  }

  readFile(name) {
    return this.files.has(name) ? this.files.get(name) : null;
  }
}

class FakeFileHandle {
  constructor(files, name) {
    this.files = files;
    this.name = name;
  }

  async createWritable() {
    return {
      write: async (value) => {
        this.files.set(this.name, String(value));
      },
      close: async () => {}
    };
  }
}
