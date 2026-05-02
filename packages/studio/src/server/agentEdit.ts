import type { AgentEditOperation, AgentEditRequest, AgentEditResponse } from "../types/agentEdit";
import { buildUnifiedDiffPreview } from "../utils/diffPreview";
import { applyBatchedPatches, type BatchedPatchOperation } from "../utils/sourcePatcher";

const MAX_PROMPT_LENGTH = 8_000;
const MAX_FILE_COUNT = 20;
const MAX_FILE_BYTES = 750_000;

function isSafeProjectPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part === ".." || part === "")
  );
}

function validateFiles(
  files: unknown,
  messages: string[],
): files is Record<string, string> | undefined {
  if (files == null) return true;
  if (typeof files !== "object" || Array.isArray(files)) {
    messages.push("files must be an object of project-relative paths to source text");
    return false;
  }

  const entries = Object.entries(files);
  if (entries.length > MAX_FILE_COUNT)
    messages.push(`files may include at most ${MAX_FILE_COUNT} files`);
  for (const [path, content] of entries) {
    if (!isSafeProjectPath(path)) messages.push(`Unsafe file path: ${path}`);
    if (typeof content !== "string") {
      messages.push(`File ${path} must be text`);
      continue;
    }
    if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) {
      messages.push(`File ${path} exceeds ${MAX_FILE_BYTES} bytes`);
    }
  }
  return true;
}

export function validateAgentEditRequest(value: unknown): {
  ok: boolean;
  messages: string[];
  request?: AgentEditRequest;
} {
  const messages: string[] = [];
  if (!value || typeof value !== "object")
    return { ok: false, messages: ["Request body must be an object"] };
  const request = value as Partial<AgentEditRequest>;
  if (!request.projectId || typeof request.projectId !== "string")
    messages.push("projectId is required");
  if (!request.prompt || typeof request.prompt !== "string") messages.push("prompt is required");
  if (typeof request.prompt === "string" && request.prompt.length > MAX_PROMPT_LENGTH) {
    messages.push(`prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`);
  }
  if (request.mode !== "preview" && request.mode !== "apply")
    messages.push("mode must be preview or apply");
  validateFiles(request.files, messages);
  return { ok: messages.length === 0, messages, request: request as AgentEditRequest };
}

function selectedTarget(request: AgentEditRequest): {
  filePath?: string;
  target?: AgentEditOperation["target"];
} {
  const selectedElement = request.elements?.[0];
  const selectedCanvasElement = request.selection?.canvasSelections?.find(
    (selection) => selection.kind === "element",
  );
  const canvasSelector =
    selectedCanvasElement?.kind === "element" ? selectedCanvasElement.selector : undefined;

  return {
    filePath: selectedElement?.sourceFile,
    target: {
      id: selectedElement?.id ?? null,
      selector: selectedElement?.selector ?? canvasSelector,
    },
  };
}

function quotedValue(prompt: string): string | null {
  return (
    prompt.match(/["“]([^"”]+)["”]/)?.[1]?.trim() ??
    prompt.match(/[']([^']+)[']/)?.[1]?.trim() ??
    null
  );
}

function firstCssLength(prompt: string): string | null {
  return prompt.match(/(-?\d+(?:\.\d+)?(?:px|rem|em|%)?)/i)?.[1] ?? null;
}

function buildStyleOperation(
  request: AgentEditRequest,
  filePath: string,
  target: AgentEditOperation["target"],
): AgentEditOperation | null {
  const prompt = request.prompt.toLowerCase();
  const length = firstCssLength(request.prompt);
  if (!length) return null;

  const value = /(?:px|rem|em|%)$/i.test(length) ? length : `${length}px`;
  const property =
    prompt.includes("letter spacing") ||
    prompt.includes("letter-spacing") ||
    prompt.includes("kerning")
      ? "letter-spacing"
      : prompt.includes("line height") || prompt.includes("line-height")
        ? "line-height"
        : prompt.includes("font size") || prompt.includes("font-size")
          ? "font-size"
          : /\bwidth\b/.test(prompt)
            ? "width"
            : /\bheight\b/.test(prompt)
              ? "height"
              : /\b(?:x|left)\b/.test(prompt)
                ? "left"
                : /\b(?:y|top)\b/.test(prompt)
                  ? "top"
                  : null;

  if (!property) return null;
  return { kind: "inline-style", filePath, target, property, value };
}

function buildTextOperation(
  request: AgentEditRequest,
  filePath: string,
  target: AgentEditOperation["target"],
): AgentEditOperation | null {
  const prompt = request.prompt.toLowerCase();
  if (!/(?:text|copy|content|headline|title)/.test(prompt)) return null;
  const value = quotedValue(request.prompt);
  if (!value) return null;
  return { kind: "text-content", filePath, target, value };
}

function buildDeterministicOperations(
  request: AgentEditRequest,
  firstPath: string,
): AgentEditOperation[] {
  const selected = selectedTarget(request);
  const filePath =
    selected.filePath && request.files?.[selected.filePath] != null ? selected.filePath : firstPath;
  const target = selected.target;

  if (target?.id || target?.selector) {
    const promptOperations = [
      buildTextOperation(request, filePath, target),
      buildStyleOperation(request, filePath, target),
    ].filter((operation): operation is AgentEditOperation => Boolean(operation));
    if (promptOperations.length > 0) return promptOperations;
  }

  const safePrompt = request.prompt.replace(/-->/g, "-").trim();
  return [
    {
      kind: "replace-file",
      filePath: firstPath,
      value: `<!-- Agent edit fallback: provider routing pending; requested: ${safePrompt} -->\n${
        request.files?.[firstPath] ?? ""
      }`.trimEnd(),
    },
  ];
}

function applyAgentOperations(
  files: Record<string, string>,
  operations: AgentEditOperation[],
): { ok: boolean; files: Record<string, string>; messages: string[] } {
  const nextFiles = { ...files };
  const patchOps: BatchedPatchOperation[] = [];

  for (const [index, op] of operations.entries()) {
    if (!isSafeProjectPath(op.filePath)) {
      return {
        ok: false,
        files,
        messages: [`Operation ${index}: unsafe file path ${op.filePath}`],
      };
    }
    if (op.kind === "replace-file") {
      if (typeof op.value !== "string") {
        return {
          ok: false,
          files,
          messages: [`Operation ${index}: replace-file requires string value`],
        };
      }
      nextFiles[op.filePath] = op.value;
      continue;
    }
    if (!op.target) {
      return { ok: false, files, messages: [`Operation ${index}: ${op.kind} requires a target`] };
    }
    if (!op.property && op.kind !== "text-content") {
      return { ok: false, files, messages: [`Operation ${index}: ${op.kind} requires a property`] };
    }
    patchOps.push({
      filePath: op.filePath,
      target: op.target,
      operation: {
        type: op.kind,
        property: op.property ?? "textContent",
        value: op.value,
      },
    });
  }

  const patched = applyBatchedPatches(nextFiles, patchOps);
  if (!patched.ok) return { ok: false, files, messages: patched.errors };
  return { ok: true, files: patched.files, messages: ["Structured operations validated"] };
}

export async function generateAgentEdit(request: AgentEditRequest): Promise<AgentEditResponse> {
  const files = request.files ?? {};
  const firstPath = Object.keys(files).sort()[0];
  if (!firstPath) {
    return {
      ok: false,
      mode: request.mode,
      summary: "No editable project files were provided",
      operations: [],
      files,
      diff: "",
      validation: {
        ok: false,
        messages: ["At least one source file is required for preview/apply"],
      },
    };
  }

  // Provider integration lands behind this stable boundary. Until model routing is wired,
  // use deterministic prompt-to-operation parsing for the supported manual controls so
  // preview/apply exercise real structured patch validation, diff, and persistence paths.
  const operations = buildDeterministicOperations(request, firstPath);
  const applied = applyAgentOperations(files, operations);
  const diff = buildUnifiedDiffPreview(files, applied.files);
  return {
    ok: applied.ok,
    mode: request.mode,
    summary: applied.ok
      ? request.mode === "preview"
        ? "Patch preview ready"
        : "Patch applied to returned project files"
      : "Patch validation failed",
    operations,
    files: applied.files,
    diff,
    validation: { ok: applied.ok, messages: applied.messages },
  };
}
