import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enforceSupportedRuntime,
  isSupportedBunVersion,
  SUPPORTED_NODE_RANGE,
  unsupportedRuntimeMessage,
} from "./nodeVersion.js";

describe("unsupportedRuntimeMessage", () => {
  it("returns undefined on a patched Node", () => {
    expect(unsupportedRuntimeMessage({ node: "v22.23.4" })).toBeUndefined();
  });

  it("names the CVE and the supported range on an unpatched Node", () => {
    const message = unsupportedRuntimeMessage({ node: "v22.17.0" });
    expect(message).toContain("CVE-2026-111497");
    expect(message).toContain(SUPPORTED_NODE_RANGE);
    expect(message).toContain("v22.17.0");
  });

  it("judges Bun by its own release, not its emulated process.version", () => {
    expect(unsupportedRuntimeMessage({ node: "v22.0.0", bun: "1.4.4" })).toBeUndefined();
    expect(unsupportedRuntimeMessage({ node: "v24.22.1", bun: "1.4.3" })).toContain(
      "CVE-2026-111497",
    );
  });

  it.each([
    ["1.4.4", true],
    ["1.5.0", true],
    ["2.0.0", true],
    ["1.4.3", false],
    ["1.3.9", false],
  ])("isSupportedBunVersion(%s) === %s", (version, expected) => {
    expect(isSupportedBunVersion(version)).toBe(expected);
  });
});

describe("enforceSupportedRuntime", () => {
  const oldNode = { node: "v22.17.0" };

  it("returns exit code 1 and prints the CVE message on an unsupported runtime", () => {
    const printError = vi.fn();
    expect(enforceSupportedRuntime("render", { runtime: oldNode, printError })).toBe(1);
    expect(printError).toHaveBeenCalledTimes(1);
    expect(printError.mock.calls[0]?.[0]).toContain("CVE-2026-111497");
    expect(printError.mock.calls[0]?.[0]).toContain("hyperframes doctor");
  });

  it("blocks bare invocations and --help too", () => {
    const printError = vi.fn();
    expect(enforceSupportedRuntime(undefined, { runtime: oldNode, printError })).toBe(1);
    expect(enforceSupportedRuntime("--help", { runtime: oldNode, printError })).toBe(1);
  });

  it("keeps doctor runnable on an unsupported runtime", () => {
    const printError = vi.fn();
    expect(enforceSupportedRuntime("doctor", { runtime: oldNode, printError })).toBeUndefined();
    expect(printError).not.toHaveBeenCalled();
  });

  it("does nothing on a supported runtime", () => {
    const printError = vi.fn();
    expect(
      enforceSupportedRuntime("render", { runtime: { node: "v26.12.1" }, printError }),
    ).toBeUndefined();
    expect(printError).not.toHaveBeenCalled();
  });
});

describe("cli.ts startup gate", () => {
  const originalVersion = process.version;
  const originalArgv = process.argv;

  afterEach(() => {
    Object.defineProperty(process, "version", { value: originalVersion, configurable: true });
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("exits non-zero with the CVE message before running a command on unpatched Node", async () => {
    Object.defineProperty(process, "version", { value: "v22.17.0", configurable: true });
    process.argv = ["node", "hyperframes", "render"];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
      throw new Error(`process.exit:${code ?? ""}`);
    });

    await expect(import("../cli.js")).rejects.toThrow("process.exit:1");
    expect(error.mock.calls[0]?.[0]).toContain("CVE-2026-111497");
  });
});
