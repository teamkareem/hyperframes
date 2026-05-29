interface SaveChangedProjectFilesInput {
  projectId: string;
  beforeFiles: Record<string, string>;
  afterFiles: Record<string, string>;
  expectedCurrentFiles?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

async function readProjectFile(
  fetchImpl: typeof fetch,
  projectId: string,
  path: string,
): Promise<string> {
  const response = await fetchImpl(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(path)}`,
  );
  if (!response.ok) throw new Error(`Failed to read ${path}`);
  const data = (await response.json()) as { content?: string };
  if (typeof data.content !== "string") throw new Error(`Missing file contents for ${path}`);
  return data.content;
}

export async function saveChangedProjectFiles({
  projectId,
  beforeFiles,
  afterFiles,
  expectedCurrentFiles,
  fetchImpl = fetch,
}: SaveChangedProjectFilesInput): Promise<Record<string, string>> {
  const changedFiles = Object.fromEntries(
    Object.entries(afterFiles).filter(([path, content]) => beforeFiles[path] !== content),
  );

  if (expectedCurrentFiles) {
    await Promise.all(
      Object.entries(changedFiles).map(async ([path]) => {
        const expected = expectedCurrentFiles[path];
        if (expected == null) return;
        const current = await readProjectFile(fetchImpl, projectId, path);
        if (current !== expected) {
          throw new Error(
            `Refusing to overwrite ${path}: file changed since the patch was applied`,
          );
        }
      }),
    );
  }

  await Promise.all(
    Object.entries(changedFiles).map(async ([path, content]) => {
      const saveResponse = await fetchImpl(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(path)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: content,
        },
      );
      if (!saveResponse.ok) throw new Error(`Failed to save ${path}`);
    }),
  );

  return changedFiles;
}
