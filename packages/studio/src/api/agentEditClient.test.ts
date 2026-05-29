import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAgentEdit, previewAgentEdit } from "./agentEditClient";

describe("agent edit client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts preview requests without writing files", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          mode: "preview",
          operations: [],
          validation: { ok: true, messages: [] },
        }),
        { status: 200 },
      ),
    );
    await previewAgentEdit({ projectId: "demo", prompt: "test", mode: "preview" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/demo/agent/edit",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      mode: "preview",
    });
  });

  it("throws on failed responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    );
    await expect(
      applyAgentEdit({ projectId: "demo", prompt: "test", mode: "apply" }),
    ).rejects.toThrow("bad request");
  });
});
