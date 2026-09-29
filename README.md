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
```

Every command prints its options and two examples with `--help`, and `--json` turns its output into JSON for scripts and agents.

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
