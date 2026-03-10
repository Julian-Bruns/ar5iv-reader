import { describe, expect, it } from "vitest";
import { resolveLaunchTarget } from "./launchTarget";

describe("resolveLaunchTarget", () => {
  it("ignores invalid launch targets", () => {
    expect(
      resolveLaunchTarget({
        currentUrl: "https://reader.example/",
        targetUrl: "not a valid url %",
        origin: "https://reader.example"
      })
    ).toEqual({
      type: "ignore",
      nextUrl: ""
    });
  });

  it("ignores cross-origin launch targets", () => {
    expect(
      resolveLaunchTarget({
        currentUrl: "https://reader.example/",
        targetUrl: "https://arxiv.org/abs/2603.04211",
        origin: "https://reader.example"
      })
    ).toEqual({
      type: "ignore",
      nextUrl: ""
    });
  });

  it("refreshes when the launched URL matches the current route", () => {
    expect(
      resolveLaunchTarget({
        currentUrl: "https://reader.example/receive?url=https%3A%2F%2Farxiv.org%2Fabs%2F2603.04211",
        targetUrl: new URL(
          "https://reader.example/receive?url=https%3A%2F%2Farxiv.org%2Fabs%2F2603.04211"
        ),
        origin: "https://reader.example"
      })
    ).toEqual({
      type: "refresh",
      nextUrl: "/receive?url=https%3A%2F%2Farxiv.org%2Fabs%2F2603.04211"
    });
  });

  it("navigates to a new same-origin route", () => {
    expect(
      resolveLaunchTarget({
        currentUrl: "https://reader.example/",
        targetUrl: "/receive?url=https%3A%2F%2Farxiv.org%2Fabs%2F2603.04167",
        origin: "https://reader.example"
      })
    ).toEqual({
      type: "navigate",
      nextUrl: "/receive?url=https%3A%2F%2Farxiv.org%2Fabs%2F2603.04167"
    });
  });
});
