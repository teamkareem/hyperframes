import { describe, expect, it } from "vitest";
import {
  buildStrokeStyleUpdates,
  buildStrokeWidthStyleUpdates,
  getClipPathInsetPx,
  getCssFilterFunctionPx,
  inferBoxShadowPreset,
  inferClipPathPreset,
  normalizePanelPxValue,
  setCssFilterFunctionPx,
  getDesignerControlGroups,
  isTextEditableElement,
  TYPOGRAPHY_STYLE_CONTROLS,
} from "./PropertyPanel";

describe("PropertyPanel style helpers", () => {
  it("normalizes bounded pixel values without accepting incompatible units", () => {
    expect(normalizePanelPxValue("12", { min: 0, max: 40 })).toBe("12px");
    expect(normalizePanelPxValue("12.50px", { min: 0, max: 40 })).toBe("12.5px");
    expect(normalizePanelPxValue("-8", { min: 0, max: 40 })).toBe("0px");
    expect(normalizePanelPxValue("80px", { min: 0, max: 40 })).toBe("40px");
    expect(normalizePanelPxValue("1.2rem", { min: 0, max: 40 })).toBeNull();
    expect(normalizePanelPxValue("auto", { min: 0, max: 40 })).toBeNull();
  });

  it("adds, replaces, and removes a named filter function while preserving other filters", () => {
    expect(setCssFilterFunctionPx("none", "blur", 12)).toBe("blur(12px)");
    expect(setCssFilterFunctionPx("brightness(1.08)", "blur", 4.5)).toBe(
      "brightness(1.08) blur(4.5px)",
    );
    expect(setCssFilterFunctionPx("brightness(1.08) blur(12px) saturate(1.2)", "blur", 2)).toBe(
      "brightness(1.08) saturate(1.2) blur(2px)",
    );
    expect(setCssFilterFunctionPx("brightness(1.08) blur(12px)", "blur", 0)).toBe(
      "brightness(1.08)",
    );
    expect(setCssFilterFunctionPx("blur(12px)", "blur", 0)).toBe("none");
    expect(getCssFilterFunctionPx("brightness(1.08) blur(3.5px)", "blur")).toBe(3.5);
    expect(getCssFilterFunctionPx("drop-shadow(0 2px 8px black)", "blur")).toBe(0);
  });

  it("infers shadow and clip presets without losing custom values", () => {
    expect(inferBoxShadowPreset("none")).toBe("none");
    expect(inferBoxShadowPreset("0 12px 36px rgba(0, 0, 0, 0.28)")).toBe("soft");
    expect(inferBoxShadowPreset("0 2px 4px red")).toBe("custom");

    expect(inferClipPathPreset(undefined)).toBe("none");
    expect(inferClipPathPreset("inset(12px round 8px)")).toBe("inset");
    expect(inferClipPathPreset("circle(50% at 50% 50%)")).toBe("circle");
    expect(inferClipPathPreset("polygon(0 0, 100% 0, 100% 100%)")).toBe("custom");
    expect(getClipPathInsetPx("inset(12.5px round 8px)")).toBe(12.5);
    expect(getClipPathInsetPx("circle(50% at 50% 50%)")).toBe(0);
  });

  it("keeps stroke width and style edits visually effective", () => {
    expect(buildStrokeWidthStyleUpdates("3px", "none")).toEqual([
      ["border-width", "3px"],
      ["border-style", "solid"],
    ]);
    expect(buildStrokeWidthStyleUpdates("0px", "none")).toEqual([["border-width", "0px"]]);
    expect(buildStrokeWidthStyleUpdates("3px", "dashed")).toEqual([["border-width", "3px"]]);

    expect(buildStrokeStyleUpdates("dashed", "0px")).toEqual([
      ["border-style", "dashed"],
      ["border-width", "1px"],
    ]);
    expect(buildStrokeStyleUpdates("none", "4px")).toEqual([["border-style", "none"]]);
    expect(buildStrokeStyleUpdates("solid", "4px")).toEqual([["border-style", "solid"]]);
  });
});

describe("PropertyPanel designer controls", () => {
  it("exposes rich typography controls for promptable text editing", () => {
    expect(TYPOGRAPHY_STYLE_CONTROLS.map((control) => control.property)).toEqual(
      expect.arrayContaining([
        "font-size",
        "font-weight",
        "font-family",
        "line-height",
        "letter-spacing",
        "word-spacing",
        "font-kerning",
        "text-align",
        "font-style",
        "text-transform",
      ]),
    );
  });

  it("treats semantic headings and text nodes as text editable", () => {
    expect(isTextEditableElement({ tagName: "h3", textContent: "Headline" })).toBe(true);
    expect(isTextEditableElement({ tagName: "button", textContent: "CTA" })).toBe(true);
    expect(isTextEditableElement({ tagName: "img", textContent: null })).toBe(false);
  });

  it("groups layout, typography, appearance, and timing controls", () => {
    const groups = getDesignerControlGroups({ hasTiming: true, isText: true });
    expect(groups).toEqual(["Position & Size", "Typography", "Colors", "Appearance", "Timing"]);
  });
});
