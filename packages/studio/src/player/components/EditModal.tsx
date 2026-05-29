import { useState, useCallback, useMemo, useRef } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { usePlayerStore } from "../store/playerStore";
import { useStudioSelectionStore } from "../store/selectionStore";
import { formatTime } from "../lib/time";
import { buildPromptCopyText, buildTimelineAgentPrompt } from "./timelineEditing";
import { copyTextToClipboard } from "../../utils/clipboard";
import { previewAgentEdit } from "../../api/agentEditClient";
import type { AgentEditRequest, AgentEditResponse } from "../../types/agentEdit";
import { saveChangedProjectFiles } from "./agentEditFileSync";

interface EditPopoverProps {
  rangeStart: number;
  rangeEnd: number;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
  onProjectFilesChanged?: (files: Record<string, string>) => void;
}

export function EditPopover({
  rangeStart,
  rangeEnd,
  anchorX,
  anchorY,
  onClose,
  onProjectFilesChanged,
}: EditPopoverProps) {
  const elements = usePlayerStore((s) => s.elements);
  const canvasSelections = useStudioSelectionStore((s) => s.canvasSelections);
  const [prompt, setPrompt] = useState("");
  const [copiedAgentPrompt, setCopiedAgentPrompt] = useState(false);
  const [copiedPromptOnly, setCopiedPromptOnly] = useState(false);
  const [agentResponse, setAgentResponse] = useState<AgentEditResponse | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<
    "idle" | "previewing" | "ready" | "applying" | "applied" | "reverting"
  >("idle");
  const [lastPreviewRequest, setLastPreviewRequest] = useState<AgentEditRequest | null>(null);
  const [lastAppliedSnapshot, setLastAppliedSnapshot] = useState<{
    projectId: string;
    beforeFiles: Record<string, string>;
    afterFiles: Record<string, string>;
  } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const start = Math.min(rangeStart, rangeEnd);
  const end = Math.max(rangeStart, rangeEnd);

  const elementsInRange = useMemo(() => {
    return elements.filter((el) => {
      const elEnd = el.start + el.duration;
      return el.start < end && elEnd > start;
    });
  }, [elements, start, end]);

  useMountEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  });

  useMountEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useMountEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => window.addEventListener("mousedown", handleClick), 100);
    return () => window.removeEventListener("mousedown", handleClick);
  });

  const buildClipboardText = useCallback(() => {
    return buildTimelineAgentPrompt({
      rangeStart: start,
      rangeEnd: end,
      elements: elementsInRange,
      prompt,
    });
  }, [start, end, elementsInRange, prompt]);

  const handleCopy = useCallback(async () => {
    const copied = await copyTextToClipboard(buildClipboardText());
    if (!copied) return;
    setCopiedAgentPrompt(true);
    setTimeout(() => {
      setCopiedAgentPrompt(false);
      onClose();
    }, 800);
  }, [buildClipboardText, onClose]);

  const handleCopyPrompt = useCallback(async () => {
    const promptText = buildPromptCopyText(prompt);
    if (!promptText) return;
    const copied = await copyTextToClipboard(promptText);
    if (!copied) return;
    setCopiedPromptOnly(true);
    setTimeout(() => {
      setCopiedPromptOnly(false);
    }, 800);
  }, [prompt]);

  const buildAgentEditRequest = useCallback(
    async (mode: "preview" | "apply"): Promise<AgentEditRequest> => {
      const projectId = window.location.hash.match(/^#project\/([^/]+)/)?.[1] ?? "demo";
      const filePaths = Array.from(
        new Set(
          elementsInRange
            .map((el) => el.sourceFile)
            .filter((path): path is string => Boolean(path)),
        ),
      );
      if (filePaths.length === 0) filePaths.push("index.html");

      const files: Record<string, string> = {};
      await Promise.all(
        filePaths.map(async (path) => {
          const response = await fetch(
            `/api/projects/${projectId}/files/${encodeURIComponent(path)}`,
          );
          if (!response.ok) throw new Error(`Failed to read ${path}`);
          const data = (await response.json()) as { content?: string };
          if (typeof data.content !== "string")
            throw new Error(`Missing file contents for ${path}`);
          files[path] = data.content;
        }),
      );

      const computedStyles = Object.fromEntries(
        canvasSelections
          .filter((selection) => selection.kind === "element")
          .map((selection) => [selection.selector, selection.computedStyles ?? {}]),
      );

      return {
        projectId,
        prompt,
        mode,
        selection: {
          timelineRange: { start, end },
          canvasSelections,
        },
        elements: elementsInRange.map((el) => ({
          id: el.id,
          tag: el.tag,
          start: el.start,
          duration: el.duration,
          track: el.track,
          selector: el.selector,
          sourceFile: el.sourceFile,
        })),
        files,
        computedStyles,
      };
    },
    [canvasSelections, elementsInRange, end, prompt, start],
  );

  const handlePreviewPatch = useCallback(async () => {
    setAgentError(null);
    setAgentStatus("previewing");
    try {
      const request = await buildAgentEditRequest("preview");
      const response = await previewAgentEdit(request);
      setLastPreviewRequest(request);
      setAgentResponse(response);
      setAgentStatus("ready");
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Patch preview failed");
      setAgentStatus("idle");
    }
  }, [buildAgentEditRequest]);

  const handleApplyPatch = useCallback(async () => {
    setAgentError(null);
    setAgentStatus("applying");
    try {
      const request = lastPreviewRequest;
      const response = agentResponse;
      if (!request || !response?.files) throw new Error("Preview the patch before applying it");
      if (request.prompt !== prompt)
        throw new Error("Prompt changed after preview; preview again before applying");
      if (response.validation.ok) {
        const changedFiles = await saveChangedProjectFiles({
          projectId: request.projectId,
          beforeFiles: request.files ?? {},
          afterFiles: response.files,
        });
        setLastAppliedSnapshot({
          projectId: request.projectId,
          beforeFiles: Object.fromEntries(
            Object.keys(changedFiles).map((path) => [path, request.files?.[path] ?? ""]),
          ),
          afterFiles: changedFiles,
        });
        onProjectFilesChanged?.(changedFiles);
      }
      setAgentStatus(response.validation.ok ? "applied" : "ready");
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Apply patch failed");
      setAgentStatus("ready");
    }
  }, [agentResponse, lastPreviewRequest, onProjectFilesChanged, prompt]);

  const handleRevertPatch = useCallback(async () => {
    if (!lastAppliedSnapshot) return;
    setAgentError(null);
    setAgentStatus("reverting");
    try {
      const revertedFiles = await saveChangedProjectFiles({
        projectId: lastAppliedSnapshot.projectId,
        beforeFiles: lastAppliedSnapshot.afterFiles,
        afterFiles: lastAppliedSnapshot.beforeFiles,
        expectedCurrentFiles: lastAppliedSnapshot.afterFiles,
      });
      onProjectFilesChanged?.(revertedFiles);
      setLastAppliedSnapshot(null);
      setAgentStatus("ready");
      setAgentResponse((response) =>
        response
          ? {
              ...response,
              summary: "Last patch reverted",
              validation: { ok: true, messages: ["Reverted last applied patch"] },
            }
          : response,
      );
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Revert patch failed");
      setAgentStatus("applied");
    }
  }, [lastAppliedSnapshot, onProjectFilesChanged]);

  const previewMatchesPrompt = Boolean(
    agentResponse && lastPreviewRequest && lastPreviewRequest.prompt === prompt,
  );

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.max(8, Math.min(anchorX - 160, window.innerWidth - 336)),
    top: Math.max(8, anchorY - 280),
    zIndex: 200,
  };

  return (
    <div ref={popoverRef} style={style}>
      <div className="w-80 bg-neutral-900 border border-neutral-700/60 rounded-xl shadow-2xl shadow-black/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/60">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-studio-accent" />
            <span className="text-[11px] font-medium text-neutral-300">
              {formatTime(start)} — {formatTime(end)}
            </span>
          </div>
          <span className="text-[10px] text-neutral-600">
            {elementsInRange.length} element{elementsInRange.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Elements */}
        {elementsInRange.length > 0 && (
          <div className="px-4 py-2 border-b border-neutral-800/40 max-h-24 overflow-y-auto">
            {elementsInRange.map((el) => (
              <div key={el.id} className="flex items-center justify-between py-0.5">
                <span className="text-[10px] font-mono text-studio-accent/80">#{el.id}</span>
                <span className="text-[10px] text-neutral-600">{el.tag}</span>
              </div>
            ))}
          </div>
        )}

        {/* Prompt */}
        <div className="p-3">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCopy();
              }
            }}
            placeholder="What should change?"
            rows={2}
            className="w-full px-3 py-2 text-xs bg-neutral-800/60 border border-neutral-700/40 rounded-lg text-neutral-200 placeholder:text-neutral-600 resize-none focus:outline-none focus:border-studio-accent/40 transition-colors"
          />
        </div>

        {/* Action */}
        <div className="grid grid-cols-2 gap-2 px-3 pb-2">
          <button
            onClick={handleCopyPrompt}
            disabled={!buildPromptCopyText(prompt)}
            className={`py-1.5 text-[11px] font-medium rounded-lg transition-all border ${
              copiedPromptOnly
                ? "bg-green-500/20 text-green-400 border-green-500/30"
                : "bg-neutral-800/70 text-neutral-200 border-neutral-700/50 hover:bg-neutral-800"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {copiedPromptOnly ? "Prompt Copied!" : "Copy Prompt"}
          </button>
          <button
            onClick={handleCopy}
            className={`py-1.5 text-[11px] font-medium rounded-lg transition-all ${
              copiedAgentPrompt
                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                : "bg-studio-accent/15 text-studio-accent border border-studio-accent/25 hover:bg-studio-accent/25"
            }`}
          >
            {copiedAgentPrompt ? "Copied!" : "Copy to Agent"}
            {!copiedAgentPrompt && (
              <span className="text-[9px] text-studio-accent/50 ml-1.5">Cmd+Enter</span>
            )}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 px-3 pb-3">
          <button
            onClick={handlePreviewPatch}
            disabled={
              !prompt.trim() ||
              agentStatus === "previewing" ||
              agentStatus === "applying" ||
              agentStatus === "reverting"
            }
            className="py-1.5 text-[11px] font-medium rounded-lg transition-all border bg-neutral-800/70 text-neutral-200 border-neutral-700/50 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {agentStatus === "previewing" ? "Previewing…" : "Preview Patch"}
          </button>
          <button
            onClick={handleApplyPatch}
            disabled={
              !previewMatchesPrompt ||
              agentStatus === "applying" ||
              agentStatus === "previewing" ||
              agentStatus === "reverting"
            }
            className="py-1.5 text-[11px] font-medium rounded-lg transition-all border bg-studio-accent/15 text-studio-accent border-studio-accent/25 hover:bg-studio-accent/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {agentStatus === "applying"
              ? "Applying…"
              : agentStatus === "reverting"
                ? "Reverting…"
                : agentStatus === "applied"
                  ? "Applied"
                  : agentResponse && !previewMatchesPrompt
                    ? "Preview Again"
                    : "Apply Patch"}
          </button>
        </div>
        {lastAppliedSnapshot && (
          <div className="px-3 pb-3">
            <button
              onClick={handleRevertPatch}
              disabled={
                agentStatus === "applying" ||
                agentStatus === "previewing" ||
                agentStatus === "reverting"
              }
              className="w-full py-1.5 text-[11px] font-medium rounded-lg transition-all border bg-red-500/10 text-red-300 border-red-500/20 hover:bg-red-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {agentStatus === "reverting" ? "Reverting…" : "Revert last edit"}
            </button>
          </div>
        )}
        {(agentResponse || agentError) && (
          <div className="mx-3 mb-3 rounded-lg border border-neutral-800 bg-neutral-950/80 p-2 max-h-36 overflow-auto">
            <div className="text-[10px] font-medium text-neutral-400 mb-1">
              {agentStatus === "applied"
                ? "Applied"
                : agentResponse
                  ? "Patch preview ready"
                  : "Validation failed"}
            </div>
            {agentError && (
              <pre className="text-[10px] text-red-400 whitespace-pre-wrap">{agentError}</pre>
            )}
            {agentResponse && (
              <>
                <p className="text-[10px] text-neutral-500 mb-1">{agentResponse.summary}</p>
                <pre className="text-[10px] text-neutral-400 whitespace-pre-wrap font-mono">
                  {agentResponse.diff || `${agentResponse.operations.length} operation(s)`}
                </pre>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
