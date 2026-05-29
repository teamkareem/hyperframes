import { create } from "zustand";

export interface StudioBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StudioElementSelection {
  kind: "element";
  selector: string;
  elementId: string | null;
  boundingBox: StudioBoundingBox;
  computedStyles?: Record<string, string>;
}

export interface StudioRegionSelection {
  kind: "region";
  boundingBox: StudioBoundingBox;
  compositionBox?: StudioBoundingBox;
}

export type StudioCanvasSelection = StudioElementSelection | StudioRegionSelection;

export interface StudioTimelineRange {
  start: number;
  end: number;
}

interface StudioSelectionState {
  canvasSelection: StudioCanvasSelection | null;
  canvasSelections: StudioCanvasSelection[];
  timelineRange: StudioTimelineRange | null;
  setCanvasSelection: (selection: StudioCanvasSelection | null) => void;
  addCanvasSelection: (selection: StudioCanvasSelection) => void;
  clearCanvasSelections: () => void;
  setTimelineRange: (range: StudioTimelineRange | null) => void;
  reset: () => void;
}

function normalizeTimelineRange(range: StudioTimelineRange): StudioTimelineRange {
  const start = Number.isFinite(range.start) ? range.start : 0;
  const end = Number.isFinite(range.end) ? range.end : start;
  return start <= end ? { start, end } : { start: end, end: start };
}

export const useStudioSelectionStore = create<StudioSelectionState>((set) => ({
  canvasSelection: null,
  canvasSelections: [],
  timelineRange: null,
  setCanvasSelection: (selection) =>
    set({ canvasSelection: selection, canvasSelections: selection ? [selection] : [] }),
  addCanvasSelection: (selection) =>
    set((state) => ({
      canvasSelection: selection,
      canvasSelections: [...state.canvasSelections, selection],
    })),
  clearCanvasSelections: () => set({ canvasSelection: null, canvasSelections: [] }),
  setTimelineRange: (range) => set({ timelineRange: range ? normalizeTimelineRange(range) : null }),
  reset: () => set({ canvasSelection: null, canvasSelections: [], timelineRange: null }),
}));
