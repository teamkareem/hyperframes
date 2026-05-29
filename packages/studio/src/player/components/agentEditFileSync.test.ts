import { describe, expect, it, vi } from "vitest";
import { saveChangedProjectFiles } from "./agentEditFileSync";

describe("agent edit project file sync", () => {
  it("writes only changed returned files through the project file API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const changed = await saveChangedProjectFiles({
      projectId: "demo project",
      beforeFiles: {
        "index.html": "before",
        "scenes/hero.html": "same",
      },
      afterFiles: {
        "index.html": "after",
        "scenes/hero.html": "same",
      },
      fetchImpl: fetchMock,
    });

    expect(changed).toEqual({ "index.html": "after" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/demo%20project/files/index.html",
      expect.objectContaining({ method: "PUT", body: "after" }),
    );
  });

  it("supports reverting by writing prior file snapshots", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: "patched" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const reverted = await saveChangedProjectFiles({
      projectId: "demo",
      beforeFiles: { "index.html": "patched" },
      afterFiles: { "index.html": "original" },
      expectedCurrentFiles: { "index.html": "patched" },
      fetchImpl: fetchMock,
    });

    expect(reverted).toEqual({ "index.html": "original" });
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/projects/demo/files/index.html",
      expect.objectContaining({ method: "PUT", body: "original" }),
    );
  });

  it("refuses to revert over user edits made after apply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ content: "user changed after apply" }), { status: 200 }),
      );

    await expect(
      saveChangedProjectFiles({
        projectId: "demo",
        beforeFiles: { "index.html": "patched" },
        afterFiles: { "index.html": "original" },
        expectedCurrentFiles: { "index.html": "patched" },
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("file changed since the patch was applied");
  });

  it("throws when a project file write fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("no", { status: 500 }));

    await expect(
      saveChangedProjectFiles({
        projectId: "demo",
        beforeFiles: { "index.html": "before" },
        afterFiles: { "index.html": "after" },
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("Failed to save index.html");
  });
});
