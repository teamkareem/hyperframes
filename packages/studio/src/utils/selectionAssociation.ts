import type { PickedElement } from "../hooks/useElementPicker";
import type { TimelineElement } from "../player/store/playerStore";

export function getTimelineElementIdentity(element: TimelineElement): string {
  return element.key ?? element.domId ?? element.id;
}

export function getTimelineClipDomKey(identity: string): string {
  return identity.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "clip";
}

export function buildTimelineElementDomSelector(element: TimelineElement): string | null {
  if (element.domId) return `#${cssEscape(element.domId)}`;
  if (element.selector) return element.selector;
  if (element.compositionSrc) return `[data-composition-src="${attrEscape(element.compositionSrc)}"]`;
  if (element.id && !element.id.includes(":")) return `#${cssEscape(element.id)}`;
  return null;
}

export function findTimelineElementForPickedElement(
  picked: PickedElement,
  elements: TimelineElement[],
): TimelineElement | null {
  const pickedId = picked.id ?? undefined;
  const pickedSelector = normalizeSelector(picked.selector);
  const pickedCompositionSrc = picked.dataAttributes["data-composition-src"] ?? undefined;
  const pickedCompositionId = picked.dataAttributes["data-composition-id"] ?? undefined;

  if (pickedId) {
    const byId = elements.find(
      (element) => element.domId === pickedId || element.id === pickedId || element.key === pickedId,
    );
    if (byId) return byId;

    const byKeySuffix = elements.find((element) => {
      const key = element.key ?? "";
      return key.endsWith(`#${pickedId}`) || key.endsWith(`:${pickedId}`);
    });
    if (byKeySuffix) return byKeySuffix;
  }

  if (pickedCompositionSrc) {
    const byCompositionSrc = elements.find(
      (element) =>
        element.compositionSrc === pickedCompositionSrc || element.src === pickedCompositionSrc,
    );
    if (byCompositionSrc) return byCompositionSrc;
  }

  if (pickedCompositionId) {
    const byCompositionId = elements.find(
      (element) => element.id === pickedCompositionId || element.domId === pickedCompositionId,
    );
    if (byCompositionId) return byCompositionId;
  }

  if (pickedSelector) {
    const bySelector = elements.find(
      (element) => normalizeSelector(element.selector) === pickedSelector,
    );
    if (bySelector) return bySelector;

    const byKeySelector = elements.find((element) => {
      const key = element.key ?? "";
      return key.includes(`:${picked.selector}:`) || key.endsWith(`:${picked.selector}`);
    });
    if (byKeySelector) return byKeySelector;
  }

  return null;
}

function normalizeSelector(selector: string | undefined): string | null {
  const trimmed = selector?.trim();
  return trimmed ? trimmed : null;
}

function attrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
}
