import { describe, expect, it } from "vitest";
import { MEAN, STD } from "./inference.js";

// Regression: the u2net_human_seg model was trained with ImageNet
// normalization. Drifting away from these exact values changes the input
// tensor at every pixel and shifts the predicted alpha mask noticeably
// (Miguel reproduced 8,317 pixel changes with delta up to 78/255 when std
// was set to (1, 1, 1)). Reference:
// https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net_human_seg.py#L33
describe("background-removal/inference — rembg u2net_human_seg parity", () => {
  it("MEAN matches U2netHumanSegSession reference", () => {
    expect(MEAN).toEqual([0.485, 0.456, 0.406]);
  });

  it("STD matches U2netHumanSegSession reference (ImageNet, not the base u2net's (1,1,1))", () => {
    expect(STD).toEqual([0.229, 0.224, 0.225]);
  });
});
