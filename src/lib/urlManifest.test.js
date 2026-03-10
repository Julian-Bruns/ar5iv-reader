import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildUrlManifest,
  parseUrlManifest,
  restoreFromUrlManifest
} from "./urlManifest";

describe("urlManifest", () => {
  beforeEach(() => {
    globalThis.window = {
      location: {
        origin: "https://reader.example"
      }
    };
  });

  it("builds a stable sorted manifest", () => {
    const manifest = buildUrlManifest(
      [
        {
          id: "2401.00002",
          title: "Second",
          sourceUrl: "https://arxiv.org/abs/2401.00002",
          ar5ivUrl: "https://arxiv.org/html/2401.00002",
          savedAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          revisionMs: 20
        },
        {
          id: "2401.00001",
          title: "First",
          sourceUrl: "https://arxiv.org/abs/2401.00001",
          ar5ivUrl: "https://arxiv.org/html/2401.00001",
          savedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          revisionMs: 10
        }
      ],
      "0.4.0"
    );

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.appVersion).toBe("0.4.0");
    expect(manifest.origin).toBe("https://reader.example");
    expect(manifest.papers.map((paper) => paper.id)).toEqual([
      "2401.00001",
      "2401.00002"
    ]);
  });

  it("filters invalid rows and deduplicates by the newest revision", () => {
    const manifest = parseUrlManifest(
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: "2026-03-10T00:00:00.000Z",
        appVersion: "0.4.0",
        origin: "https://reader.example",
        papers: [
          {
            id: "",
            revisionMs: 100
          },
          {
            id: "2401.00001",
            title: "Older",
            sourceUrl: "https://arxiv.org/abs/2401.00001",
            updatedAt: "2026-01-01T00:00:00.000Z",
            revisionMs: 10
          },
          {
            id: "2401.00001",
            title: "Newer",
            sourceUrl: "https://arxiv.org/abs/2401.00001v2",
            updatedAt: "2026-01-02T00:00:00.000Z",
            revisionMs: 20
          }
        ]
      })
    );

    expect(manifest.papers).toHaveLength(1);
    expect(manifest.papers[0]).toMatchObject({
      id: "2401.00001",
      title: "Newer",
      sourceUrl: "https://arxiv.org/abs/2401.00001v2",
      revisionMs: 20
    });
  });

  it("skips restore when the local record is newer", async () => {
    const fetchPaper = vi.fn();
    const savePaperRecord = vi.fn();
    const result = await restoreFromUrlManifest(
      {
        schemaVersion: 1,
        exportedAt: "2026-03-10T00:00:00.000Z",
        appVersion: "0.4.0",
        origin: "https://reader.example",
        papers: [
          {
            id: "2401.00001",
            title: "Existing",
            sourceUrl: "https://arxiv.org/abs/2401.00001",
            updatedAt: "2026-01-01T00:00:00.000Z",
            savedAt: "2026-01-01T00:00:00.000Z",
            revisionMs: 10
          }
        ]
      },
      {
        getExistingPaper: vi.fn(async () => ({
          id: "2401.00001",
          revisionMs: 11
        })),
        fetchPaper,
        savePaperRecord
      }
    );

    expect(result).toEqual({
      restoredIds: [],
      skippedIds: ["2401.00001"],
      failed: []
    });
    expect(fetchPaper).not.toHaveBeenCalled();
    expect(savePaperRecord).not.toHaveBeenCalled();
  });

  it("reports PDF fallbacks as html_unavailable failures", async () => {
    const result = await restoreFromUrlManifest(
      {
        schemaVersion: 1,
        exportedAt: "2026-03-10T00:00:00.000Z",
        appVersion: "0.4.0",
        origin: "https://reader.example",
        papers: [
          {
            id: "2401.00002",
            title: "Fallback",
            sourceUrl: "https://arxiv.org/abs/2401.00002",
            updatedAt: "2026-01-02T00:00:00.000Z",
            savedAt: "2026-01-02T00:00:00.000Z",
            revisionMs: 20
          }
        ]
      },
      {
        getExistingPaper: vi.fn(async () => null),
        fetchPaper: vi.fn(async () => ({
          id: "2401.00002",
          view: "pdf"
        })),
        savePaperRecord: vi.fn()
      }
    );

    expect(result).toEqual({
      restoredIds: [],
      skippedIds: [],
      failed: [
        {
          id: "2401.00002",
          reason: "html_unavailable"
        }
      ]
    });
  });

  it("restores HTML papers and reports progress", async () => {
    const onProgress = vi.fn();
    const savePaperRecord = vi.fn(async () => null);
    const result = await restoreFromUrlManifest(
      {
        schemaVersion: 1,
        exportedAt: "2026-03-10T00:00:00.000Z",
        appVersion: "0.4.0",
        origin: "https://reader.example",
        papers: [
          {
            id: "2401.00003",
            title: "Restore me",
            sourceUrl: "https://arxiv.org/abs/2401.00003",
            updatedAt: "2026-01-03T00:00:00.000Z",
            savedAt: "2026-01-03T00:00:00.000Z",
            revisionMs: 30
          }
        ]
      },
      {
        getExistingPaper: vi.fn(async () => null),
        fetchPaper: vi.fn(async (id, options) => ({
          id,
          sourceUrl: options.sourceUrl,
          ar5ivUrl: `https://arxiv.org/html/${id}`,
          html: "<article class=\"ltx_document\"></article>",
          titleHint: options.titleHint,
          view: "html"
        })),
        savePaperRecord,
        onProgress
      }
    );

    expect(result).toEqual({
      restoredIds: ["2401.00003"],
      skippedIds: [],
      failed: []
    });
    expect(savePaperRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "2401.00003",
        title: "Restore me"
      }),
      {
        deviceId: "local"
      }
    );
    expect(onProgress).toHaveBeenLastCalledWith({
      total: 1,
      completed: 1,
      currentId: "2401.00003",
      result: {
        restoredIds: ["2401.00003"],
        skippedIds: [],
        failed: []
      }
    });
  });
});
