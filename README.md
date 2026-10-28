# hotcodepush

The HotCodePush CLI: set up, release and manage over-the-air (OTA) updates for React Native, Expo, Capacitor and Cordova apps from the terminal and CI.

## Installation

The CLI is not on npm yet. Install the preview build of a commit on `main` as a dev dependency, `<sha>` being the commit's short hash:

```sh
npm install --save-dev https://pkg.pr.new/hotcodepush-team/cli/hotcodepush@<sha>
```

## Usage

```sh
npx hotcodepush login
npx hotcodepush init                                  # wires the SDK and the build step into your project
npx hotcodepush release create --path dist            # uploads the build and releases it to the project's channel
npx hotcodepush release create --channel staging --rollout-percentage 10
npx hotcodepush doctor                                # checks the setup
npx hotcodepush --help                                # every command; <command> --help for its flags
```

Every command takes `--json` for machine-readable output and `--yes` to skip confirmations.
In CI, set `HOTCODEPUSH_TOKEN` instead of logging in.

### Telemetry

After each command, the CLI sends one anonymous event (command name, outcome, duration, version, CI flag, framework) to PostHog, and unexpected errors without their message to Sentry.
No argument, path or name from your project is ever sent.
Set `HOTCODEPUSH_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1` to turn it off.

## Documentation

See [hotcodepush.com/docs/cli](https://hotcodepush.com/docs/cli).

## Development

```sh
nvm use
npm ci
npm run build        # compiles src/ into dist/; node dist/index.js --help runs it
npm test
npm run lint && npm run typecheck
npm run fmt          # Prettier, run before every commit
```

Tests live next to the code they test as `*.test.ts`.
`CLAUDE.md` holds the layout, the rules and how to add a command or a framework.

## License

See [LICENSE](./LICENSE).
