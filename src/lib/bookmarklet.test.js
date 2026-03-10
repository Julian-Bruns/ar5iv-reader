import { describe, expect, it } from "vitest";
import { buildBookmarkletHref } from "./bookmarklet";

describe("buildBookmarkletHref", () => {
  it("navigates the current tab through the receive route", () => {
    const href = buildBookmarkletHref("https://reader.example");

    expect(href.startsWith("javascript:")).toBe(true);
    expect(href).toContain("window.location.assign(receiveUrl.toString());");
    expect(href).not.toContain("target='_blank'");
    expect(href).not.toContain("window.open(receiveUrl.toString()");
  });
});
