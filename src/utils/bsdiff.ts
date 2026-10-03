/**
 * Writes the BSDIFF40 patch that turns one file into another, the format the SDKs' bspatch applies.
 * The algorithm is `@bsdiff-rust/node`'s, a prebuilt binding loaded on first use: a platform it has no build for
 * fails here, and the upload goes on without patches.
 */
export async function writeBsdiffPatch(
  fromFilePath: string,
  toFilePath: string,
  patchFilePath: string,
): Promise<void> {
  const { diff } = await import('@bsdiff-rust/node');
  await diff(fromFilePath, toFilePath, patchFilePath);
}
