# Code Assurance

Sustained confirmation of code quality and correctness.

Code review approves a change once, here and now. Code Assurance keeps
confidence in code over time:

- a person checks a piece of code and **confirms** that it is correct,
  taking responsibility for that confirmation;
- the confirmation is stored in the repository, tied to that exact code;
- when the code changes later, the confirmation becomes **outdated**;
- the changed code is confirmed again, by the same person or someone else.

The result is a continuous history of trust in the code, not a one-time
pull request approval.

## Getting started

1. Open a git repository and run **Code Assurance: Initialize in this
   repository**. It creates `.code-assurance/` and adds a merge rule to
   `.gitattributes`.
2. Select code, right-click and pick **Code Assurance → Confirm selected
   lines**, or put the cursor in a function and pick **Confirm enclosing
   function**. Add an optional comment.
3. Commit `.code-assurance/` together with your code. Teammates see your
   confirmations after they pull.

## Statuses

| Mark | Status    | Meaning                                                                                |
| ---- | --------- | -------------------------------------------------------------------------------------- |
| 🟩   | confirmed | The confirmed code is present and unchanged.                                           |
| 🟧   | outdated  | The code changed since it was confirmed (or moved away from its surroundings).         |
| 🟨   | ambiguous | The unchanged code now exists in several identical copies and none can be singled out. |

Statuses are computed from the code every time and are never stored or set
by hand.

### Positions follow the code

Each confirmation remembers the commit it was made on and, for code that
was not committed yet, a compact description of the uncommitted changes
(line fingerprints, never the code itself). From these the confirmed text
is rebuilt and compared with the current text using a line diff, so:

- adding or removing lines above or below confirmed code moves its marks
  with the code;
- an edited range is shown as outdated exactly where the code is now;
- identical copies of the code elsewhere do not confuse it.

When the commit is not available (a shallow clone, rewritten history) the
code is found by its content and surroundings instead.

## Commands

Right-click in an editor → **Code Assurance**, or the Command Palette:

| Command                              | Languages                                |
| ------------------------------------ | ---------------------------------------- |
| Confirm selected lines               | all files                                |
| Confirm enclosing function           | JavaScript, TypeScript, Python, Go, Rust |
| Confirm enclosing type               | JavaScript, TypeScript, Python, Go, Rust |
| Confirm enclosing impl block         | Rust                                     |
| Confirm enclosing module             | Rust                                     |
| Confirm whole file                   | all files                                |
| Confirm again                        | all files                                |
| Withdraw my confirmation             | all files                                |
| Confirmation actions at cursor…      | all files                                |
| Move confirmations of a renamed file | all files                                |

"Type" covers classes, interfaces, structs, enums and traits. Functions
include methods, constructors, function-valued variables
(`const f = () => …`), Python lambdas and Rust macros.

Hovering confirmed code shows who confirmed it, when, on which commit and
with which comment, with links to confirm again, resolve, see the diff since
confirmation and the history of the file. A CodeLens above each confirmed
span shows the same summary.

Confirming a span that fully encloses your earlier confirmations (or the
same symbol) replaces them; you are asked first when they had comments or
were outdated. Partly overlapping confirmations stand side by side.

## Side bar

The **Coverage** view works like the Search view: the filters are on top
and the files they let through are listed right below them.

- **Filter by path**: a regular expression matched against the
  repository-relative path. While a path or reviewer filter is set, folders
  open by themselves (up to 300 files).
- The toggle inside the input keeps only **files with confirmations**.
- The list below them chooses whose files the tree shows:
  - **All reviewers in one tree**: one tree of every file;
  - **A tree per reviewer**: a separate tree for every person with the
    files they have confirmations in;
  - **a single person**: only that person's files.

Below the filters: the share of code lines confirmed, the files with their
coverage rolled up through folders, and confirmations of files that no
longer exist. Filters
never change a percentage. Blank lines are not counted. The view title has
buttons to hide the marks in editors while you write code, refresh, clear
the filters and collapse all folders; **Code Assurance: Filter coverage**
moves the focus to the filter. The tree works with the keyboard: arrows,
Home/End, Enter.

Files can be left out of coverage with `.code-assurance/ignore`
(gitignore syntax: `*`, `**`, `?`, trailing `/`, leading `!`).

## Settings

| Setting                        | Values                             | Default      |
| ------------------------------ | ---------------------------------- | ------------ |
| `codeAssurance.marks.position` | `gutter` \| `text` \| `background` | `background` |

- `gutter`: a thin bar at the right edge of the gutter next to the line
  numbers, over the breakpoint column. A breakpoint dot on the same line
  stays visible.
- `text`: a bar at the start of each line inside the text area; the gutter
  stays free for breakpoints and other extensions.
- `background`: a faint tint behind each whole line. The colors are almost
  transparent, so selections, the current line highlight and search matches
  stay visible on top of it.

Colors (`workbench.colorCustomizations`): `codeAssurance.confirmed`,
`codeAssurance.outdated`, `codeAssurance.ambiguous` for the bars at the
start of lines and the overview ruler; `codeAssurance.confirmedBackground`,
`codeAssurance.outdatedBackground`, `codeAssurance.ambiguousBackground` for
the line background. The gutter bars use fixed colors.

## Storage

```
.code-assurance/
  config.json
  ignore
  records/<path of the source file>/<author id>.jsonl
```

Records are append-only JSON lines, one file per person and source file, so
branches merge without conflicts (`merge=union`). Nothing is ever rewritten
or deleted: withdrawing a confirmation appends a tombstone. Every record is
treated as untrusted input: a person can only replace or withdraw their own
confirmations, and record text is escaped wherever it is shown.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, tests,
continuous integration and releases.

## License

MIT
