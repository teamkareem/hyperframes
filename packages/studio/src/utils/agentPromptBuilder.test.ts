import { describe, expect, it } from "vitest";
import { buildAgentEditPromptContext } from "./agentPromptBuilder";

describe("buildAgentEditPromptContext", () => {
  it("builds deterministic JSON context with selection, timeline, styles, files, and schema guidance", () => {
    const prompt = buildAgentEditPromptContext({
      userPrompt: "Make the headline tighter",
      selection: {
        timelineRange: { start: 1, end: 3 },
        canvasSelections: [
          { kind: "region", boundingBox: { x: 10, y: 20, width: 30, height: 40 } },
        ],
      },
      elements: [{ id: "headline", tag: "h1", start: 1, duration: 2, track: 0 }],
      files: { "index.html": '<h1 id="headline">Hi</h1>' },
      computedStyles: { headline: { "letter-spacing": "0px" } },
    });

    expect(prompt).toContain("Return AgentEditResponse JSON only");
    expect(prompt.indexOf('"computedStyles"')).toBeLessThan(prompt.indexOf('"elements"'));
    expect(prompt).toContain('"userPrompt": "Make the headline tighter"');
    expect(prompt).toContain('"index.html"');
  });
});
