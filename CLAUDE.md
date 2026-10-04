# CLAUDE.md

`hotcodepush`, the HotCodePush CLI: the npm package and the binary that set up, release and manage live updates from the terminal and CI.
The repo is public and MIT; this is the skeleton, and the commands arrive issue by issue on top of it.
Stack: TypeScript compiled by `tsc` into ESM in `dist/`, zodline and zod for the commands, `@hotcodepush/node` for the API, `@clack/prompts` for the prompts, `@napi-rs/keyring` for the token, `@bsdiff-rust/node` for the patches, ESLint, Prettier, Vitest, Node 22 as the floor, developed on 24.

The plan is the private `handbook` repo, checked out beside this one: `../handbook/docs/`.
Its `cli.md` is the spec — every command, flag, file, error code and exit code — and `repositories.md` › _The CLI's structure_ the layout; both are binding, with `api.md` for the API the commands call.
When code and plan disagree, stop and surface it; never improvise.

## Layout

```
src/
  index.ts     the registry: space-separated command names, each a lazy import
  commands/    a folder per noun and a file per verb, channel/create.ts; the standalone commands flat, login.ts, init.ts, doctor.ts, open.ts
  utils/       the runner, command resolution and did-you-mean, the E_ catalog and its one mapping,
               the global options, environment detection, config.json, the token store,
               the auth client, the API client, hotcodepush.json and its directory, a resource by id or name,
               the project's fingerprint through the protocol's recipe,
               a bundle by number or id, a release by number or id in its channel with the wait until it is live,
               the released line, the prompts and the confirmation, the pages of a list, the boolean flag, the channel fields,
               the release conditions from their flags, the audience in one clause, a device by id, a duration as a time bound,
               the framework and the build's directory, `frameworks/` with one module per framework behind one interface
               and the registry line that makes the CLI package it, the files of a build hashed, their gzip copies,
               the pack writer, the git provenance, the device hosts derived from the API URL,
               the upload flow, the signing keys at hand and the pair that signs, the patches against the previous bundle
               and the bsdiff binding behind one function, the store build's binary identity from the native projects, the resource file,
               the progress lines, the browser opener, the JSON, tables and details output,
               init's step runner, the outcome rows init and doctor print, the package manager and its visible runs,
               the binary create hook in package.json, the resource reference and the binary create phase in the Xcode project,
               the lines a React Native project is wired with
  config/      consts: the API URL, the client id and header, the config file, the docs and issues URLs,
               the keyring entry, package.json, the project file
test/          the command tests' harness, the API faked behind fetch, their fixtures, the release routes
               and the Capacitor project a test writes, with the pbxproj of `cap add ios`, the fingerprint inputs,
               the Cordova project with its `config.xml`, the protocol's fixtures read from the installed package; never built
dist/          the build output, never committed
```

Tests live beside the code they test, `*.test.ts` next to the file.
There is no `services/` and no `types/`: `@hotcodepush/node` is the API layer and the type source, pinned to one pkg.pr.new build by its commit hash.
The one exception is Better Auth's `/v1/auth/*` slice, reached through `better-auth/client` in `utils/auth-client.ts`, as the handbook's architecture.md places it.

## Commands

| Command             | Does                           |
| ------------------- | ------------------------------ |
| `npm run build`     | compile `src/` into `dist/`    |
| `npm run fmt`       | format with Prettier           |
| `npm run lint`      | ESLint                         |
| `npm test`          | Vitest                         |
| `npm run typecheck` | `tsc --noEmit`, tests included |

Run `npm run fmt` before every commit; lint, typecheck, test and build must pass, as `ci.yml` checks on every push and pull request.
`node dist/index.js --help` runs the build locally.
`ci.yml`'s `preview` job publishes every push to `main` and every pull request to pkg.pr.new, and consumers pin one build by its short commit hash: `npm install --save-dev https://pkg.pr.new/hotcodepush-team/cli/hotcodepush@<sha>`.
No releases yet: the version stays `0.0.0`, and release-please and npm provenance arrive with the publish decision.

## Adding a command

1. `src/commands/<noun>/<verb>.ts`, or `src/commands/<name>.ts` for a standalone one, default-exports zodline's `defineCommand`.
2. Its options are `defineCommandOptions({ … })`, so the global options come with every command.
3. It has a `description` and exactly two `examples`, which end its `--help`.
4. One line joins the registry in `src/index.ts`: `'channel create': () => import('./commands/channel/create.js')`.

## Adding a framework

1. `src/utils/frameworks/<framework>.ts` exports a `FrameworkModule`: the build output, the native projects, the resource file's place,
   the store build's identity, what `init` installs and wires, what `doctor` checks.
2. One line joins the registry in `src/utils/frameworks/index.ts`; a framework without a line is `E_UNSUPPORTED_FRAMEWORK`.
3. Nothing outside the module names the framework: a command asks the module, never a config file or a path of its own.

Capacitor's module reads `capacitor.config` as text and the native projects' own files; Cordova's reads `config.xml` through `fast-xml-parser` and derives the store build's identity as Cordova's prepare does.
React Native's has no build output to read: `packageBundles` runs `react-native bundle` and Hermes' compiler per platform into the command's packaging directory, one bundle each, `collectEmbeddedFiles` takes `main.jsbundle` and `assets/` out of the app the Xcode phase points at, and the native build passes the identity and `--out` in.
Its wiring is five edits, each recognised afterwards by what it wrote: the Xcode phase through the `xcode` package, and one line each in `build.gradle`, `AppDelegate.swift`, `MainApplication.kt` and the Podfile, in `utils/react-native-project.ts`.

## Rules the code does not show

- **A command throws, the entry point exits.**
  A command never calls `process.exit`: it throws an error from `utils/errors.ts`, and `runCli` maps it to the message and the exit code once.
  A new code joins that catalog as a class with its code, exit code, message and fix, and gets its section at `hotcodepush.com/docs/cli/errors#<CODE>`.
- **An error is one line**: the code, what happened, what to do, the docs URL.
  The message is lowercase without a closing period; the fix is one lowercase sentence carrying its own punctuation; a stack trace only with `--verbose`.
- **API errors pass through verbatim**, their code, message and fix as received and never re-mapped; the CLI's catalog covers only what happens before or without the API.
- **Exit codes**: `0` done, `1` an error, `2` a missing or invalid parameter, `3` not logged in, `4` a confirmation required without `--yes`.
- **Parameters are the API's field names**, `--rollout-percentage`, `--channel`: nothing is renamed between the console, the API and the terminal.
  The one exception is a version: `--version` is the CLI's own flag, so a bundle's `version` is `--bundle-version` and a binary's `version` and `build` are `--binary-version` and `--binary-build`, the names a device's `binaryVersion` and `binaryBuild` already carry.
  The schema key is the camelCase field, and zodline takes the kebab-case flag.
- **Options are optional in the schema.**
  A missing required parameter is a prompt when interactive and a `MissingParameterError` naming the flag otherwise, never a zod error.
- **Interactive** means a TTY, no `CI`, and neither `--json` nor `--yes`, which `isInteractive(options)` decides; nothing prompts without it.
- **A command confirms once** when it changes what devices receive, sends something to a person or cannot be undone, stating the consequence.
  `--yes` skips the question; non-interactive without `--yes` throws `ConfirmationRequiredError`; creates and reads never confirm.
- **`--json` is data only**: the human output's content on stdout and nothing else, no prompt, no progress line, no notice.
  An error under `--json` is `{ "error": { "code", "message", "fix" } }` with its exit code; without `--json`, output goes to stdout and diagnostics to stderr.
- **Colour** only where `isColorEnabled(stream)` holds: a TTY, no `NO_COLOR`, no `TERM=dumb`.
  zodline colours its help regardless, so `runCli` strips the codes from its output where colour is off.
- **Commands call commands**: a command that needs what another does runs that command's action in place, never a copy of its logic.
- **A command that reports several outcomes** — `init`'s steps, `doctor`'s checks — prints them itself and ends with `ReportedFailureError` when one failed,
  so the exit code is set without a second message; nothing else throws it.
- **`init` and `binary create` edit only what they can recognise afterwards**: the hook script gains the `binary create` command or is returned as the manual step,
  the Xcode project gains one resource reference or one run-script phase through the `xcode` package, a React Native project's other files one line each,
  and `init` names the files it will change and asks once before touching them.
- **The token** is `readToken()`: `HOTCODEPUSH_TOKEN` when set, then the keyring, then the `config.json` fallback that any keyring failure latches for the rest of the process.
- **An upload never holds a file in memory**: every file is hashed and gzip-compressed through streams into a temporary directory,
  put as a `Blob` opened from disk so the client can retry it, and the Node client splits it into parts above its `SINGLE_UPLOAD_LIMIT_BYTES`; the packs go the same way.
  Only the hashes the API answers as missing move; the delta pack against the previous bundle needs that bundle's manifest from the files host and is skipped, never failed, when it is unreachable.
- **An upload is signed when `hotcodepush.json` lists a public key**, with the first listed key whose private half is at hand:
  `HOTCODEPUSH_SIGNING_KEY` first, a CI's secret holding the one key, then `keys/{appId}.key` in the config directory, one key per line, each the base64 of an RSA key's PKCS #8 DER.
  None at hand is `E_SIGNING_KEY_UNAVAILABLE` before a byte moves, since the app would refuse the unsigned bundle; no listed key means no signature, and the API's `E_SIGNATURE_REQUIRED` passes through.
  The signed bytes are the manifest as the API rebuilds it — the files by path, the patches by path then base, the platforms sorted, by code units — so `buildManifestToSign` and the API's builder change together.
  `signing-key create` appends to `publicKeys` and to the key file, so the key that signs keeps signing until the file's order says otherwise; a private key never reaches a message, a progress line or an error.
  Signing is RSA alone, `rsa-v1_5-sha256`, the keys of 4096 bits and none under 2048 taken; `binary create` writes each listed public key into the resource file in the encoding the platform's own API imports — PKCS #1 DER on iOS, SPKI DER on Android — beside its key id, through Node's key export in `utils/resource-file.ts`, never by hand.
- **A patch is optional bytes**: a file of 16 KB or more whose path the previous bundle lists with other content is diffed from the base's bytes, fetched by hash from the files host,
  and listed when the patch is at most 70 percent of the file's stored bytes.
  A base that cannot be fetched, a platform the binding has no build for and a diff that fails each mean the file moves whole and the upload goes on.
  bsdiff is `@bsdiff-rust/node`'s behind `utils/bsdiff.ts`, the BSDIFF40 format the SDKs apply, never written here.
- **`binary create` resolves the channel before it writes anything**: an id is taken as it is and never asks the API; a name is resolved through the API, which alone knows the id the resource file carries, and a name the app lacks fails everywhere with `E_INVALID_PARAMETER`.
  A build that cannot ask still builds: with `HOTCODEPUSH_OFFLINE=1`, read in `utils/environment.ts` and honoured in CI too, or without a token locally, the API is asked nothing, the resource file carries `channelId: null` or the id it was given, no binary is created, one warning is printed and the exit is 0; an API that cannot be reached or refuses while a name is resolved ends the same way locally.
  CI is the loud half: without a token the build fails with `E_NOT_LOGGED_IN`, exit 3, its fix naming `HOTCODEPUSH_TOKEN` and `HOTCODEPUSH_OFFLINE=1` for a build that is never shipped, and a failed resolution or a failed creation fails the build there, `E_BINARY_CONFLICT` under an unbumped build number being a pipeline mistake.
  The fingerprint is the strict half too: a project the recipe cannot read is `E_FINGERPRINT_UNAVAILABLE` on `binary create` and upload alike, never `null`, since a release targets it.
  The device hosts it writes derive from the API URL: none for production, the staging hosts for staging, `<apiUrl>/files` and `/updates` for any other, `HOTCODEPUSH_FILES_BASE_URL` and `HOTCODEPUSH_UPDATES_BASE_URL` overriding.
- **Every login** keeps its device code, expiry, user code and verification URL in `config.json` until approved; the next `login` redeems the code first and, while it is pending, shows the same code again, so an agent sees one output until the person approves.

## Naming

- A name says what the function does on first read: the verb, the object and, where it matters, the qualifier.
- Prefixes from the monorepo's vocabulary: `fetch` HTTP, `resolve` derivations without I/O, `build` functions that assemble a document without sending it; `read`, `write` and `delete` for the files and the keyring.
- Result variables carry the past participle of their operation, `loadedCommands`.
- Alphabetical ordering within a scope.
  The object passed to `defineCommand` is the one exception, read in the order `description`, `examples`, `args`, `options`, `action`: what the command is, how it is called, what it does.
- One thing per function, its name saying which; never a function that both decides something and phrases the message about it.
- Booleans carry `is` or `has`; a state with a moment is a timestamp such as `pausedAt`, never a boolean.
- Error codes are `E_` plus SCREAMING_SNAKE.
- Never the non-null assertion; nullish coalescing or a real check.
- Test titles read `should <verb> …`, lowercase, conditions starting with `when`.
- Fixtures and examples carry invented data only.

## Agent workspace

- `.mcp.json` is absent on purpose: the one server for this repo's stack, HotCodePush's own at `https://mcp.hotcodepush.com/mcp`, is not live yet; the file arrives with it.
- `.claude/skills/` holds the developer skills copied from `hotcodepush-team/.github` with the skills CLI and pinned in `skills-lock.json`; update them with `npx skills update`.
- `.github/copilot-instructions.md` holds the review criteria, the only Copilot-specific file.
- Commits are conventional commits; `main` is trunk, CI is the gate, and a commit that lands an issue says `Closes #<n>`.
