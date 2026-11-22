# Contributing to Code Assurance

Issues and pull requests are welcome at
https://github.com/yurii-musolov/code-assurance. Keep commits focused, with
a message that says what changed and why; `just check` must pass.

## Development setup

Requires Node.js 26 and npm 11 (`.nvmrc`; `nvm use` picks the version) and
[just](https://github.com/casey/just).

```sh
just install    # dependencies
just check      # format, lint, types, unit tests, bundle
just run        # VS Code window with the extension loaded
just package    # .vsix
just            # all recipes
```

`src/core` is plain Node with unit tests in `test/core`; `src/vscode`
contains the editor integration.
Formatting and linting use [Biome](https://biomejs.dev) (`biome.json`;
the `biomejs.biome` editor extension applies it on save), types are checked
by TypeScript 7.

`just test-int` runs the extension in a real VS Code window with a
throw-away repository and profile. Symbol commands for Python, Go and Rust
are checked with the language extensions installed in your VS Code
(`ms-python.python` with Pylance, `golang.go` with gopls,
`rust-lang.rust-analyzer` with cargo); they are linked into the test
profile, and a language whose extensions are missing is skipped.
`VSCODE_EXTENSIONS` points to another extensions folder, `VSCODE_BIN` to
another editor binary. With `REQUIRE_LANGUAGES=1` a skipped language
fails the run.

## Continuous integration and releases

GitHub Actions (`.github/workflows`):

- **CI** on every push to `main` and every pull request: format, lint,
  types, unit tests and the `.vsix` package (kept as a build artifact),
  `npm audit`, and the integration test in a downloaded VS Code under
  Xvfb with the Python, Go and Rust extensions installed, where every
  language is required.
- **Release** on a `v*` tag: checks the tag against `package.json`, runs
  the checks again, publishes to the Visual Studio Marketplace and attaches
  the `.vsix` to a GitHub release.

`main` accepts changes only through pull requests, so a release takes two
steps. Keep the notes for the next version under `[Unreleased]` in
`CHANGELOG.md` as you go, then:

```sh
just release minor   # or patch / major: branch release/vX.Y.Z with the new
                     # version and changelog section, pushed with a pull request
# merge the pull request on GitHub, then
just publish         # tags vX.Y.Z on main; the tag starts the Release workflow
```

Publishing uses Marketplace **Trusted Publishing** (OIDC), so no access
token is stored. The `yurii-musolov` publisher needs a Trusted Publishing
policy (marketplace.visualstudio.com/manage → publisher → Trusted
Publishing → Create) with the repository owner and name, the workflow
`release.yml` and the environment `marketplace`. For a private repository
the workflow has to run within 48 hours of creating the policy.
Dependabot proposes weekly updates of npm packages and actions; the VS Code
and Node.js type packages are raised by hand together with
`engines.vscode`.
