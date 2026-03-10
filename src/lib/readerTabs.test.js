import { describe, expect, it } from "vitest";
import { getNextTabAfterClose, reorderReaderTabs, upsertReaderTab } from "./readerTabs";

describe("upsertReaderTab", () => {
  it("appends new tabs on the right by default", () => {
    const currentTabs = [
      { key: "paper:a", id: "a", title: "Paper A" },
      { key: "paper:b", id: "b", title: "Paper B" }
    ];

    expect(
      upsertReaderTab(currentTabs, { key: "paper:c", id: "c", title: "Paper C" })
    ).toEqual([
      { key: "paper:a", id: "a", title: "Paper A" },
      { key: "paper:b", id: "b", title: "Paper B" },
      { key: "paper:c", id: "c", title: "Paper C" }
    ]);
  });

  it("updates an existing tab without changing its position", () => {
    const currentTabs = [
      { key: "paper:a", id: "a", title: "Paper A" },
      { key: "paper:b", id: "b", title: "Paper B", status: "loading" },
      { key: "paper:c", id: "c", title: "Paper C" }
    ];

    expect(
      upsertReaderTab(currentTabs, { key: "paper:b", title: "Resolved B", status: "ready" })
    ).toEqual([
      { key: "paper:a", id: "a", title: "Paper A" },
      { key: "paper:b", id: "b", title: "Resolved B", status: "ready" },
      { key: "paper:c", id: "c", title: "Paper C" }
    ]);
  });
});

describe("reorderReaderTabs", () => {
  const currentTabs = [
    { key: "paper:a", id: "a" },
    { key: "paper:b", id: "b" },
    { key: "paper:c", id: "c" }
  ];

  it("moves a tab before the drop target", () => {
    expect(reorderReaderTabs(currentTabs, "paper:c", "paper:a")).toEqual([
      { key: "paper:c", id: "c" },
      { key: "paper:a", id: "a" },
      { key: "paper:b", id: "b" }
    ]);
  });

  it("moves a tab after the drop target", () => {
    expect(reorderReaderTabs(currentTabs, "paper:a", "paper:b", "after")).toEqual([
      { key: "paper:b", id: "b" },
      { key: "paper:a", id: "a" },
      { key: "paper:c", id: "c" }
    ]);
  });
});

describe("getNextTabAfterClose", () => {
  it("prefers the tab to the right, then falls back to the left", () => {
    const currentTabs = [
      { key: "paper:a", id: "a" },
      { key: "paper:b", id: "b" },
      { key: "paper:c", id: "c" }
    ];

    expect(getNextTabAfterClose(currentTabs, "paper:b")).toEqual({ key: "paper:c", id: "c" });
    expect(getNextTabAfterClose(currentTabs, "paper:c")).toEqual({ key: "paper:b", id: "b" });
  });
});
