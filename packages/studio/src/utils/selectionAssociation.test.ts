import { describe, expect, it } from "vitest";
import type { PickedElement } from "../hooks/useElementPicker";
import type { TimelineElement } from "../player/store/playerStore";
import {
  buildTimelineElementDomSelector,
  findTimelineElementForPickedElement,
  getTimelineClipDomKey,
} from "./selectionAssociation";

const basePicked: PickedElement = {
  id: null,
  tagName: "div",
  selector: "div:nth-of-type(2)",
  label: "Text",
  boundingBox: { x: 0, y: 0, width: 100, height: 40 },
  textContent: "Hello",
  src: null,
  dataAttributes: {},
  computedStyles: {},
};

const baseTimelineElement: TimelineElement = {
  id: "fallback-id",
  key: "compositions/intro.html:div:nth-of-type(2):1",
  tag: "div",
  start: 2,
  duration: 1.5,
  track: 1,
  selector: "div:nth-of-type(2)",
  selectorIndex: 1,
  sourceFile: "compositions/intro.html",
};

describe("selectionAssociation", () => {
  it("prefers picked element id/domId when associating canvas picks with timeline elements", () => {
    const elements: TimelineElement[] = [
      baseTimelineElement,
      { ...baseTimelineElement, id: "headline", key: "index.html#headline", domId: "headline" },
    ];

    expect(
      findTimelineElementForPickedElement({ ...basePicked, id: "headline" }, elements)?.key,
    ).toBe("index.html#headline");
  });

  it("falls back to selector and selector index when picked elements do not have ids", () => {
    const elements: TimelineElement[] = [baseTimelineElement];

    expect(findTimelineElementForPickedElement(basePicked, elements)).toEqual(baseTimelineElement);
  });

  it("uses picked data attributes to match composition hosts", () => {
    const elements: TimelineElement[] = [
      { ...baseTimelineElement, id: "intro-host", key: "index.html#intro-host", compositionSrc: "compositions/intro.html" },
    ];

    expect(
      findTimelineElementForPickedElement(
        {
          ...basePicked,
          selector: '[data-composition-src="compositions/intro.html"]',
          dataAttributes: { "data-composition-src": "compositions/intro.html" },
        },
        elements,
      )?.id,
    ).toBe("intro-host");
  });

  it("builds a safe DOM key for timeline clips and preview selectors", () => {
    expect(getTimelineClipDomKey("index.html#headline")).toBe("index_html_headline");
    expect(buildTimelineElementDomSelector({ ...baseTimelineElement, domId: "headline" })).toBe(
      "#headline",
    );
    expect(buildTimelineElementDomSelector(baseTimelineElement)).toBe("div:nth-of-type(2)");
  });
});
