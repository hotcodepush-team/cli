import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One line of a native project `init` wires: whether it is there, and how it gets there.
 * Every edit is recognised afterwards by the marker it writes, and one the file has no place for is the manual step.
 */
export interface NativeProjectEdit {
  /** What the edit wires, in the words `init` prints. */
  description: string;
  filePath: string;
  isApplied: () => boolean;
  apply: () => void;
}

const GRADLE_FILE_MARKER = 'hotcodepush.gradle';

const GRADLE_FILE_NAMES = ['build.gradle', 'build.gradle.kts'];

/**
 * The app's Gradle file applies the Gradle file the SDK package ships, which holds the task that runs binary create: one line,
 * resolved through Node so it finds the package wherever `node_modules` lies, in the syntax of the file it joins.
 */
export function resolveGradleEdit(
  androidProjectPath: string,
  packageName: string,
): NativeProjectEdit | undefined {
  const filePath = GRADLE_FILE_NAMES.map(fileName =>
    join(androidProjectPath, 'app', fileName),
  ).find(candidatePath => existsSync(candidatePath));
  if (filePath === undefined) {
    return undefined;
  }
  const resolvePackageScript = `require.resolve('${packageName}/package.json')`;
  return {
    description: 'the Gradle task that runs binary create',
    filePath,
    isApplied: () =>
      readFileSync(filePath, 'utf8').includes(GRADLE_FILE_MARKER),
    apply: () => {
      const source = readFileSync(filePath, 'utf8');
      const applyLine = filePath.endsWith('.kts')
        ? `apply(from = File(providers.exec { workingDir(rootDir); commandLine("node", "--print", "${resolvePackageScript}") }.standardOutput.asText.get().trim()).resolveSibling("android/${GRADLE_FILE_MARKER}"))`
        : `apply from: new File(["node", "--print", "${resolvePackageScript}"].execute(null, rootDir).text.trim(), "../android/${GRADLE_FILE_MARKER}")`;
      writeFileSync(
        filePath,
        `${source}${source.endsWith('\n') ? '' : '\n'}\n${applyLine}\n`,
      );
    },
  };
}
