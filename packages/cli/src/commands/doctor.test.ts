import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildDoctorReport,
  checkNode,
  isSupportedNodeVersion,
  redactHome,
  SUPPORTED_NODE_RANGE,
  type CheckOutcome,
} from "./doctor.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const OUTCOMES_ALL_OK: CheckOutcome[] = [
  { name: "Version", ok: true, detail: "0.4.4 (latest)" },
  { name: "Node.js", ok: true, detail: "v22.23.4 (darwin arm64)" },
  { name: "FFmpeg", ok: true, detail: "ffmpeg version 8.1" },
];

const OUTCOMES_WITH_FAILURE: CheckOutcome[] = [
  { name: "Version", ok: true, detail: "0.4.4 (latest)" },
  {
    name: "Docker",
    ok: false,
    detail: "Not found",
    hint: "https://docs.docker.com/get-docker/",
  },
];

describe("redactHome", () => {
  const originalHome = process.env["HOME"];
  const originalUserProfile = process.env["USERPROFILE"];

  afterEach(() => {
    if (originalHome !== undefined) process.env["HOME"] = originalHome;
    else delete process.env["HOME"];
    if (originalUserProfile !== undefined) process.env["USERPROFILE"] = originalUserProfile;
    else delete process.env["USERPROFILE"];
  });

  it("replaces HOME paths with the literal $HOME", () => {
    process.env["HOME"] = "/Users/alice";
    delete process.env["USERPROFILE"];
    expect(redactHome("system: /Users/alice/Library/Caches/chrome")).toBe(
      "system: $HOME/Library/Caches/chrome",
    );
  });

  it("replaces all occurrences, not just the first", () => {
    process.env["HOME"] = "/home/bob";
    delete process.env["USERPROFILE"];
    expect(redactHome("/home/bob/a and /home/bob/b")).toBe("$HOME/a and $HOME/b");
  });

  it("falls back to USERPROFILE when HOME is unset (Windows)", () => {
    delete process.env["HOME"];
    process.env["USERPROFILE"] = "C:\\Users\\carol";
    expect(redactHome("C:\\Users\\carol\\AppData")).toBe("$HOME\\AppData");
  });

  it("is a no-op when neither HOME nor USERPROFILE is set", () => {
    delete process.env["HOME"];
    delete process.env["USERPROFILE"];
    expect(redactHome("/Users/someone/path")).toBe("/Users/someone/path");
  });

  it("leaves strings without HOME unchanged", () => {
    process.env["HOME"] = "/Users/alice";
    expect(redactHome("brew install ffmpeg")).toBe("brew install ffmpeg");
  });
});

describe("buildDoctorReport", () => {
  it("emits the locked schema shape", () => {
    const report = buildDoctorReport(OUTCOMES_ALL_OK);

    expect(report).toMatchObject({
      ok: expect.any(Boolean),
      platform: expect.any(String),
      arch: expect.any(String),
      checks: expect.any(Array),
      _meta: expect.objectContaining({
        version: expect.any(String),
        updateAvailable: expect.any(Boolean),
      }),
    });

    // Top-level keys are exactly these — any accidental addition or rename
    // should force an explicit update to this test + PR review.
    expect(Object.keys(report).sort()).toEqual(["_meta", "arch", "checks", "ok", "platform"]);
  });

  it("reports ok=true when all checks pass", () => {
    expect(buildDoctorReport(OUTCOMES_ALL_OK).ok).toBe(true);
  });

  it("reports ok=false when any check fails", () => {
    expect(buildDoctorReport(OUTCOMES_WITH_FAILURE).ok).toBe(false);
  });

  it("preserves check order exactly as provided", () => {
    const report = buildDoctorReport(OUTCOMES_ALL_OK);
    expect(report.checks.map((c) => c.name)).toEqual(["Version", "Node.js", "FFmpeg"]);
  });

  it("omits hint when not provided (doesn't emit hint:undefined)", () => {
    const report = buildDoctorReport([{ name: "X", ok: true, detail: "fine" }]);
    expect(report.checks[0]).toEqual({ name: "X", ok: true, detail: "fine" });
    expect("hint" in report.checks[0]!).toBe(false);
  });

  it("preserves hint when provided", () => {
    const report = buildDoctorReport(OUTCOMES_WITH_FAILURE);
    const docker = report.checks.find((c) => c.name === "Docker");
    expect(docker?.hint).toBe("https://docs.docker.com/get-docker/");
  });

  describe("redact option", () => {
    const originalHome = process.env["HOME"];
    beforeEach(() => {
      process.env["HOME"] = "/Users/alice";
    });
    afterEach(() => {
      if (originalHome !== undefined) process.env["HOME"] = originalHome;
      else delete process.env["HOME"];
    });

    it("redacts HOME in detail and hint when redact=true", () => {
      const outcomes: CheckOutcome[] = [
        {
          name: "Chrome",
          ok: false,
          detail: "system: /Users/alice/Applications/Chrome",
          hint: "Try /Users/alice/bin/chrome",
        },
      ];
      const report = buildDoctorReport(outcomes, { redact: true });
      expect(report.checks[0]?.detail).toBe("system: $HOME/Applications/Chrome");
      expect(report.checks[0]?.hint).toBe("Try $HOME/bin/chrome");
    });

    it("leaves HOME alone when redact is off (default)", () => {
      const outcomes: CheckOutcome[] = [
        { name: "Chrome", ok: true, detail: "/Users/alice/Chrome" },
      ];
      expect(buildDoctorReport(outcomes).checks[0]?.detail).toBe("/Users/alice/Chrome");
    });
  });
});

describe("Node.js version check", () => {
  it.each([
    ["v22.23.4", true],
    ["v22.24.0", true],
    ["v24.22.1", true],
    ["v24.23.0", true],
    ["v26.12.1", true],
    ["v26.13.0", true],
    ["v27.0.0", true],
    ["v22.23.3", false],
    ["v22.0.0", false],
    ["v23.11.0", false],
    ["v24.22.0", false],
    ["v25.9.0", false],
    ["v26.12.0", false],
    ["v20.19.0", false],
    ["not-a-version", false],
  ])("isSupportedNodeVersion(%s) === %s", (version, expected) => {
    expect(isSupportedNodeVersion(version)).toBe(expected);
  });

  it("fails with a hint naming the CVE and the supported range on unpatched Node", () => {
    const result = checkNode("v22.17.0");
    expect(result.ok).toBe(false);
    expect(result.hint).toContain("CVE-2026-111497");
    expect(result.hint).toContain(SUPPORTED_NODE_RANGE);
  });

  it("passes on a patched Node", () => {
    expect(checkNode("v24.22.1")).toMatchObject({ ok: true });
  });

  it("matches engines.node in every published package that declares it", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const pkg of ["cli", "engine", "producer", "aws-lambda"]) {
      const json = JSON.parse(
        readFileSync(resolve(__dirname, "../../..", pkg, "package.json"), "utf-8"),
      ) as { engines?: { node?: string } };
      expect(json.engines?.node, pkg).toBe(SUPPORTED_NODE_RANGE);
    }
  });
});
