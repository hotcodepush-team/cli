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

// Either way no store build can take the bundle.
type FingerprintGap = 'no_binary' | 'unknown_fingerprint';

const FINGERPRINT_GAP_TEXTS: Record<FingerprintGap, string> = {
  no_binary:
    'No binary is registered for this app yet, so no store build can receive this bundle until one is built.',
  unknown_fingerprint: 'No binary of the app carries this fingerprint.',
};

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
    const { uploadBundleOptions, uploadedBundle } =
      await withTemporaryDirectory(async packagingDirectoryPath => {
        const builtOptions = await buildBundleUpload(hotCodePush, {
          options,
          packagingDirectoryPath,
        });
        return {
          uploadBundleOptions: builtOptions,
          uploadedBundle: await uploadBundle(hotCodePush, builtOptions),
        };
      });
    const fingerprintGap = await fetchFingerprintGap(
      hotCodePush,
      uploadBundleOptions,
    );
    if (fingerprintGap !== undefined) {
      printWarning(FINGERPRINT_GAP_TEXTS[fingerprintGap]);
    }
    if (options.json) {
      printJson({ ...uploadedBundle.bundle, upload: uploadedBundle.upload });
      return;
    }
    printUploadedBundle(uploadedBundle);
  },
});

async function fetchFingerprintGap(
  hotCodePush: HotCodePush,
  { appId, fingerprint }: Pick<UploadBundleOptions, 'appId' | 'fingerprint'>,
): Promise<FingerprintGap | undefined> {
  const { count: fingerprintBinaryCount } =
    await hotCodePush.apps.binaries.count({ appId, fingerprint });
  if (fingerprintBinaryCount > 0) {
    return undefined;
  }
  const { count: binaryCount } = await hotCodePush.apps.binaries.count({
    appId,
  });
  return binaryCount === 0 ? 'no_binary' : 'unknown_fingerprint';
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
