function splitLines(value: string): string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function buildUnifiedDiffPreview(
  before: Record<string, string>,
  after: Record<string, string>,
): string {
  const paths = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  const chunks: string[] = [];
  for (const path of paths) {
    const oldText = before[path] ?? "";
    const newText = after[path] ?? "";
    if (oldText === newText) continue;
    chunks.push(`--- a/${path}`, `+++ b/${path}`);
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);
    chunks.push(`@@ -1,${oldLines.length} +1,${newLines.length} @@`);
    for (const line of oldLines) chunks.push(`-${line}`);
    for (const line of newLines) chunks.push(`+${line}`);
  }
  return chunks.join("\n");
}
