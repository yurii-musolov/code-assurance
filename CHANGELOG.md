# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

### Added

- Confirm selected lines, the enclosing function or type (JavaScript,
  TypeScript, Python, Go, Rust), the enclosing impl block or module (Rust)
  or a whole file, with an optional comment.
- Confirmed, outdated and ambiguous statuses computed from the code.
- Positions traced through a line diff from the confirmed text, so marks
  follow code when lines are added or removed around it, including across
  commits and for code confirmed before it was committed.
- Vertical status bars in the gutter or at the start of each line
  (`codeAssurance.marks.position`), with theme colors.
- Hover, CodeLens and an actions menu: confirm again, resolve, withdraw,
  diff since confirmation, history, commit on the web.
- Coverage view with reviewers, confirmations of missing files and filters;
  `.code-assurance/ignore`.
- Append-only, per-person record store that merges without conflicts.
