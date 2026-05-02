import { describe, expect, it } from "vitest";
import { TYPOGRAPHY_COMPUTED_STYLE_PROPS } from "./useElementPicker";

describe("useElementPicker typography capture", () => {
  it("captures rich computed typography needed for prompt context and manual controls", () => {
    expect(TYPOGRAPHY_COMPUTED_STYLE_PROPS).toEqual(
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
        "font-variant",
        "font-stretch",
        "text-decoration-line",
        "white-space",
        "direction",
      ]),
    );
  });
});
