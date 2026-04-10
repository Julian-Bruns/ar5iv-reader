import { describe, expect, it } from "vitest";
import { createEmptyLibrarySnapshot, mergeLibrarySnapshots } from "./librarySnapshot";

describe("librarySnapshot", () => {
  it("keeps the newer theorem note setting when merging snapshots", () => {
    const left = {
      ...createEmptyLibrarySnapshot(),
      exportedAt: "2026-04-01T00:00:00.000Z",
      settings: [
        {
          key: "theoremNotes",
          value: [
            {
              id: "left-note",
              theoremText: "Older theorem",
              noteText: "Older note"
            }
          ],
          updatedAt: "2026-04-01T08:00:00.000Z"
        }
      ]
    };
    const right = {
      ...createEmptyLibrarySnapshot(),
      exportedAt: "2026-04-02T00:00:00.000Z",
      settings: [
        {
          key: "theoremNotes",
          value: [
            {
              id: "right-note",
              theoremText: "Newer theorem",
              noteText: "Newer note"
            }
          ],
          updatedAt: "2026-04-02T08:00:00.000Z"
        }
      ]
    };

    const merged = mergeLibrarySnapshots(left, right);

    expect(merged.settings).toEqual([
      {
        key: "theoremNotes",
        value: [
          {
            id: "right-note",
            theoremText: "Newer theorem",
            noteText: "Newer note"
          }
        ],
        updatedAt: "2026-04-02T08:00:00.000Z"
      }
    ]);
  });

  it("preserves theorem notes when the incoming snapshot is older", () => {
    const left = {
      ...createEmptyLibrarySnapshot(),
      settings: [
        {
          key: "theoremNotes",
          value: [
            {
              id: "current-note",
              theoremText: "Current theorem",
              noteText: "Current note"
            }
          ],
          updatedAt: "2026-04-03T08:00:00.000Z"
        }
      ]
    };
    const right = {
      ...createEmptyLibrarySnapshot(),
      settings: [
        {
          key: "theoremNotes",
          value: [
            {
              id: "stale-note",
              theoremText: "Stale theorem",
              noteText: "Stale note"
            }
          ],
          updatedAt: "2026-04-01T08:00:00.000Z"
        }
      ]
    };

    const merged = mergeLibrarySnapshots(left, right);

    expect(merged.settings).toEqual([
      {
        key: "theoremNotes",
        value: [
          {
            id: "current-note",
            theoremText: "Current theorem",
            noteText: "Current note"
          }
        ],
        updatedAt: "2026-04-03T08:00:00.000Z"
      }
    ]);
  });
});
