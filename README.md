# hotcodepush

The HotCodePush CLI: set up, release and manage live updates for Capacitor, Cordova, React Native and Expo apps from the terminal and CI.

## Installation

The CLI is not on npm yet; install the preview build of a commit on `main` as a dev dependency, `<sha>` being the commit's short hash:

```sh
npm install --save-dev https://pkg.pr.new/hotcodepush-team/cli/hotcodepush@<sha>
```

## Usage

```sh
npx hotcodepush init
npx hotcodepush doctor --json
npx hotcodepush open
npx hotcodepush --help
npx hotcodepush login
npx hotcodepush organization create --name Acme
npx hotcodepush app create --name "My App" --framework capacitor
npx hotcodepush channel create --app "My App" --name staging
npx hotcodepush channel pause --app "My App" --channel staging
npx hotcodepush channel list --app "My App" --json
npx hotcodepush bundle upload --path dist --bundle-version 1.4.2
npx hotcodepush bundle list --json
npx hotcodepush bundle list --type embedded
npx hotcodepush binary list
npx hotcodepush signing-key create
npx hotcodepush signing-key list
npx hotcodepush release create --path dist
npx hotcodepush release create --bundle 17 --channel staging --rollout-percentage 10
npx hotcodepush release create --from-channel staging --channel production --binary ">=2.3.0" --dry-run
npx hotcodepush release rollout --release 43 --rollout-percentage 100
npx hotcodepush release rollback
npx hotcodepush release revoke --release-from 40 --yes
npx hotcodepush release list --json
npx hotcodepush audience get --binary ">=2.3.0" --rollout-percentage 10
npx hotcodepush device list --attribute userId=42
npx hotcodepush device probe --platform ios --binary-version 2.4.1 --binary-build 57
npx hotcodepush statistics get --type fleet
npx hotcodepush fingerprint
```

`init` takes a Capacitor, Cordova, Expo or React Native project from sign-in to the first release — the organization, the app, the SDK package from its pkg.pr.new build until it is published, `hotcodepush.json` and the build step — re-runnable at any step, each step `done`, `skipped` or `stopped` with the manual step; `doctor` is the read-only check of the same, and `open` opens the app's console page.
On Capacitor the build step is the `capacitor:copy:after` hook and the iOS resource reference, which `init` wires; on Cordova `init` runs `cordova plugin add`, and the plugin brings its own `after_prepare` hook, so nothing is wired.
On React Native `init` adds the Xcode phase "Create HotCodePush binary" after "Bundle React Native code and images" and one `apply from` line to `android/app/build.gradle`, which run the build step inside the native build, makes `AppDelegate.swift` and `MainApplication.kt` ask the SDK for the bundle React Native runs, pins the `HotCodePushProtocol` pod in the Podfile until it is published, and runs `pod install`; an edit a file has no place for is that step's manual step, and `hotcodepush.json` names no `dir`.
On Expo `init` installs the package and adds its config plugin to the app config, `app.config.json` where the project has one and `app.json` otherwise; the plugin wires the native projects at `npx expo prebuild` as `init` wires a React Native project, so `init` edits no native file and runs no prebuild.
Beside an app config that is code, or with a JSON one the CLI cannot parse, `init` edits no app config and the entry to add is that step's manual step; `hotcodepush.json` names no `dir` on Expo either.
Every command prints its options and two examples with `--help`, and `--json` turns its output into JSON for scripts and agents.
An organization, app or channel is named by id or by name, `--app "My App"`; `--app` defaults to the app id in the project's `hotcodepush.json` and `--channel` to the channel it names, `production` unless the file or `HOTCODEPUSH_CHANNEL` says otherwise.
A command that changes what devices receive or cannot be undone — a release, a rollout, a pause, a revoke, a rollback, a delete — asks once with the consequence, `--yes` confirming in scripts.
On React Native and Expo `bundle upload` and `release create` package the bundles themselves: `react-native bundle` per platform, `expo export:embed` on Expo, compiled with Hermes where the app runs it, one bundle per platform and so one release per platform and channel; `--platform ios` limits both to one, and `--path` names a prepared bundle directory for the one platform `--platform` names.
That directory holds the JavaScript under the name the platform's app loads, `main.jsbundle` on iOS or `index.android.bundle` on Android, and is refused without it, so an `expo export` directory is not one.
`bundle upload` hashes every file of the build, signs the manifest when `hotcodepush.json` lists a public key, uploads only the files the app lacks, then the full pack and one delta pack per base, and records the commit it was built from.
It signs with the private key file `--private-key-path` names, otherwise with the key in `HOTCODEPUSH_SIGNING_KEY`, which CI sets from a secret holding the file's content; `release create` takes both where it uploads.
The bases are the bundles a device may run before it asks for the new one: the three newest earlier bundles with the same fingerprint and a platform in common, and the bundles the binaries with that fingerprint ship on its platforms.
On React Native and Expo the delta packs against the newest earlier bundle and the binaries carry the main JavaScript bundle as a patch in place of the whole file, where the patch is smaller.
The bundles are compiled with React Native's default release flags, so they match what a store build embeds; a project that changes `hermesFlags` in its Gradle file or sets `SOURCEMAP_FILE` for its Xcode build still gets working updates, only with a larger download for the main bundle.
`bundle list` shows the bundles you uploaded; `--type embedded` shows the ones your binaries ship, which carry no number, and `--type all` both.
`signing-key create` turns code signing on: it generates an RSA key pair of 4096 bits on this machine, registers the public key with the app, adds it to `publicKeys` in `hotcodepush.json` and writes the private key, which it never prints, to a new file — `hotcodepush-private-key.pem` in the working directory unless `--private-key-path` names another — after which the app releases only signed bundles.
Keep the file out of version control: whoever holds it can sign the app's bundles.
The CLI keeps no copy and HotCodePush receives only the public key, so a lost private key means a new key and a new store build that trusts it.
The one key signs for the SDKs and the Expo Updates bridge alike, `signing-key list` shows the fingerprints, and `signing-key delete` unregisters a key, never the app's only one.
`release create` uploads the web build unless `--bundle` names one already uploaded, releases it to every `--channel` named with the project's channel as the default, and waits until the release is live; a retried pipeline gets the same release back, the `Idempotency-Key` being derived from the bundle and the channel.
A release carries its conditions as flags — `--binary`, `--os`, `--runtime`, `--attribute` and `--device` — and `--from-channel` releases what another channel serves; `--dry-run` publishes nothing and prints the audience the release would reach, the count `audience get` answers on its own.
`release revoke` takes one release, every release from a number on with `--release-from`, a channel's whole log with `--all`, or every release of a bundle with `--bundle`; revoked is final, and the confirmation says how many releases move and where their devices land.
`device probe` answers why a device did not update: it reads the live index as a device would, evaluates every release in the frontier for the facts given, or for a registered device with `--device`, and marks each condition passed, failed or unknown.
`statistics get` reads the fleet, the updates or the usage of an app, chosen with `--type`, and `fingerprint` prints the native contract's hash with the packages and native sources behind it, without a login.
`binary create` is the build step the native hook runs — `npx hotcodepush binary create` from Capacitor's `capacitor:copy:after`, the Cordova plugin's `after_prepare`, or the Xcode phase and the Gradle task of a React Native or Expo build, which pass in the version, the build number and where the file goes — writing the resource file the SDK reads and creating the store build's binary in HotCodePush, with the bundle it ships and its fingerprint; a Cordova build takes its version and build number from `config.xml`, as Cordova itself derives them, and a React Native or Expo build that bundled nothing, a debug build Metro serves, creates nothing and needs no login.
Without a token, or with `HOTCODEPUSH_OFFLINE=1` for a build that is never shipped, it writes the file without a channel and creates no binary, so the build takes no updates; in CI a missing token fails the build instead.

## Documentation

See [hotcodepush.com/docs/cli](https://hotcodepush.com/docs/cli).

## Development

```sh
nvm use
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run fmt` formats the code with Prettier.
`bsdiff-wasm/build.sh` rebuilds `bsdiff-wasm/bsdiff.wasm`, the module that writes the patches, in a Docker image pinned by digest; run it after a change in `bsdiff-wasm/` and commit the module, which CI rebuilds and compares byte for byte.

## License

See [LICENSE](./LICENSE), and [THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES) for the code compiled into `bsdiff-wasm/bsdiff.wasm`.
