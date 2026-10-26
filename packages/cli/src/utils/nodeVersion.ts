// Must match `engines.node` in the published package.json files. These are the
// first releases with the Brotli decoder fix for CVE-2026-111497.
export const SUPPORTED_NODE_RANGE = "^22.23.4 || ^24.22.1 || >=26.12.1";
export const MIN_BUN_VERSION = "1.4.4";

type Triple = readonly [number, number, number];

const PATCHED_NODE_LINES: ReadonlyArray<Triple> = [
  [22, 23, 4],
  [24, 22, 1],
  [26, 12, 1],
];

function parseTriple(version: string): Triple | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(have: Triple, min: Triple): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== min[i]) return (have[i] ?? 0) > (min[i] ?? 0);
  }
  return true;
}

export function isSupportedNodeVersion(version: string): boolean {
  const v = parseTriple(version);
  if (!v) return false;
  if (v[0] > 26) return true;
  const line = PATCHED_NODE_LINES.find(([major]) => major === v[0]);
  return line ? atLeast(v, line) : false;
}

export function isSupportedBunVersion(version: string): boolean {
  const v = parseTriple(version);
  const min = parseTriple(MIN_BUN_VERSION);
  return !!v && !!min && atLeast(v, min);
}

export interface RuntimeVersions {
  node: string;
  bun?: string;
}

function currentRuntime(): RuntimeVersions {
  return { node: process.version, bun: process.versions.bun };
}

/**
 * Returns an error message when the running runtime lacks the CVE-2026-111497
 * fix, or `undefined` when it is supported. Bun reports an emulated
 * `process.version`, so it is judged by its own release instead.
 */
export function unsupportedRuntimeMessage(
  runtime: RuntimeVersions = currentRuntime(),
): string | undefined {
  if (runtime.bun !== undefined) {
    if (isSupportedBunVersion(runtime.bun)) return undefined;
    return `Bun >=${MIN_BUN_VERSION} required (running ${runtime.bun}) — older releases are vulnerable to CVE-2026-111497 (Brotli decoder RCE). Upgrade: https://bun.sh`;
  }
  if (isSupportedNodeVersion(runtime.node)) return undefined;
  return `Node ${SUPPORTED_NODE_RANGE} required (running ${runtime.node}) — older releases are vulnerable to CVE-2026-111497 (Brotli decoder RCE). Upgrade: https://nodejs.org/en/download`;
}

/** Commands that still run on an unsupported runtime so users can diagnose it. */
const DIAGNOSTIC_COMMANDS: ReadonlySet<string> = new Set(["doctor"]);

/**
 * Startup gate for the CLI: returns the exit code to use (1) when the runtime
 * is unsupported and the command isn't diagnostic, otherwise `undefined`.
 */
export function enforceSupportedRuntime(
  command: string | undefined,
  options: { runtime?: RuntimeVersions; printError?: (message: string) => void } = {},
): number | undefined {
  if (command !== undefined && DIAGNOSTIC_COMMANDS.has(command)) return undefined;
  const message = unsupportedRuntimeMessage(options.runtime);
  if (!message) return undefined;
  (options.printError ?? console.error)(
    `hyperframes: ${message}\nRun \`hyperframes doctor\` for details.`,
  );
  return 1;
}
