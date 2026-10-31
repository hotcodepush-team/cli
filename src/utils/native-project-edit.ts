import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NativeProjectError } from './errors.js';

export interface NativeProjectEdit {
  description: string;
  filePath: string;
  isApplied: () => boolean;
  // `init` cannot edit the file, so its confirmation never names it.
  isRefused?: boolean;
  apply: () => void;
}

const GRADLE_EDIT_DESCRIPTION = 'the Gradle task that runs the build step';

const GRADLE_FILE_MARKER = 'hotcodepush.gradle';

const GRADLE_FILE_NAMES = ['build.gradle', 'build.gradle.kts'];

// The line resolves the SDK package through Node, so it finds the package wherever `node_modules` lies.
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

// A file wired by hand holds the marker, so `doctor` passes it and `init` leaves it alone.
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
    isRefused: true,
    apply: () => {
      throw error;
    },
  };
}
