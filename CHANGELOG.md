# Changelog

## [0.2.2](https://github.com/hotcodepush-team/cli/compare/v0.2.1...v0.2.2) (2026-11-02)


### Features

* --json only formats, --no-input asks nothing ([4692b57](https://github.com/hotcodepush-team/cli/commit/4692b57dda9f60f86a1e427b6a437b266cdd2372))
* a prompt is one line, without the bars ([#117](https://github.com/hotcodepush-team/cli/issues/117)) ([89c80ee](https://github.com/hotcodepush-team/cli/commit/89c80eed039f34f6d5d02f44b6b053032580cedf))
* a result is a sentence and rows, decorated on a terminal ([#114](https://github.com/hotcodepush-team/cli/issues/114)) ([51490c3](https://github.com/hotcodepush-team/cli/commit/51490c37cc0878d052a1b680c98e2e46afab1550))
* **doctor:** report a Capacitor app that never imports the SDK ([#120](https://github.com/hotcodepush-team/cli/issues/120)) ([e087ff8](https://github.com/hotcodepush-team/cli/commit/e087ff8dcdaa49394bf717b62ff474768da6a119))
* every write prints a sentence and rows ([#115](https://github.com/hotcodepush-team/cli/issues/115)) ([fca54b5](https://github.com/hotcodepush-team/cli/commit/fca54b549e5ee4d7fb2d4c40b3887457e6699d54))
* export the framework modules ([#118](https://github.com/hotcodepush-team/cli/issues/118)) ([85306f1](https://github.com/hotcodepush-team/cli/commit/85306f1712fdd1dd1fa24b2a475c8b15e6475fce))
* **signing-key:** get shows a key with its public key ([#113](https://github.com/hotcodepush-team/cli/issues/113)) ([4326eae](https://github.com/hotcodepush-team/cli/commit/4326eaef0aaea998249a2af5915daf540d8cbd18))

## [0.2.1](https://github.com/hotcodepush-team/cli/compare/v0.2.0...v0.2.1) (2026-11-02)


### Features

* channel delete says how many devices were on the channel ([#104](https://github.com/hotcodepush-team/cli/issues/104)) ([b44eef7](https://github.com/hotcodepush-team/cli/commit/b44eef7c9063cf079dc36facaf004988deb0ed3c))

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
