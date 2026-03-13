import { describe, expect, it } from "vitest";
import { isReceiveIngressUrl, readReceivePayload } from "./receiveIngress";

describe("receiveIngress", () => {
  it("treats the dedicated receive route as ingress", () => {
    const url = new URL("https://reader.example/receive?url=https%3A%2F%2Farxiv.org%2Fabs%2F2603.04211");

    expect(isReceiveIngressUrl(url)).toBe(true);
    expect(readReceivePayload(url)).toEqual({
      url: "https://arxiv.org/abs/2603.04211",
      text: "",
      title: ""
    });
  });

  it("treats the root route with receive query params as ingress", () => {
    const url = new URL("https://reader.example/?url=https%3A%2F%2Farxiv.org%2Fabs%2F2603.04167");

    expect(isReceiveIngressUrl(url)).toBe(true);
    expect(readReceivePayload(url)).toEqual({
      url: "https://arxiv.org/abs/2603.04167",
      text: "",
      title: ""
    });
  });

  it("uses protocol payloads on the root route", () => {
    const url = new URL("https://reader.example/?protocol=web%2Bar5iv%3A%2F%2Fopen");
    const protocolPayload = {
      url: "https://arxiv.org/abs/2603.09999",
      text: "ignored",
      title: "ignored"
    };

    expect(isReceiveIngressUrl(url, protocolPayload)).toBe(true);
    expect(readReceivePayload(url, protocolPayload)).toEqual({
      url: "https://arxiv.org/abs/2603.09999",
      text: "ignored",
      title: "ignored"
    });
  });

  it("does not treat the plain library route as ingress", () => {
    const url = new URL("https://reader.example/?paper=2603.04211");

    expect(isReceiveIngressUrl(url)).toBe(false);
  });
});
