/**
 * Members of generic types by their instantiation (SF-A02-T30). A member of a generic type is never named by its
 * definition token (ECMA-335 II.9.4): code names it as a MemberRef on the TypeSpec of the instantiation. The emitter
 * writes the definition tokens of synthesized fields and methods - a cell's `Value`, a closure's constructor, the
 * fields of a state machine - and this pass replaces those that belong to a generic type, once per body, with the
 * reference that is right where the body runs.
 */
import { CilOpcodes } from '@sharpforge/cil';

const FIELD_TABLE = 0x04;
const METHOD_TABLE = 0x06;

/**
 * The synthesized fields and methods of an assembly by definition token.
 * @param writer the SymbolMetadataWriter, tokens allocated
 * @returns {Map<number, {member: object, type: object}>} `type` is the type definition that declares the member
 */
export function synthesizedMembersByToken(writer) {
  const index = new Map();
  for (const type of writer.types) {
    const plan = writer.plans.get(type);
    for (const member of [...plan.fields, ...plan.methods]) if (!member.symbol) index.set(member.token, { member, type });
  }
  return index;
}

/**
 * Rewrites the definition tokens of members of generic types in one instruction stream.
 * @param il the IlBuilder of a body  @param tokens the MemberTokens the body was emitted with (its substitution)
 * @param {Map<number, {member: object, type: object}>} index `synthesizedMembersByToken`
 */
export function nameThroughInstantiations(il, tokens, index) {
  for (const instruction of il.instructions) {
    const operand = instruction.operand;
    if (instruction.label || typeof operand !== 'number' || CilOpcodes[instruction.name]?.operand !== 'token') continue;
    const table = operand >>> 24;
    if (table !== FIELD_TABLE && table !== METHOD_TABLE) continue;
    const entry = index.get(operand);
    if (entry) instruction.operand = tokens.planned(entry.member, entry.type);
  }
}
