import { describe, expect, it } from "vitest";
import {
  buildTheoremCopyText,
  createTheoremNoteRecord,
  normalizeTheoremNotes
} from "./theoremNotes";

describe("theoremNotes", () => {
  it("creates a trimmed note record from theorem payload metadata", () => {
    const payload = {
      paperId: "2401.00001",
      paperTitle: "Test Paper",
      theoremId: "thm-1",
      theoremTitle: "Theorem 1",
      theoremTextWithoutProof: "Every test should be deterministic.",
      theoremTextWithProof: "Every test should be deterministic. Proof omitted.",
      referenceLabel: "2401.00001 • Theorem 1",
      referenceUrl: "https://ar5iv.org/html/2401.00001#thm-1"
    };

    const record = createTheoremNoteRecord(payload, "  Important follow-up.  ", {
      speechTranscript: "integral from zero to one",
      mathLatex: "\\int_0^1",
      speechModel: "Xenova/whisper-base",
      mathModel: "DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC",
      aiGeneratedAt: "2026-04-10T09:00:00.000Z"
    });

    expect(record).toEqual(
      expect.objectContaining({
        paperId: "2401.00001",
        paperTitle: "Test Paper",
        theoremId: "thm-1",
        theoremTitle: "Theorem 1",
        theoremText: "Every test should be deterministic.",
        referenceLabel: "2401.00001 • Theorem 1",
        referenceUrl: "https://ar5iv.org/html/2401.00001#thm-1",
        noteText: "Important follow-up.",
        speechTranscript: "integral from zero to one",
        mathLatex: "\\int_0^1",
        speechModel: "Xenova/whisper-base",
        mathModel: "DeepSeek-R1-Distill-Qwen-1.5B-q4f32_1-MLC",
        aiGeneratedAt: "2026-04-10T09:00:00.000Z",
        createdAt: expect.any(String),
        updatedAt: expect.any(String)
      })
    );
    expect(record.id).toMatch(/^2401\.00001::thm-1::\d+::[a-z0-9]+$/);
    expect(record.updatedAt).toBe(record.createdAt);
  });

  it("rejects empty notes", () => {
    expect(createTheoremNoteRecord({ theoremTextWithoutProof: "Theorem" }, "   ")).toBeNull();
    expect(createTheoremNoteRecord(null, "Useful")).toBeNull();
  });

  it("normalizes, filters, and sorts stored notes by recency", () => {
    const notes = normalizeTheoremNotes([
      {
        id: "older",
        paperId: "2401.00001",
        theoremText: "Old theorem",
        noteText: "  Old note  ",
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-01T11:00:00.000Z"
      },
      {
        id: "invalid-empty-note",
        theoremText: "Ignored theorem",
        noteText: "   "
      },
      {
        id: "newer",
        paperId: "2402.00002",
        theoremTitle: "Theorem 2",
        theoremText: "New theorem",
        noteText: "New note",
        createdAt: "invalid",
        updatedAt: "2026-04-02T09:30:00.000Z"
      },
      {
        id: "invalid-empty-theorem",
        theoremText: "   ",
        noteText: "Ignored note"
      }
    ]);

    expect(notes).toEqual([
      expect.objectContaining({
        id: "newer",
        theoremTitle: "Theorem 2",
        theoremText: "New theorem",
        noteText: "New note",
        speechTranscript: "",
        mathLatex: "",
        createdAt: new Date(0).toISOString(),
        updatedAt: "2026-04-02T09:30:00.000Z"
      }),
      expect.objectContaining({
        id: "older",
        theoremText: "Old theorem",
        noteText: "Old note",
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-01T11:00:00.000Z"
      })
    ]);
  });

  it("builds theorem copy text with or without proof and reference metadata", () => {
    const payload = {
      theoremTextWithoutProof: "Statement only.",
      theoremTextWithProof: "Statement and proof.",
      referenceUrl: "https://ar5iv.org/html/2401.00001#thm-1",
      referenceLabel: "2401.00001 • Theorem 1"
    };

    expect(buildTheoremCopyText(payload)).toBe(
      "Statement only.\n\nReference: https://ar5iv.org/html/2401.00001#thm-1"
    );
    expect(buildTheoremCopyText(payload, { includeProof: true })).toBe(
      "Statement and proof.\n\nReference: https://ar5iv.org/html/2401.00001#thm-1"
    );
  });
});
