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
      schemaVersion: 3,
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
          schemaVersion: 3,
          appVersion: "0.3.0",
          buildId: "old-build",
          paperCount: 1,
          fingerprint: "old",
          librarySnapshot: {
            schemaVersion: 3,
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
});
