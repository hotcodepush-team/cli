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
npx hotcodepush embedded-bundle list
npx hotcodepush release create --path dist
npx hotcodepush release create --bundle 17 --channel staging --rollout-percentage 10
npx hotcodepush release rollout --release 43 --rollout-percentage 100
npx hotcodepush release rollback
npx hotcodepush release list --json
```

`init` takes a Capacitor project from sign-in to the first release — the organization, the app, the SDK package from its pkg.pr.new build until it is published, `hotcodepush.json`, the `capacitor:copy:after` hook and the iOS resource reference — re-runnable at any step, each step `done`, `skipped` or `stopped` with the manual step; `doctor` is the read-only check of the same, and `open` opens the app's console page.
Every command prints its options and two examples with `--help`, and `--json` turns its output into JSON for scripts and agents.
An organization, app or channel is named by id or by name, `--app "My App"`; `--app` and `--channel` default to the ids in the project's `hotcodepush.json`.
A command that changes what devices receive or cannot be undone — a release, a rollout, a pause, a revoke, a rollback, a delete — asks once with the consequence, `--yes` confirming in scripts.
`bundle upload` hashes every file of the web build, uploads only the files the app lacks and the packs, and records the commit it was built from.
`release create` uploads the web build unless `--bundle` names one already uploaded, releases it to every `--channel` named with the project's channel as the default, and waits until the release is live; a retried pipeline gets the same release back, the `Idempotency-Key` being derived from the bundle and the channel.
`bundle embed` is the build step the native hook runs — `npx hotcodepush bundle embed` from `capacitor:copy:after` — writing the resource file the SDK reads and registering the store build's embedded bundle.

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

## License

See [LICENSE](./LICENSE).
