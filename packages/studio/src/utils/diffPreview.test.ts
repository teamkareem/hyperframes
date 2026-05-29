import { describe, expect, it } from "vitest";
import { buildUnifiedDiffPreview } from "./diffPreview";

describe("buildUnifiedDiffPreview", () => {
  it("shows removed and added lines for changed files", () => {
    expect(
      buildUnifiedDiffPreview(
        { "index.html": "<h1>Old</h1>\n" },
        { "index.html": "<h1>New</h1>\n" },
      ),
    ).toContain("-<h1>Old</h1>");
    expect(
      buildUnifiedDiffPreview(
        { "index.html": "<h1>Old</h1>\n" },
        { "index.html": "<h1>New</h1>\n" },
      ),
    ).toContain("+<h1>New</h1>");
  });
});
