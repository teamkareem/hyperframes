import { describe, expect, it } from "vitest";
import {
  intersectsBoundingBox,
  normalizeRegionDrag,
  toCompositionCoordinates,
} from "./canvasSelection";

describe("canvasSelection utilities", () => {
  it("normalizes drag rectangles inside preview bounds", () => {
    expect(
      normalizeRegionDrag(
        { x: 90, y: 80 },
        { x: 10, y: 20 },
        { x: 0, y: 0, width: 100, height: 100 },
      ),
    ).toEqual({ x: 10, y: 20, width: 80, height: 60 });
  });

  it("clamps drag rectangles to preview bounds", () => {
    expect(
      normalizeRegionDrag(
        { x: -20, y: 10 },
        { x: 120, y: 90 },
        { x: 0, y: 0, width: 100, height: 80 },
      ),
    ).toEqual({ x: 0, y: 10, width: 100, height: 70 });
  });

  it("detects bounding-box intersections", () => {
    expect(
      intersectsBoundingBox(
        { x: 10, y: 10, width: 20, height: 20 },
        { x: 25, y: 25, width: 10, height: 10 },
      ),
    ).toBe(true);
    expect(
      intersectsBoundingBox(
        { x: 10, y: 10, width: 20, height: 20 },
        { x: 40, y: 40, width: 10, height: 10 },
      ),
    ).toBe(false);
  });

  it("maps preview pixels into composition coordinates", () => {
    expect(
      toCompositionCoordinates(
        { x: 50, y: 25, width: 100, height: 50 },
        { x: 0, y: 0, width: 200, height: 100 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 480, y: 270, width: 960, height: 540 });
  });
});
