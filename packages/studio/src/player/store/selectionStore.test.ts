import { beforeEach, describe, expect, it } from "vitest";
import { useStudioSelectionStore } from "./selectionStore";

describe("useStudioSelectionStore", () => {
  beforeEach(() => {
    useStudioSelectionStore.getState().reset();
  });

  it("starts with no canvas selection or timeline range", () => {
    const state = useStudioSelectionStore.getState();
    expect(state.canvasSelection).toBeNull();
    expect(state.canvasSelections).toEqual([]);
    expect(state.timelineRange).toBeNull();
  });

  it("persists a picked canvas element for the inspector and prompt context", () => {
    useStudioSelectionStore.getState().setCanvasSelection({
      kind: "element",
      selector: "#headline",
      elementId: "headline",
      boundingBox: { x: 12, y: 24, width: 320, height: 88 },
    });

    expect(useStudioSelectionStore.getState().canvasSelection).toEqual({
      kind: "element",
      selector: "#headline",
      elementId: "headline",
      boundingBox: { x: 12, y: 24, width: 320, height: 88 },
    });
  });

  it("keeps multi-canvas selections for unified prompt scope", () => {
    useStudioSelectionStore.getState().addCanvasSelection({
      kind: "region",
      boundingBox: { x: 1, y: 2, width: 3, height: 4 },
    });
    useStudioSelectionStore.getState().addCanvasSelection({
      kind: "region",
      boundingBox: { x: 5, y: 6, width: 7, height: 8 },
    });

    expect(useStudioSelectionStore.getState().canvasSelections).toHaveLength(2);
    expect(useStudioSelectionStore.getState().canvasSelection?.boundingBox).toEqual({
      x: 5,
      y: 6,
      width: 7,
      height: 8,
    });
  });

  it("normalizes timeline range order and clears it", () => {
    useStudioSelectionStore.getState().setTimelineRange({ start: 8, end: 2 });
    expect(useStudioSelectionStore.getState().timelineRange).toEqual({ start: 2, end: 8 });

    useStudioSelectionStore.getState().setTimelineRange(null);
    expect(useStudioSelectionStore.getState().timelineRange).toBeNull();
  });
});
