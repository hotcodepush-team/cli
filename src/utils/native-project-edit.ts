import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NativeProjectError } from './errors.js';

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

const GRADLE_EDIT_DESCRIPTION = 'the Gradle task that runs the build step';

const GRADLE_FILE_MARKER = 'hotcodepush.gradle';

const GRADLE_FILE_NAMES = ['build.gradle', 'build.gradle.kts'];

/**
 * The app's Gradle file applies the Gradle file the SDK package ships, which holds the task that runs the build step: one line,
 * resolved through Node so it finds the package wherever `node_modules` lies, in the syntax of the file it joins.
 * An Android project without the app's Gradle file gets the manual step; without an Android project there is no edit.
 */
export function resolveGradleEdit(
  androidProjectPath: string,
  packageName: string,
): NativeProjectEdit | undefined {
  if (!existsSync(androidProjectPath)) {
    return undefined;
  }
  const filePath = GRADLE_FILE_NAMES.map(fileName =>
    join(androidProjectPath, 'app', fileName),
  ).find(candidatePath => existsSync(candidatePath));
  if (filePath === undefined) {
    return resolveRefusedEdit(
      GRADLE_EDIT_DESCRIPTION,
      join(androidProjectPath, 'app', 'build.gradle'),
      new NativeProjectError(
        `The Android project ${androidProjectPath} has no build.gradle or build.gradle.kts in its app folder.`,
        `Apply node_modules/${packageName}/android/${GRADLE_FILE_MARKER} from the app module's Gradle file.`,
      ),
    );
  }
  const resolvePackageScript = `require.resolve('${packageName}/package.json')`;
  return {
    description: GRADLE_EDIT_DESCRIPTION,
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

/**
 * The edit of a file `init` cannot edit, missing or not the one the framework's template has: applying it stops with
 * the manual step, and it counts as applied once the file holds the marker that step writes, so `doctor` passes a file
 * wired by hand and `init` leaves it alone. A missing file has no marker and is never applied.
 */
export function resolveRefusedEdit(
  description: string,
  filePath: string,
  error: NativeProjectError,
  marker?: string,
): NativeProjectEdit {
  return {
    description,
    filePath,
    isApplied: () =>
      marker !== undefined && readFileSync(filePath, 'utf8').includes(marker),
    apply: () => {
      throw error;
    },
  };
}
