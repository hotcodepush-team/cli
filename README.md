# hotcodepush

The HotCodePush CLI: set up, release and manage live updates for Capacitor, Cordova, React Native and Expo apps from the terminal and CI.

## Installation

The CLI is not on npm yet; install the preview build of a commit on `main` as a dev dependency, `<sha>` being the commit's short hash:

```sh
npm install --save-dev https://pkg.pr.new/hotcodepush-team/cli/hotcodepush@<sha>
```

## Usage

```sh
npx hotcodepush --help
npx hotcodepush login
npx hotcodepush organization create --name Acme
npx hotcodepush app create --name "My App" --framework capacitor
npx hotcodepush channel create --app "My App" --name staging
npx hotcodepush channel pause --app "My App" --channel staging
npx hotcodepush channel list --app "My App" --json
```

Every command prints its options and two examples with `--help`, and `--json` turns its output into JSON for scripts and agents.
An organization, app or channel is named by id or by name, `--app "My App"`; `--app` and `--channel` default to the ids in the project's `hotcodepush.json`.
A command that deletes, pauses, resumes or transfers asks once, `--yes` confirming in scripts.

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
