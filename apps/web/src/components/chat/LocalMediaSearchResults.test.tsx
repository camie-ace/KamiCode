import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { LocalMediaSearchResults } from "./LocalMediaSearchResults";

describe("LocalMediaSearchResults", () => {
  it("renders ranked result cues, scope, broad-PC warning, and refinements", () => {
    const markup = renderToStaticMarkup(
      <LocalMediaSearchResults
        resultSet={{
          id: "search-1",
          kind: "local-media-search-results",
          query: "hero",
          total: 5,
          scope: {
            kind: "explicit-broad-pc",
            label: "Broad PC search",
            detail: String.raw`C:\Users\camie\Pictures`,
            rootHints: [String.raw`C:\Users\camie\Pictures`],
            broadPc: true,
            refinements: [
              {
                id: "current-workspace",
                label: "Current workspace",
                description: "Narrow to the active workspace.",
                scope: "current-workspace",
                rootHints: [],
              },
              {
                id: "pictures",
                label: "Pictures",
                description: "Limit results to Pictures.",
                scope: "explicit-broad-pc",
                rootHints: [String.raw`C:\Users\camie\Pictures`],
              },
            ],
          },
          results: [
            {
              id: "hero",
              kind: "image",
              source: "local",
              title: "hero.png",
              path: String.raw`C:\Users\camie\Pictures\hero.png`,
              extension: "png",
              rank: 1,
              confidence: "high",
              score: 92,
              modifiedAt: "2026-06-25T10:00:00.000Z",
            },
          ],
        }}
        environmentId={EnvironmentId.make("environment-local")}
        threadRef={null}
        renderArtifactCard={({ artifact }) => (
          <div data-testid="result-card">Card for {artifact.title}</div>
        )}
      />,
    );

    expect(markup).toContain("Local media results for &quot;hero&quot;");
    expect(markup).toContain("1 result of 5 in Broad PC search");
    expect(markup).toContain("Scope: Broad PC search");
    expect(markup).toContain("Broad PC scope");
    expect(markup).toContain("Refine broad scope");
    expect(markup).toContain("Current workspace");
    expect(markup).toContain("Pictures");
    expect(markup).toContain("#1");
    expect(markup).toContain("High confidence");
    expect(markup).toContain("Score 92");
    expect(markup).toContain("Modified Jun 25, 2026");
    expect(markup).toContain("Card for hero.png");
  });
});
