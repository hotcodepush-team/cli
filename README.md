# hotcodepush

The HotCodePush CLI: set up, release and manage live updates for Capacitor, Cordova, React Native and Expo apps from the terminal and CI.

## Installation

The CLI is not on npm yet; install it from GitHub as a dev dependency:

```sh
npm install --save-dev github:hotcodepush-team/cli#dist
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
