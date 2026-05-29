import type { StudioCanvasSelection, StudioTimelineRange } from "../player/store/selectionStore";

export type AgentEditMode = "preview" | "apply";

export interface AgentEditElementContext {
  id: string;
  tag: string;
  start?: number;
  duration?: number;
  track?: number;
  selector?: string;
  sourceFile?: string;
}

export interface AgentEditSelectionContext {
  timelineRange?: StudioTimelineRange | null;
  canvasSelections?: StudioCanvasSelection[];
  screenshotCrop?: AgentEditScreenshotCrop | null;
}

export interface AgentEditScreenshotCrop {
  dataUrl?: string;
  mimeType?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export type AgentEditOperationKind = "inline-style" | "attribute" | "text-content" | "replace-file";

export interface AgentEditOperation {
  kind: AgentEditOperationKind;
  filePath: string;
  target?: {
    id?: string | null;
    selector?: string;
    selectorIndex?: number;
  };
  property?: string;
  value: string;
}

export interface AgentEditValidationResult {
  ok: boolean;
  messages: string[];
}

export interface AgentEditRequest {
  projectId: string;
  prompt: string;
  mode: AgentEditMode;
  selection?: AgentEditSelectionContext;
  elements?: AgentEditElementContext[];
  files?: Record<string, string>;
  computedStyles?: Record<string, Record<string, string>>;
}

export interface AgentEditResponse {
  ok: boolean;
  mode: AgentEditMode;
  summary: string;
  operations: AgentEditOperation[];
  diff?: string;
  files?: Record<string, string>;
  validation: AgentEditValidationResult;
}
