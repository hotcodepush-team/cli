import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

/** The exports of the module `bsdiff-wasm/` builds; `apply` and `diff` return their bytes as `(pointer << 32) | length`. */
interface BsdiffExports {
  alloc(length: number): number;
  apply(
    sourcePointer: number,
    sourceLength: number,
    patchPointer: number,
    patchLength: number,
  ): bigint;
  diff(
    sourcePointer: number,
    sourceLength: number,
    targetPointer: number,
    targetLength: number,
  ): bigint;
  memory: { buffer: ArrayBuffer };
}

/** The part of the WebAssembly API used here, which neither ES2023's lib nor `@types/node` declares. */
declare const WebAssembly: {
  Instance: new (module: object) => { exports: BsdiffExports };
  Module: new (bytes: Uint8Array) => object;
};

/** Our build of the Rust crate `qbsdiff`, at the same relative path from `src/utils/` and `dist/utils/`. */
const bsdiffModule = new WebAssembly.Module(
  readFileSync(new URL('../../bsdiff-wasm/bsdiff.wasm', import.meta.url)),
);

/**
 * Writes the BSDIFF40 patch that turns one file into another, the format the SDKs' bspatch applies.
 */
export async function writeBsdiffPatch(
  fromFilePath: string,
  toFilePath: string,
  patchFilePath: string,
): Promise<void> {
  const [fromBytes, toBytes] = await Promise.all([
    readFile(fromFilePath),
    readFile(toFilePath),
  ]);
  await writeFile(patchFilePath, runBsdiffModule('diff', fromBytes, toBytes));
}

/** The bytes a BSDIFF40 patch turns `fromBytes` into; the CLI only writes patches, and its tests prove them with this. */
export function applyBsdiffPatch(
  fromBytes: Uint8Array,
  patchBytes: Uint8Array,
): Uint8Array {
  return runBsdiffModule('apply', fromBytes, patchBytes);
}

/**
 * A fresh instance per call, so its memory goes with it. It is instantiated without imports, which a module that
 * imported anything would refuse: the module reaches no file and no network.
 */
function runBsdiffModule(
  operation: 'apply' | 'diff',
  firstBytes: Uint8Array,
  secondBytes: Uint8Array,
): Uint8Array {
  const { exports } = new WebAssembly.Instance(bsdiffModule);
  const firstPointer = copyIntoMemory(exports, firstBytes);
  const secondPointer = copyIntoMemory(exports, secondBytes);
  const packedResult = BigInt.asUintN(
    64,
    exports[operation](
      firstPointer,
      firstBytes.length,
      secondPointer,
      secondBytes.length,
    ),
  );
  return new Uint8Array(
    exports.memory.buffer,
    Number(packedResult >> 32n),
    Number(packedResult & 0xffffffffn),
  ).slice();
}

function copyIntoMemory(exports: BsdiffExports, bytes: Uint8Array): number {
  const pointer = exports.alloc(bytes.length) >>> 0;
  new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
  return pointer;
}
