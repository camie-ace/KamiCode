import { describe, expect, it } from "vite-plus/test";

import {
  HostedBrowserProxyUrlError,
  isHostedBrowserProxyUrl,
  parseHostedBrowserProxyUrl,
} from "./hostedBrowserProxy.ts";

describe("hosted browser proxy URLs", () => {
  it("splits credentials from the server address", () => {
    expect(parseHostedBrowserProxyUrl(" http://user%40pool:pa%3Ass@proxy.example:12321 ")).toEqual({
      server: "http://proxy.example:12321",
      username: "user@pool",
      password: "pa:ss",
    });
  });

  it("accepts supported unauthenticated proxy protocols", () => {
    expect(parseHostedBrowserProxyUrl("socks5://127.0.0.1:1080")).toEqual({
      server: "socks5://127.0.0.1:1080",
    });
    expect(isHostedBrowserProxyUrl("https://proxy.example:8443")).toBe(true);
  });

  it("rejects URLs that are not proxy endpoints", () => {
    for (const value of [
      "ftp://proxy.example:21",
      "https://proxy.example/path",
      "https://proxy.example?session=secret",
      "not a url",
    ]) {
      expect(() => parseHostedBrowserProxyUrl(value)).toThrow(HostedBrowserProxyUrlError);
      expect(isHostedBrowserProxyUrl(value)).toBe(false);
    }
  });

  it("treats an empty value as no proxy", () => {
    expect(parseHostedBrowserProxyUrl("   ")).toBeNull();
    expect(isHostedBrowserProxyUrl("   ")).toBe(false);
  });
});
