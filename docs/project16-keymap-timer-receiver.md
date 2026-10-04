# Keymap timer receiver correction

Source review of the a5 correction family found that the editor resolver stored
bare global timer functions in a new clock object, then invoked them as methods
of that object. Browser timer methods with a native global receiver requirement
therefore received the resolver's clock object instead of their owning global.

This default is used by `NativeKeymapAdapter`, the legacy Visual Studio key
handler and all three `StudioKeyboard` resolver tables. Those production paths
provide no alternative clock; the native adapter does not expose a clock option.
The Options conflict calculator also uses the default, but does not schedule
chords. This is a concrete call-site defect, not an inferred failure from the
five failed a5 qualification outcomes.

The default now forwards through `globalThis.setTimeout` and
`globalThis.clearTimeout`. Explicitly injected clock objects retain both identity
and their original method receivers. Timer duration, chord precedence, command
dispatch, error handling and cancellation ownership are unchanged. There is no
new application dependency or public API.

`tests/a20-keymap-host-timers.test.js` contains seven focused regressions authored
against strict global-receiver timer fixtures: real native editor comment/undo,
Escape cancellation, binding replacement, disposal, incomplete-chord timeout,
deferred exact-command expiry and injected-clock ownership. The default-receiver
cases exercise the original receiver mismatch without relying on Node timers,
which accept receivers that browser-native timers can reject.

The tests have not been executed. Validation is held for the complete root
correction cohort. No browser, native keyboard, performance or a5 passing result
is claimed by this source correction; all original a5 outcomes remain intact.
