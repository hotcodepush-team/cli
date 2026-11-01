# Changelog

## [0.2.0](https://github.com/hotcodepush-team/cli/compare/v0.1.0...v0.2.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* release create sends raw attribute values and device ids ([#100](https://github.com/hotcodepush-team/cli/issues/100))

### Features

* release create sends raw attribute values and device ids ([#100](https://github.com/hotcodepush-team/cli/issues/100)) ([1ba6a95](https://github.com/hotcodepush-team/cli/commit/1ba6a95352215bc0bca0bd0361b217d2bb0b6fa6))
* the session is a precondition, and diagnostics share clack's gutter ([#102](https://github.com/hotcodepush-team/cli/issues/102)) ([fda6b95](https://github.com/hotcodepush-team/cli/commit/fda6b95079d7bbf429aafb9714058f630c0ef539))

## [0.1.0](https://github.com/hotcodepush-team/cli/compare/v0.0.1...v0.1.0) (2026-11-01)

### ⚠ BREAKING CHANGES

- the auto-pause flag is --failure-threshold-percent ([#97](https://github.com/hotcodepush-team/cli/issues/97))
- the CLI follows the Node SDK 3146611 and protocol 54a237c after the contract audit ([#96](https://github.com/hotcodepush-team/cli/issues/96))
- whoami prints identity only, limit get goes, the env vars and condition flags take their decided names, and the webhook commands land ([#95](https://github.com/hotcodepush-team/cli/issues/95))
- **bundle:** `bundle get --json` prints the key `deltas` in place of `deltaPacks`, and the table label reads Deltas. Taken at 0.0.1, before anyone depends on the key.

### Features

- **bundle:** bundle get prints deltas, not deltaPacks ([#92](https://github.com/hotcodepush-team/cli/issues/92)) ([ad8c731](https://github.com/hotcodepush-team/cli/commit/ad8c7317e84da31a2366715ae242766b1abd28c1))
- init installs the SDKs that carry the iOS core, and HOTCODEPUSH_API_URL names the API ([#90](https://github.com/hotcodepush-team/cli/issues/90)) ([4eba9a1](https://github.com/hotcodepush-team/cli/commit/4eba9a15547714910e489b7a273c787c57862151))
- the auto-pause flag is --failure-threshold-percent ([#97](https://github.com/hotcodepush-team/cli/issues/97)) ([2d7d14e](https://github.com/hotcodepush-team/cli/commit/2d7d14e54e68080e9b489ed13a0e42a558bd99e6))
- the CLI follows the Node SDK 3146611 and protocol 54a237c after the contract audit ([#96](https://github.com/hotcodepush-team/cli/issues/96)) ([5e67cbc](https://github.com/hotcodepush-team/cli/commit/5e67cbc7c62470018263fc0710c064868ebc8ce2))
- whoami prints identity only, limit get goes, the env vars and condition flags take their decided names, and the webhook commands land ([#95](https://github.com/hotcodepush-team/cli/issues/95)) ([c4d84ff](https://github.com/hotcodepush-team/cli/commit/c4d84ffd2c4d9a023c4e2e54d8eb1a9239fc78f3))

### Bug Fixes

- init lets --app override a hotcodepush.json whose app does not exist, and writes the file --config names ([#91](https://github.com/hotcodepush-team/cli/issues/91)) ([21e3377](https://github.com/hotcodepush-team/cli/commit/21e3377d9217b34254e4f2507c1366b9be7a9933))
- **init:** sign the first release with the key it wrote and name the command once ([#94](https://github.com/hotcodepush-team/cli/issues/94)) ([dbffa23](https://github.com/hotcodepush-team/cli/commit/dbffa23dcfdeb0747e44bcccf55451dbb1f5370d))
