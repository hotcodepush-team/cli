# Breaking Changes

This is a comprehensive list of the breaking changes introduced in the minor version releases while the CLI is on `0.x`.

## Versions

- [Version 0.3.x](#version-03x)

## Version 0.3.x

### One Release Per Run

`release create` makes one release on one channel per run. `--channel` takes one value. On React Native and Expo `--platform` takes one value and is required when the command uploads or promotes, since a bundle there serves one platform. Run the command once per platform:

```diff
- npx hotcodepush release create
+ npx hotcodepush release create --platform ios
+ npx hotcodepush release create --platform android
```

On Capacitor and Cordova one run still serves both platforms, and `--platform` narrows the release to one of them.

### JSON Output Is One Object

`release create --json` prints the release as one object instead of an array, its dry run prints the audience, and `bundle upload --json` prints the bundle. A script that read the first element of the array reads the object:

```diff
- npx hotcodepush release create --json | jq -r '.[0].id'
+ npx hotcodepush release create --platform ios --json | jq -r '.id'
```

### Platform On Rollback

`release rollback` takes `--platform <ios|android>`, required on React Native and Expo, and undoes the channel's newest active release serving that platform. A `--to-release` whose bundle does not serve the platform is refused.

### Removed `--source` Option

The `--source` option of `bundle list` has been removed. The list holds the uploaded bundles, and the bundle a binary ships is read through `binary get`.

### Minimum Version

The API refuses versions below **0.3.0** with `client_update_required`. Update the CLI in your project and your pipeline before the next release.
