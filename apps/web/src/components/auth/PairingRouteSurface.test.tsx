import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { GitHubDeviceCode } from "./PairingRouteSurface";

describe("GitHubDeviceCode", () => {
  it("renders the device code with an accessible copy control", () => {
    const markup = renderToStaticMarkup(
      <GitHubDeviceCode userCode="ABCD-1234" verificationUri="https://github.com/login/device" />,
    );

    expect(markup).toContain("ABCD-1234");
    expect(markup).toContain("https://github.com/login/device");
    expect(markup).toContain('aria-label="Copy GitHub device code"');
    expect(markup).toContain('title="Copy code"');
  });
});
