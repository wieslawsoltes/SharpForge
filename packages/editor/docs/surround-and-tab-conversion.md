# Surround With and tab conversion

The SF-A20-T25 (#1494) and SF-A20-T41 (#1510) acceptance follow-up preserves
document line endings through the production snippet picker and advanced edit
commands. It was implemented together before the integration owner's focused
validation slot.

## Surround With

`SnippetSession.picker(true)` now passes the selected model range to snippet
preparation. It no longer joins selected lines with LF and four spaces, and
preparation no longer reads `editor.value` to inspect the whole document.

New wrapper lines use `editor.options.endOfLine`, falling back to the model's
preferred EOL. The selected body's CRLF, CR, LF, and mixed terminators remain
unchanged. Its common indentation is measured in the existing text package's
visual columns, including tabs, and its relative indentation is retained.
Continuation lines use the indentation of their actual selected-text placeholder.
Consequently, a region adds no block indentation, while `if`, `using`, and `try`
use the indentation level declared by their templates.

Built-in catalog records include `indentSize: 4`, describing their template
indentation units. The picker and double-Tab expansion adapt those units to the
editor's `indentSize` and `insertSpaces` settings. Custom catalog records may
declare the same metadata; omitted metadata preserves literal template
indentation. Direct `SnippetSession.insert(template, options)` can request this
adaptation with `templateIndentSize`, and can request surrounding behavior with
`surround: true`. Existing direct insertion keeps literal template indentation.

The public `indentSnippet(template, indentation, lineEnding)` contract remains
unchanged and now recognizes standalone CR as well as LF and CRLF.
`expandSnippet(template, variables, {formatVariable})` adds an optional formatting
seam: the callback receives `{name, value, prefix}`, where `value` is a string and
`prefix` is the text already emitted before this occurrence. It must return a
string; another return type throws `TypeError`. It runs before placeholder
ranges are recorded, so formatted variable lengths retain correct UTF-16 stops.
Undefined variables retain their existing fallback behavior. Expansion without
the third argument is unchanged.

## Tabify and Untabify

Both exported transforms process logical lines independently and copy every
original line terminator verbatim. `untabify(text, tabSize)` delegates to the
shared `expandTabs` text API, resetting visual columns after CR, LF, or CRLF.
`tabify(text, tabSize)` measures leading spaces and tabs with the same visual
column API before emitting full tabs and a final partial space indent. It leaves
non-indentation text untouched. Advanced commands still commit all selected
ranges in one model transaction, and read-only behavior is unchanged.

## Focused regression scope

New fixtures are `tests/a20-surround-indentation.test.js` and
`tests/a20-tab-conversion-endings.test.js`. They cover the actual picker callback,
regions and block wrappers, two-space and tab settings, selected indentation
inside and outside the range, CRLF/CR/LF/mixed bodies, literal snippet-looking
selection text, per-placeholder context, undo, read-only rejection, Unicode tab
columns, and disjoint selections. The variable-formatting public seam has direct
positive and invalid-output assertions.

These fixtures have been authored but not run in this worktree. The integration
owner will execute them together with the existing snippet, shortcut, and
advanced-editing fixtures once both fixes are assembled. Browser and Visual
Studio oracle qualification are not claimed by these Node fixtures.
