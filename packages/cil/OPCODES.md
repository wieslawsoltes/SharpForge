# Opcode metadata

`CilOpcodes[name]` remains the single immutable opcode registry used by the binary writer
and reader. Existing `name`, `value` and `operand` fields retain their meanings; decoded
instructions also keep their existing `operandKind` encoding strings.
`CilWriter.op` accepts only own opcode names from this registry. Unknown, inherited
object-property and non-string names produce CilError before any bytes or fixups
are written; caller objects are not coerced into names.

Additional fields expose standard metadata without implying executable-profile support:

| Field | Meaning |
| --- | --- |
| operandType | Reflection.Emit OperandType name, such as InlineMethod or ShortInlineI |
| tokenKind | method, field, type, string, sig, tok, or null for non-token operands |
| stackBehaviourPop | Reflection.Emit StackBehaviour name, such as Popref_popi or Varpop |
| stackBehaviourPush | Reflection.Emit StackBehaviour name, such as Pushi or Varpush |
| flowControl | Reflection.Emit FlowControl name, such as Call, Cond_Branch or Meta |
| opCodeType | Reflection.Emit OpCodeType name, such as Primitive, Objmodel or Prefix |
| size | Opcode encoding bytes, one or two, excluding the operand |

Variable effects (`Varpop`/`Varpush`) require method signatures and calling context;
they are not fixed stack counts. Prefix metadata does not validate ordering, targets,
alignment values or execution safety. Those belong to the verifier and instruction-group
work. Token kinds describe operand semantics, not token-table validation or resolution.

The catalog preserves all 219 existing encodings. CoreCLR's reserved internal prefix slots
stay unsupported, while the existing ECMA `no.` binary encoding remains available without
claiming CoreCLR Reflection.Emit or execution support. Aliases are not added. `ldc.i4.s`
keeps signed `i8` encoding; byte-valued prefixes keep `u8` despite sharing ShortInlineI.

One catalog now owns all names, values and effects; table construction moves out of
opcodes.js. The .NET 10.0.5 reference matches every field of all 218 active native
descriptors. All 219 supported encodings pass binary round trips, including `no.`.
The 8 reserved internal native prefix entries remain unsupported. Fixtures and
capture source are under `tests/fixtures/a03-opcodes`.
Broader browser/runtime/verifier qualification remains open.

Reference facts: [dotnet/runtime opcode.def, v10.0.5](https://github.com/dotnet/runtime/blob/v10.0.5/src/coreclr/inc/opcode.def)
and [ECMA-335 III](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf).
