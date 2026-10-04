# Typed numeric CIL verification

`verifyCilMethodTypes(bytesOrInspector, methodToken, options)` checks one ordinary
decoded MethodDef using the bounded block solver and registered numeric transfers.
The result contains `status`, `profile`, `methodToken`, `peakStack`, and owned
`diagnostics` with stable code, category, IL offset and message. Status is
`verified`, `rejected`, or `unknown`; the profile is `SharpForge.TypedCIL.Numeric/1`.

```js
import { AssemblyInspector, verifyCilMethodTypes } from '@sharpforge/cil';

const inspector = new AssemblyInspector(bytes);
const report = verifyCilMethodTypes(inspector, 0x06000001);
if (report.status !== 'verified') console.log(report.diagnostics);
```

The numeric policy covers constants, duplicate/pop, primitive argument/local loads,
stores and addresses, arithmetic, bitwise operations, shifts, comparisons,
conversions, finite checks, branches, switch and returns. Signed/unsigned small
storage types normalize to the existing stack kinds; address elements retain
canonical declared primitive identities. Local loads/addresses require InitLocals.
Generic/instance/vararg method signatures, nonprimitive storage, byref returns,
exception handlers and opcodes without a registered policy return `unknown`.
Byref element compatibility beyond identical primitive identities stays unknown.
The existing decoder checks every branch/switch target, including unreachable
code, before typed propagation. Floating input to `conv.r.un` follows the general conversion table III.8;
this does not claim the integer-focused instruction prose is unambiguous.

The existing `verifyCilAssembly` managed execution admission still verifies stack
heights. This separate typed API does not grant its runtime stack proof, execute
IL, or claim a complete CLR verifier. Integrating the remaining typed policies and
execution admission remains open under #52/#2401; full #2402 acceptance also needs
honest handling of the pinned oracle differences below.

The graph uses the existing O(instructions + edges) builder and bounded worklist.
Transfer handlers reuse one maxstack-sized array and canonical scalar values.
Only outgoing block states and merges copy stacks. `maxTypedStackSlots` limits
cumulative scratch/copy/merge work to 1,000,000 slots by default and at its hard
ceiling. It is a work bound, not a JavaScript heap measurement. Existing
`maxDataflowInstructions`, `maxDataflowEdges`, `maxDataflowSteps`, signature parser
limits and `signal` apply. Exhausted budgets/cancellation return `unknown` and
never a proof. Malformed metadata and incompatible stacks return `rejected`.

## Reference rules and oracle differences

The normative tables are [ECMA-335, sixth edition](https://www.ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf),
III.1.5 tables III.2–III.7, plus I.8.7.3 rule 4 and III.1.8.1.2.3.
The fixed corpus includes the complete five-by-five addition matrix, with object
operands, and separate arithmetic, conversion, shift, local and control-flow cases.

Pinned ILVerify 10.0.5 has known differences, identified before running the corpus:
mixed int64/native-int arithmetic; one operand ordering of int32/int64 comparison;
same-type object ordering; int32/native-int assignment and joins. The relevant
primary sources are [numeric import](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/tools/ILVerification/ILImporter.Verify.cs)
and [stack relations](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/tools/ILVerification/ILImporter.StackValue.cs).
Each difference is declared in the fixture and compared with retained native
observations. The product follows ECMA; a native disagreement is never relabelled
as reference parity. No product rule is weakened to reproduce an oracle defect.

Qualification commands and exact captures belong in
`tests/fixtures/verifier-numeric/README.md`. Broader source-VM/direct-CIL/native/Wasm
execution qualification remains staged: this API does not execute code.
