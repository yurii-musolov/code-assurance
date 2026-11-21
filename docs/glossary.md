# Glossary

**Confirmation** - a record of one person stating that a span of code (lines,
a symbol or a whole file) is correct, taking responsibility for it. Stored in
`.code-assurance/records`, never rewritten.

**Confirmed** - the confirmed code is present and unchanged; its current
position is known.

**Outdated** - the code changed after it was confirmed, or a run of lines
moved away from its surroundings. Needs to be confirmed again. Detected
automatically, never set by hand.

**Ambiguous** - the unchanged code exists in several identical copies and
nothing tells which one was confirmed. Cleared by **resolving**: the author
picks the copy they checked.

**Confirm again** - confirm the current code in place of an earlier
confirmation of the same person. The earlier one is **replaced**: it stays in
the history but no longer counts.

**Chain** - a confirmation and everything that replaced it.

**Withdraw** - take back one's own confirmation (its whole chain) by appending
a **tombstone**.

**Baseline** - the text a confirmation was made on, rebuilt as line
fingerprints from the record's commit and its uncommitted **delta**. Positions
are traced from the baseline to the current text with a line diff.

**Coverage** - the share of code lines (blank lines excluded) covered by
confirmed confirmations.
