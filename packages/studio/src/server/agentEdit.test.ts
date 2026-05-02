import { describe, expect, it } from "vitest";
import { generateAgentEdit, validateAgentEditRequest } from "./agentEdit";

describe("agent edit server utility", () => {
  it("validates minimum request shape and file safety", () => {
    expect(
      validateAgentEditRequest({
        projectId: "demo",
        prompt: "change",
        mode: "preview",
        files: { "index.html": "<h1>Hello</h1>" },
      }).ok,
    ).toBe(true);
    expect(validateAgentEditRequest({ projectId: "", prompt: "", mode: "apply" }).ok).toBe(false);
    expect(
      validateAgentEditRequest({
        projectId: "demo",
        prompt: "change",
        mode: "preview",
        files: { "../secret": "nope" },
      }).ok,
    ).toBe(false);
  });

  it("returns structured patch operations for selected element text edits", async () => {
    const response = await generateAgentEdit({
      projectId: "demo",
      prompt: 'change headline text to "Launch Day"',
      mode: "preview",
      files: { "index.html": '<h1 id="hero-title">Hello</h1>' },
      elements: [{ id: "hero-title", tag: "h1", sourceFile: "index.html" }],
    });
    expect(response.mode).toBe("preview");
    expect(response.validation.ok).toBe(true);
    expect(response.operations[0]).toMatchObject({
      filePath: "index.html",
      kind: "text-content",
      target: { id: "hero-title" },
      value: "Launch Day",
    });
    expect(response.files?.["index.html"]).toContain(">Launch Day</h1>");
    expect(response.diff).toContain('+<h1 id="hero-title">Launch Day</h1>');
  });

  it("returns structured patch operations for supported typography controls", async () => {
    const response = await generateAgentEdit({
      projectId: "demo",
      prompt: "set letter spacing to 2px",
      mode: "preview",
      files: { "index.html": '<h1 id="hero-title">Hello</h1>' },
      elements: [{ id: "hero-title", tag: "h1", sourceFile: "index.html" }],
    });
    expect(response.validation.ok).toBe(true);
    expect(response.operations[0]).toMatchObject({
      filePath: "index.html",
      kind: "inline-style",
      target: { id: "hero-title" },
      property: "letter-spacing",
      value: "2px",
    });
    expect(response.files?.["index.html"]).toContain('style="letter-spacing: 2px"');
  });

  it("keeps a fallback patch for prompts outside the deterministic controls", async () => {
    const response = await generateAgentEdit({
      projectId: "demo",
      prompt: "make this feel more cinematic",
      mode: "preview",
      files: { "index.html": "<h1>Hello</h1>" },
    });
    expect(response.validation.ok).toBe(true);
    expect(response.operations[0]).toMatchObject({ filePath: "index.html", kind: "replace-file" });
    expect(response.files?.["index.html"]).toContain("Agent edit fallback");
  });

  it("refuses apply without explicit source files", async () => {
    const response = await generateAgentEdit({
      projectId: "demo",
      prompt: "tighten",
      mode: "apply",
    });
    expect(response.ok).toBe(false);
    expect(response.validation.ok).toBe(false);
  });
});
