# CLAUDE.md

`hotcodepush`, the HotCodePush CLI: the npm package and the binary that set up, release and manage live updates from the terminal and CI.
The repo is public and MIT; this is the skeleton, and the commands arrive issue by issue on top of it.
Stack: TypeScript compiled by `tsc` into ESM in `dist/`, zodline and zod for the commands, `@hotcodepush/node` for the API, `@clack/prompts` for the prompts, `@napi-rs/keyring` for the token, ESLint, Prettier, Vitest, Node 24.

The plan is the private `handbook` repo, checked out beside this one: `../handbook/docs/`.
Its `cli.md` is the spec — every command, flag, file, error code and exit code — and `repositories.md` › _The CLI's structure_ the layout; both are binding, with `api.md` for the API the commands call.
When code and plan disagree, stop and surface it; never improvise.

## Layout

```
src/
  index.ts     the registry: space-separated command names, each a lazy import
  commands/    a folder per noun and a file per verb, channel/create.ts; the standalone commands flat, login.ts
  utils/       the runner, command resolution and did-you-mean, the E_ catalog and its one mapping,
               the global options, environment detection, config.json, the token store,
               the auth client, the API client, hotcodepush.json, a resource by id or name,
               the prompts and the confirmation, the pages of a list, the channel fields,
               the browser opener, the JSON, tables and details output
  config/      consts: the API URL, the client id and header, the config file, the docs and issues URLs,
               the keyring entry, package.json, the project file
  testing/     the command tests' harness, the API faked behind fetch, and their fixtures; never built
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

## Rules the code does not show

- **A command throws, the entry point exits.**
  A command never calls `process.exit`: it throws an error from `utils/errors.ts`, and `runCli` maps it to the message and the exit code once.
  A new code joins that catalog as a class with its code, exit code, message and fix, and gets its section at `hotcodepush.com/docs/cli/errors#<CODE>`.
- **An error is one line**: the code, what happened, what to do, the docs URL.
  The message is lowercase without a closing period; the fix is one lowercase sentence carrying its own punctuation; a stack trace only with `--verbose`.
- **API errors pass through verbatim**, their code, message and fix as received and never re-mapped; the CLI's catalog covers only what happens before or without the API.
- **Exit codes**: `0` done, `1` an error, `2` a missing or invalid parameter, `3` not logged in, `4` a confirmation required without `--yes`.
- **Parameters are the API's field names**, `--rollout-percentage`, `--bundle-version`: nothing is renamed between the console, the API and the terminal.
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
- **The token** is `readToken()`: `HOTCODEPUSH_TOKEN` when set, then the keyring, then the `config.json` fallback that any keyring failure latches for the rest of the process.
- **A login that cannot wait** keeps its device code, expiry, user code and verification URL in `config.json`; the next `login` redeems the code first and, while it is pending, shows the same code again, so an agent sees one output until the person approves.

## Naming

- A name says what the function does on first read: the verb, the object and, where it matters, the qualifier.
- Prefixes from the monorepo's vocabulary: `fetch` HTTP, `resolve` derivations without I/O, `build` functions that assemble a document without sending it; `read`, `write` and `delete` for the files and the keyring.
- Result variables carry the past participle of their operation, `loadedCommands`.
- Alphabetical ordering within a scope.
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
