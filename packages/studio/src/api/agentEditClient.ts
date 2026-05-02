import type { AgentEditRequest, AgentEditResponse } from "../types/agentEdit";

async function requestAgentEdit(
  request: AgentEditRequest,
  mode: "preview" | "apply",
): Promise<AgentEditResponse> {
  const projectId = encodeURIComponent(request.projectId);
  const response = await fetch(`/api/projects/${projectId}/agent/edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, mode }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : `Agent edit failed (${response.status})`,
    );
  }
  return payload as AgentEditResponse;
}

export function previewAgentEdit(request: AgentEditRequest): Promise<AgentEditResponse> {
  return requestAgentEdit(request, "preview");
}

export function applyAgentEdit(request: AgentEditRequest): Promise<AgentEditResponse> {
  return requestAgentEdit(request, "apply");
}
