import type { HotCodePush } from '@hotcodepush/node';
import { resolveBundleLabel } from '../../resources/bundles.js';
import {
  bundleUploadOptionShape,
  buildBundleUpload,
} from '../../upload/bundle-upload.js';
import { withTemporaryDirectory } from '../../upload/compressed-files.js';
import type {
  UploadBundleOptions,
  UploadedBundle,
} from '../../upload/upload.js';
import { resolveUploadedFilesText, uploadBundle } from '../../upload/upload.js';
import { createApiClient } from '../../utils/api-client.js';
import { defineCommand } from '../../utils/command.js';
import { printWarning } from '../../utils/diagnostics.js';
import { defineCommandOptions } from '../../utils/global-options.js';
import { printJson, printResult } from '../../utils/output.js';

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
    const uploadedBundle = await withTemporaryDirectory(
      async packagingDirectoryPath => {
        const uploadBundleOptions = await buildBundleUpload(hotCodePush, {
          options,
          packagingDirectoryPath,
        });
        const uploadedBundle = await uploadBundle(
          hotCodePush,
          uploadBundleOptions,
        );
        const fingerprintWarning = await fetchFingerprintWarning(
          hotCodePush,
          uploadBundleOptions,
        );
        if (fingerprintWarning !== undefined) {
          printWarning(fingerprintWarning);
        }
        return uploadedBundle;
      },
    );
    if (options.json) {
      printJson({ ...uploadedBundle.bundle, upload: uploadedBundle.upload });
      return;
    }
    printUploadedBundle(uploadedBundle);
  },
});

async function fetchFingerprintWarning(
  hotCodePush: HotCodePush,
  { appId, fingerprint }: Pick<UploadBundleOptions, 'appId' | 'fingerprint'>,
): Promise<string | undefined> {
  const { count: fingerprintBinaryCount } =
    await hotCodePush.apps.binaries.count({ appId, fingerprint });
  if (fingerprintBinaryCount > 0) {
    return undefined;
  }
  const { count: binaryCount } = await hotCodePush.apps.binaries.count({
    appId,
  });
  return binaryCount === 0
    ? 'The app has no binary yet, so no store build can take this bundle.'
    : 'No binary of the app carries this fingerprint.';
}

function printUploadedBundle({ bundle, upload }: UploadedBundle): void {
  printResult({
    rows: [
      ['ID', bundle.id],
      ['Platforms', bundle.platforms.join(', ')],
      ['Uploaded', resolveUploadedFilesText(upload)],
    ],
    sentence: `Uploaded bundle ${resolveBundleLabel(bundle)}.`,
  });
}
