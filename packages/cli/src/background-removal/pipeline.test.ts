import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { inferOutputFormat, inferInputKind, buildEncoderArgs, waitForExit } from "./pipeline.js";

describe("background-removal/pipeline — inferOutputFormat", () => {
  it("maps .webm → webm", () => {
    expect(inferOutputFormat("/tmp/out.webm")).toBe("webm");
  });
  it("maps .mov → mov", () => {
    expect(inferOutputFormat("/tmp/out.mov")).toBe("mov");
  });
  it("maps .png → png", () => {
    expect(inferOutputFormat("/tmp/out.png")).toBe("png");
  });
  it("rejects unknown extensions", () => {
    expect(() => inferOutputFormat("/tmp/out.mp4")).toThrow(/Unsupported output extension/);
  });
});

describe("background-removal/pipeline — inferInputKind", () => {
  it("recognizes mp4/mov/webm/mkv/avi as video", () => {
    for (const ext of [".mp4", ".mov", ".webm", ".mkv", ".avi"]) {
      expect(inferInputKind(`/tmp/clip${ext}`)).toBe("video");
    }
  });
  it("recognizes jpg/png/webp as image", () => {
    for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
      expect(inferInputKind(`/tmp/img${ext}`)).toBe("image");
    }
  });
  it("rejects unknown extensions", () => {
    expect(() => inferInputKind("/tmp/file.gif")).toThrow(/Unsupported input/);
  });
});

describe("background-removal/pipeline — buildEncoderArgs", () => {
  it("webm preset emits VP9 + alpha_mode metadata", () => {
    const args = buildEncoderArgs("webm", 1920, 1080, 30, "/tmp/out.webm");
    expect(args).toContain("libvpx-vp9");
    expect(args).toContain("yuva420p");
    // The alpha_mode metadata must be present; without it Chrome ignores the alpha plane.
    const idx = args.indexOf("-metadata:s:v:0");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("alpha_mode=1");
    expect(args[args.length - 1]).toBe("/tmp/out.webm");
  });

  it("mov preset emits ProRes 4444 + yuva444p10le", () => {
    const args = buildEncoderArgs("mov", 1920, 1080, 30, "/tmp/out.mov");
    expect(args).toContain("prores_ks");
    expect(args).toContain("4444");
    expect(args).toContain("yuva444p10le");
  });

  it("png preset emits a single RGBA frame", () => {
    const args = buildEncoderArgs("png", 1920, 1080, 30, "/tmp/out.png");
    expect(args).toContain("-frames:v");
    expect(args).toContain("rgba");
  });

  it("threads input dimensions and fps into raw video header", () => {
    const args = buildEncoderArgs("webm", 640, 480, 24, "/tmp/o.webm");
    const sIdx = args.indexOf("-s");
    expect(args[sIdx + 1]).toBe("640x480");
    const rIdx = args.indexOf("-r");
    expect(args[rIdx + 1]).toBe("24");
  });
});

// Regression: a previous version of waitForExit treated `code === null` as
// success. Per Node's child_process docs, that's the signal-killed case —
// reporting it as success means a SIGTERM/SIGKILL'd ffmpeg encoder produces
// a "successful" render with a missing or truncated output file.
describe("background-removal/pipeline — waitForExit signal handling", () => {
  function fakeProc(): ReturnType<typeof spawn> {
    return new EventEmitter() as unknown as ReturnType<typeof spawn>;
  }

  it("resolves on a clean exit (code=0, signal=null)", async () => {
    const proc = fakeProc();
    const promise = waitForExit(proc, "ffmpeg encoder", () => "");
    proc.emit("exit", 0, null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects when killed by signal (code=null, signal='SIGTERM')", async () => {
    const proc = fakeProc();
    const promise = waitForExit(proc, "ffmpeg encoder", () => "tail of stderr");
    proc.emit("exit", null, "SIGTERM");
    await expect(promise).rejects.toThrow(/killed by SIGTERM/);
    await expect(promise).rejects.toThrow(/tail of stderr/);
  });

  it("rejects on non-zero exit code", async () => {
    const proc = fakeProc();
    const promise = waitForExit(proc, "ffmpeg encoder", () => "");
    proc.emit("exit", 1, null);
    await expect(promise).rejects.toThrow(/exited with code 1/);
  });

  it("rejects on SIGKILL", async () => {
    const proc = fakeProc();
    const promise = waitForExit(proc, "ffmpeg encoder", () => "");
    proc.emit("exit", null, "SIGKILL");
    await expect(promise).rejects.toThrow(/killed by SIGKILL/);
  });
});
