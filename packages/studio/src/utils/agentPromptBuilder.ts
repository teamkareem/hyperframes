import type { AgentEditElementContext, AgentEditRequest } from "../types/agentEdit";

export interface BuildAgentEditPromptContextInput {
  userPrompt: string;
  selection?: AgentEditRequest["selection"];
  elements?: AgentEditElementContext[];
  files?: Record<string, string>;
  computedStyles?: Record<string, Record<string, string>>;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, innerValue) => {
      if (innerValue && typeof innerValue === "object" && !Array.isArray(innerValue)) {
        return Object.fromEntries(
          Object.entries(innerValue).sort(([a], [b]) => a.localeCompare(b)),
        );
      }
      return innerValue;
    },
    2,
  );
}

export function buildAgentEditPromptContext(input: BuildAgentEditPromptContextInput): string {
  const context = {
    computedStyles: input.computedStyles ?? {},
    elements: input.elements ?? [],
    files: input.files ?? {},
    selection: input.selection ?? {},
    userPrompt: input.userPrompt,
  };
  return [
    "You are editing a Hyperframes Studio project.",
    "Return AgentEditResponse JSON only. Do not return prose outside JSON.",
    "Use minimal structured operations: inline-style, attribute, text-content, or replace-file.",
    "Never modify files outside the provided project files.",
    stableStringify(context),
  ].join("\n\n");
}
