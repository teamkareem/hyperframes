import { useCallback, useState } from "react";
import { useStudioSelectionStore } from "../../player/store/selectionStore";
import { normalizeRegionDrag, type CanvasPoint, type CanvasRect } from "./canvasSelection";

interface CanvasSelectionOverlayProps {
  enabled?: boolean;
  compositionSize?: { width: number; height: number };
}

function toLocalPoint(event: React.PointerEvent<HTMLDivElement>, bounds: DOMRect): CanvasPoint {
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function toCompositionBox(
  region: CanvasRect,
  bounds: Pick<DOMRect, "width" | "height">,
  compositionSize: { width: number; height: number },
): CanvasRect {
  return {
    x: Math.round((region.x / Math.max(1, bounds.width)) * compositionSize.width),
    y: Math.round((region.y / Math.max(1, bounds.height)) * compositionSize.height),
    width: Math.round((region.width / Math.max(1, bounds.width)) * compositionSize.width),
    height: Math.round((region.height / Math.max(1, bounds.height)) * compositionSize.height),
  };
}

export function CanvasSelectionOverlay({
  enabled = false,
  compositionSize = { width: 1920, height: 1080 },
}: CanvasSelectionOverlayProps) {
  const [regionMode, setRegionMode] = useState(enabled);
  const [dragStart, setDragStart] = useState<CanvasPoint | null>(null);
  const [activeRegion, setActiveRegion] = useState<CanvasRect | null>(null);
  const canvasSelections = useStudioSelectionStore((state) => state.canvasSelections);
  const addCanvasSelection = useStudioSelectionStore((state) => state.addCanvasSelection);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!regionMode) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = toLocalPoint(event, bounds);
      setDragStart(point);
      setActiveRegion({ x: point.x, y: point.y, width: 0, height: 0 });
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [regionMode],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!regionMode || !dragStart) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      setActiveRegion(
        normalizeRegionDrag(dragStart, toLocalPoint(event, bounds), {
          x: 0,
          y: 0,
          width: bounds.width,
          height: bounds.height,
        }),
      );
    },
    [dragStart, regionMode],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!regionMode || !dragStart || !activeRegion) return;
      if (activeRegion.width >= 2 && activeRegion.height >= 2) {
        const bounds = event.currentTarget.getBoundingClientRect();
        addCanvasSelection({
          kind: "region",
          boundingBox: activeRegion,
          compositionBox: toCompositionBox(activeRegion, bounds, compositionSize),
        });
      }
      setDragStart(null);
      setActiveRegion(null);
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [activeRegion, addCanvasSelection, compositionSize, dragStart, regionMode],
  );

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      <button
        type="button"
        className={`absolute top-3 left-3 z-40 pointer-events-auto rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
          regionMode
            ? "border-studio-accent/50 bg-studio-accent/20 text-studio-accent"
            : "border-neutral-700/70 bg-neutral-900/80 text-neutral-300 hover:bg-neutral-800"
        }`}
        onClick={() => setRegionMode((value) => !value)}
      >
        {regionMode ? "Region select on" : "Region select"}
      </button>
      <div
        className="absolute inset-0"
        style={{
          pointerEvents: regionMode ? "auto" : "none",
          cursor: regionMode ? "crosshair" : "default",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {[
          ...canvasSelections,
          ...(activeRegion ? [{ kind: "region" as const, boundingBox: activeRegion }] : []),
        ].map((selection, index) => (
          <div
            key={`${selection.kind}-${index}`}
            className="absolute rounded-sm border border-studio-accent bg-studio-accent/10 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{
              left: selection.boundingBox.x,
              top: selection.boundingBox.y,
              width: selection.boundingBox.width,
              height: selection.boundingBox.height,
            }}
          />
        ))}
      </div>
    </div>
  );
}
