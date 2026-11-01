import type { HotCodePush } from '@hotcodepush/node';
import { resolveBundleLabel } from '../../resources/bundles.js';
import {
  bundleUploadOptionShape,
  buildBundleUploads,
} from '../../upload/bundle-upload.js';
import { withTemporaryDirectory } from '../../upload/compressed-files.js';
import type {
  UploadBundleOptions,
  UploadedBundle,
} from '../../upload/upload.js';
import { uploadBundle } from '../../upload/upload.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printWarning } from '../../utils/diagnostics.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, resolveByteText } from '../../utils/output.js';

const FINGERPRINT_UNKNOWN_TEXT =
  'No binary of the app carries this fingerprint.';

export default defineCommand({
  description:
    'Upload a build as a bundle, signed where a key is configured. Only the files the app lacks move, then the full pack. Nothing is released.',
  examples: [
    'hotcodepush bundle upload',
    'hotcodepush bundle upload --path dist --bundle-version 1.4.2 --platform ios --json',
  ],
  options: defineCommandOptions(bundleUploadOptionShape),
  action: async options => {
    const hotCodePush = createApiClient();
    const uploadedBundles = await withTemporaryDirectory(
      async packagingDirectoryPath => {
        const { bundleUploads } = await buildBundleUploads(hotCodePush, {
          options,
          packagingDirectoryPath,
        });
        const bundles: UploadedBundle[] = [];
        for (const uploadBundleOptions of bundleUploads) {
          bundles.push(await uploadBundle(hotCodePush, uploadBundleOptions));
        }
        // All platform bundles share the project fingerprint, so one check covers them.
        const [sharedOptions] = bundleUploads;
        if (
          sharedOptions !== undefined &&
          (await fetchIsFingerprintUnknown(hotCodePush, sharedOptions))
        ) {
          printWarning(FINGERPRINT_UNKNOWN_TEXT);
        }
        return bundles;
      },
    );
    printUploadedBundles(uploadedBundles, options.json);
  },
});

// An app without any binary stays silent, since its first store build is still to come.
async function fetchIsFingerprintUnknown(
  hotCodePush: HotCodePush,
  { appId, fingerprint }: Pick<UploadBundleOptions, 'appId' | 'fingerprint'>,
): Promise<boolean> {
  const { count: fingerprintBinaryCount } =
    await hotCodePush.apps.binaries.count({ appId, fingerprint });
  if (fingerprintBinaryCount > 0) {
    return false;
  }
  const { count: binaryCount } = await hotCodePush.apps.binaries.count({
    appId,
  });
  return binaryCount > 0;
}

// `--json` always prints an array, as `release create` prints its releases.
function printUploadedBundles(
  uploadedBundles: UploadedBundle[],
  isJson: boolean | undefined,
): void {
  if (isJson) {
    printJson(uploadedBundles.map(resolveUploadedBundleJson));
  } else {
    uploadedBundles.forEach(printUploadedBundle);
  }
}

function resolveUploadedBundleJson({ bundle, upload }: UploadedBundle): object {
  return { ...bundle, upload };
}

function printUploadedBundle({ bundle, upload }: UploadedBundle): void {
  console.log(
    `Uploaded bundle ${resolveBundleLabel(bundle)} (${bundle.id}): ${upload.fileCount} files moved, ${resolveByteText(upload.sizeBytes)}.`,
  );
}
