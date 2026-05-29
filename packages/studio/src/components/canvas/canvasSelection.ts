export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function normalizeRegionDrag(
  start: CanvasPoint,
  end: CanvasPoint,
  bounds: CanvasRect,
): CanvasRect {
  const startX = clamp(start.x, bounds.x, bounds.x + bounds.width);
  const startY = clamp(start.y, bounds.y, bounds.y + bounds.height);
  const endX = clamp(end.x, bounds.x, bounds.x + bounds.width);
  const endY = clamp(end.y, bounds.y, bounds.y + bounds.height);
  return {
    x: round(Math.min(startX, endX) - bounds.x),
    y: round(Math.min(startY, endY) - bounds.y),
    width: round(Math.abs(endX - startX)),
    height: round(Math.abs(endY - startY)),
  };
}

export function intersectsBoundingBox(region: CanvasRect, box: CanvasRect): boolean {
  return (
    region.x < box.x + box.width &&
    region.x + region.width > box.x &&
    region.y < box.y + box.height &&
    region.y + region.height > box.y
  );
}

export function toCompositionCoordinates(
  region: CanvasRect,
  previewRect: CanvasRect,
  compositionSize: { width: number; height: number },
): CanvasRect {
  const scaleX = compositionSize.width / Math.max(1, previewRect.width);
  const scaleY = compositionSize.height / Math.max(1, previewRect.height);
  return {
    x: round((region.x - previewRect.x) * scaleX),
    y: round((region.y - previewRect.y) * scaleY),
    width: round(region.width * scaleX),
    height: round(region.height * scaleY),
  };
}
