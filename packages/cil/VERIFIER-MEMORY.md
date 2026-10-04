# Typed indirect memory transfers

`verifyCilMethodTypes` applies registered policies for every `ldind.*` and
`stind.*` opcode. Primitive arguments, locals and their managed addresses use
the same canonical signature nodes and storage slots as the numeric verifier.
No pointer-target registry or second flow solver is created. Each transfer does
constant work and allocates no verification value or collection.
Primitive-only methods retain `SharpForge.TypedCIL.Numeric/1`; this is an additive
registered policy under that existing profile. Metadata-dependent field methods
continue to use the separately documented field profile.

Loads preserve the intermediate stack type: small integers become I4, floating
values become F, and `ldind.ref` preserves the exact `object` or `string` target.
Signed/unsigned storage pairs, Boolean/byte and Char/short are recognized at their
storage width. A load accepts a readonly managed pointer; a store requires a
writable managed pointer and a value assignable to its target. Reference stores
accept null and string-to-object, and reject object-to-string. Integer/native
stack assignment follows the existing ECMA I.8.7.3 rule 4 policy.

The pointer's storage width is checked separately from its intermediate stack
kind. Cross-width accesses with assignable intermediate kinds return `unknown`
with `MemoryAccessShapeUnavailable`. The specification's indirect-access
consistency wording and general assignment rules do not by themselves establish
the address extent. ILVerify 10.0.5 also differs between its load and store rules.
This policy does not label all such cases invalid ECMA CIL or treat a native
acceptance as proof of a safe memory extent.

An unknown result does not qualify execution. Nominal/enum pointer targets,
prefixes, arrays, token-based memory instructions and byref-return lifetimes
remain pending under #2404. Methods with byref return signatures remain unknown,
including returns of local addresses. Definite assignment still requires a
local to be initialized before taking its address; an indirect write does not
invent an alias-to-local initialization fact. This API verifies method bodies;
it does not execute them or claim source-VM, native/Wasm execution support.

Normative references: [ECMA-335, sixth edition](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf),
I.8.7, III.1.8.1.2.3, III.3.42 and III.3.62. Native observations and any differences
are retained under `tests/fixtures/verifier-memory`; the serial qualification and its explicit policy differences are documented there.
