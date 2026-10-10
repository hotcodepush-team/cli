# CLAUDE.md

`hotcodepush`, the HotCodePush CLI: the npm package and the binary that set up, release and manage live updates from the terminal and CI.
The repo is public and MIT; the commands in `src/index.ts`'s registry are built, for Capacitor, Cordova, Expo and React Native projects, and the rest of the spec arrives issue by issue.
Stack: TypeScript compiled by `tsc` into ESM in `dist/`, zodline and zod for the commands, `@hotcodepush/node` for the API, `@clack/prompts` for the prompts, `@napi-rs/keyring` for the token, ESLint, Prettier, Vitest, Node 22 as the floor, developed on 24.

The plan is the private `handbook` repo, checked out beside this one: `../handbook/docs/`.
Its `cli.md` is the spec — every command, flag, file, error code and exit code — and `repositories.md` › _The CLI's structure_ the layout; both are binding, with `api.md` for the API the commands call.
When code and plan disagree, stop and surface it; never improvise.

## Layout

```
src/
  index.ts     the registry: space-separated command names, each a lazy import
  commands/    a folder per noun and a file per verb, channel/create.ts, resource-file/write.ts; the standalone commands flat, login.ts, init.ts, doctor.ts, open.ts
  utils/       the runner, command resolution and did-you-mean, the E_ catalog and its one mapping,
               the global options, environment detection, config.json, the token store,
               the auth client, the API client, hotcodepush.json and its directory, the JSON files a person edits read as `E_INVALID_JSON` when they do not parse, a resource by id or name,
               the project's fingerprint through the protocol's recipe,
               a bundle by number or id, a release by number or id in its channel with the wait until it is live,
               the released line, the prompts and the confirmation, the pages of a list, the boolean flag, the channel fields,
               the release conditions from their flags, the audience in one clause, a device by id, a duration as a time bound,
               the framework and the build's directory, `frameworks/` with one module per framework behind one interface
               and the registry line that makes the CLI package it, beside them React Native's release build, which
               Expo's module runs too, the SDK package's install and check and the native projects as named or asked for,
               the files of a build hashed, their gzip copies,
               the pack writer, the git provenance, the device hosts derived from the API URL,
               the upload flow, the private key an upload is given, read into the pair that signs, and the writer of its file,
               the progression schedule from its flags, the spending cap in whole dollars, a member or an invitation by id or email,
               the native glue the Capacitor and Cordova modules name, one constant in `frameworks/native-glue.ts`,
               the build step both commands share, the resource file,
               the progress lines, the browser opener, the JSON, tables and details output,
               init's step runner, the outcome rows init and doctor print, the package manager and its visible runs,
               the native-project edits: the binary create phase in the Xcode project and the removal of the resource reference an earlier init added, package.json reading,
               the lines a React Native project is wired with
  config/      consts: the API URL, the client id and header, the config file, the docs and issues URLs,
               the keyring entry, package.json, the project file, the SDK packages' names and pinned specs,
               the manual step that runs `init`
test/          the command tests' harness, the API faked behind fetch, their fixtures, the release routes
               and the Capacitor project a test writes, with the pbxproj of `cap add ios`, its Gradle file and the old resource reference, the fingerprint inputs,
               the Cordova project with its `config.xml` and the native glue a platform copy carries, the React Native project with its pbxproj,
               the protocol's fixtures read from the installed package; never built
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

Run `npm run fmt` before every commit; lint, typecheck, test and build must pass, as `ci.yml` checks on every push to `main` and every pull request, on Ubuntu, macOS and Windows, each on Node 22 and 24.
A test of a POSIX file mode is skipped on Windows, which has none: a file there is protected by the access list of its folder, the user profile's for `config.json` and the project's own for a private key file.
`node dist/index.js --help` runs the build locally.
`ci.yml`'s `preview` job publishes every push to `main` and every pull request to pkg.pr.new, and consumers pin one build by its short commit hash: `npm install --save-dev https://pkg.pr.new/hotcodepush-team/cli/hotcodepush@<sha>`.
No releases yet: the version stays `0.0.0`, and release-please and npm provenance arrive with the publish decision.

## Adding a command

1. `src/commands/<noun>/<verb>.ts`, or `src/commands/<name>.ts` for a standalone one, default-exports zodline's `defineCommand`.
2. Its options are `defineCommandOptions({ … })`, so the global options come with every command.
3. It has a `description` and exactly two `examples`, which end its `--help`.
4. One line joins the registry in `src/index.ts`: `'channel create': () => import('./commands/channel/create.js')`.

## Adding a framework

1. `src/utils/frameworks/<framework>.ts` exports a `FrameworkModule`: the build output, read when the upload runs, or the reason there is none, the native projects, the optional `nativeGluePaths` left out of the embedded manifest and of an upload, what `init` installs and wires,
   what `doctor` checks, and, where the framework has one,
   the optional `resolveMainBundlePath`, which names the main JavaScript bundle among a bundle's files for the delta packs to carry as a patch.
2. One line joins the registry in `src/utils/frameworks/index.ts`.
3. Nothing outside the module names the framework: a command asks the module, never a config file or a path of its own.

Capacitor's module reads `capacitor.config` as text and no native file, `webDir` when the upload runs, and a config with no `webDir` readable as a quoted string makes `--path` required, `E_MISSING_PARAMETER` naming the reason; Cordova's reads `config.xml` through `fast-xml-parser` for the file-mode preference alone. The store build's identity comes from the build on every framework, never from a project file: the hook script passes the version and the build number it read from the processed `Info.plist` or the variant. Capacitor and React Native are wired the same way, `init` adding the phase and the Gradle line; Cordova's plugin and Expo's config plugin wire themselves.
React Native's and Expo's have no build output to read and share React Native's release build in `frameworks/react-native-build.ts`: `packageReactNativeBundles` runs the module's bundler and Hermes' compiler per platform into the command's packaging directory, one bundle each, `collectEmbeddedFiles` takes `main.jsbundle` and `assets/` out of the app the Xcode phase points at, the native build passes the identity and `--resource-file-path` in, and `resolveMainBundlePath` answers `main.jsbundle` on iOS and `index.android.bundle` on Android where a bundle's files hold it.
The bundler is all the two differ in there: `react-native bundle` with the project's entry file for React Native, `expo export:embed`, which resolves the entry file itself, for Expo.
`--path` is the prepared bundle directory of the one platform `--platform` names, refused without the JavaScript under the name that platform's app loads.
React Native's wiring is five edits, each recognised afterwards by what it wrote: the Xcode phase through the `xcode` package, and one line each in `build.gradle`, `AppDelegate.swift`, `MainApplication.kt` and the Podfile, in `utils/react-native-project.ts`.
Expo's wiring is one entry, the SDK's config plugin in the plugins of the JSON app config, `app.config.json` before `app.json`, and a project without an app config gets an `app.json`; the plugin makes React Native's five edits at prebuild, so the module names no native file and `init` runs no prebuild.
A project with an app config that is code, or with a JSON one that does not parse, gets no edit: the entry to add is the manual step.
`doctor`'s `hook` row finds the entry in either app config: among the plugins of a JSON config it parses, otherwise by the package's name in the text, never by evaluating code.

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
- **`init` edits only what it can recognise afterwards**: the Xcode project gains one run-script phase through the `xcode` package and loses the resource reference an earlier `init` added,
  a Capacitor or React Native project's other files one line each,
  an Expo project's JSON app config one plugin entry,
  and `init` names the files it will change and asks once before touching them.
- **The token** is `readToken()`: `HOTCODEPUSH_TOKEN` when set, then the keyring, then the `config.json` fallback that any keyring failure latches for the rest of the process.
- **An upload never holds a file in memory**: every file is hashed and gzip-compressed through streams into a temporary directory,
  put as a `Blob` opened from disk so the client can retry it, and the Node client splits it into parts above its `SINGLE_UPLOAD_LIMIT_BYTES`; the packs go the same way.
  Only the hashes the API answers as missing move, then the full pack; the platform derives the delta packs and the patches by its own triggers, so the CLI reads no base, fetches no base file and computes no patch (cli#82, 2026-10-10).
- **An upload is signed when `hotcodepush.json` lists a public key**, with the private key it is given:
  the file `--private-key-path` names, otherwise the key's text in `HOTCODEPUSH_SIGNING_KEY`, which a CI sets from a secret; an empty variable is unset.
  The CLI stores no private key and looks for none; `bundle upload` and `release create`, where it uploads, take both, and the key must belong to one of the listed public keys.
  A key is read through Node's key import as PKCS #8 or as PKCS #1, the form Expo's tool writes, with its PEM lines or without them, on one line too.
  Keys listed and no key given is `E_SIGNING_KEY_UNAVAILABLE` before a byte moves, since the app would refuse the unsigned bundle.
  A dry run requires no key, since it signs nothing; a key it is given is still checked.
  A key given while none is listed, a file that cannot be read, an encrypted key, a key that is no RSA key of at least 2048 bits and a key that belongs to no listed public key are `E_INVALID_PARAMETER`, the message naming the flag or the variable the key came through.
  No listed key and no key given means no signature, and the API's `E_SIGNATURE_REQUIRED` passes through.
  The signed bytes are the manifest as the API rebuilds it — the files by path, the platforms sorted, by code units — so `buildManifestToSign` and the API's builder change together.
  `signing-key create` writes the private key as a PEM file of PKCS #8 through Node's key export, to `--private-key-path` or to `hotcodepush-private-key.pem` in the working directory, mode `0600` on macOS and Linux.
  It refuses an existing file and a missing folder before any request, writes the file before it registers the public key and removes it again when the registration fails, and appends the public key to `publicKeys` last; its `--json` carries `privateKeyPath`, never the key.
  `doctor` looks for no key file: it checks that the app has registered the listed public keys and, where the variable is set, that its key belongs to one of them.
  `signing-key add` reads the private key file `--private-key-path` names through the same import, derives the public key from it, refuses a key that is no RSA key of at least 2048 bits before any request, registers the public key and appends it to `publicKeys` unless listed; it writes, copies and moves no key file, and its `--json` is `create`'s without `privateKeyPath`.
  A private key never reaches a message, a progress line or an error.
  Signing is RSA alone, `rsa-v1_5-sha256`, the keys of 4096 bits and none under 2048 taken; `binary create` writes each listed public key into the resource file in the encoding the platform's own API imports — PKCS #1 DER on iOS, SPKI DER on Android — beside its key id, through Node's key export in `utils/resource-file.ts`, never by hand.
- **The platform makes the delta packs and the patches, never the CLI**: an upload is the files the app lacks, the signed manifest and the full pack, and the delta packs against the bases a channel's devices run, with the main bundle of a React Native or Expo build as a BSDIFF40 patch inside them, are built on the platform after the release.
- **The build step is two commands over one module, `utils/build-step.ts`**: `resource-file write` resolves the channel and writes the resource file; `binary create` does the same and creates the binary first, so the file carries its embedded bundle's id. An id is taken as it is and never asks the API; a name is resolved through the API, which alone knows the id the resource file carries, and a name the app lacks fails everywhere with `E_INVALID_PARAMETER`. On Capacitor and Cordova the embedded manifest leaves out `NATIVE_GLUE_PATHS`, and `bundle upload`, `release create`'s upload and its dry run leave out the same glue, with one progress line.
  `resource-file write` never fails for want of a token or an API, in CI too: with `HOTCODEPUSH_OFFLINE=1`, read in `utils/environment.ts`, or without a token, the API is asked nothing, the file carries `channelId: null` or the id it was given, one warning is printed and the exit is 0; an API that cannot be reached or refuses while a name is resolved ends the same way.
  `binary create` is the same on a laptop, warning and creating nothing, and loud in CI: without a token the build fails with `E_NOT_LOGGED_IN`, exit 3, its fix naming `HOTCODEPUSH_TOKEN`, and a failed resolution or a failed creation fails the build there, `E_BINARY_CONFLICT` under an unbumped build number being a pipeline mistake. `isCi()` decides that alone; whether a binary is created is the hook script's choice, by the build's own variables, never the CLI's.
  A build that bundled nothing — a React Native or Expo debug build, Metro serving its JavaScript — is neither: before any token is read, the file is written with `embeddedBundle: null` and the channel id only where the project named the channel by id, no binary is created, one line on stderr says so and the exit is 0; every check in that build answers `SKIPPED` with `BUILD_DEBUG`.
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
