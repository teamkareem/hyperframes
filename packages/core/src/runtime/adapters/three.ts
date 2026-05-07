import type { RuntimeDeterministicAdapter } from "../types";
import { swallow } from "../diagnostics";

export function createThreeAdapter(): RuntimeDeterministicAdapter {
  let forcedTime: number | null = null;
  let lastForcedTime = 0;

  return {
    name: "three",
    discover: () => {},
    seek: (ctx) => {
      forcedTime = Math.max(0, Number(ctx.time) || 0);
      lastForcedTime = forcedTime;
      window.__hfThreeTime = forcedTime;
      try {
        window.dispatchEvent(new CustomEvent("hf-seek", { detail: { time: forcedTime } }));
      } catch (err) {
        // ignore custom event failures
        swallow("runtime.adapters.three.site1", err);
      }
    },
    pause: () => {
      if (forcedTime == null) {
        forcedTime = Math.max(0, lastForcedTime);
      }
    },
    play: () => {
      forcedTime = null;
    },
    revert: () => {
      forcedTime = null;
      lastForcedTime = 0;
    },
  };
}
