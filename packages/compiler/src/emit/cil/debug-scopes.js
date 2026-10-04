import { TypeKind } from '../../symbols/types.js';
import { Writer, codedIndex } from '@sharpforge/cil';

const scopeStatements = new Set(['Block', 'For', 'ForEach', 'While', 'Do', 'Using', 'Fixed', 'Switch']);
const unobservedScopes = new Set(['SwitchExpressionArm', 'QueryExpression']);
const functionBoundaries = new Set(['LocalFunctionStatement', 'SimpleLambdaExpression', 'ParenthesizedLambdaExpression', 'AnonymousMethodExpression']);
const constantTypes = new Set(['bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'string']);

function constantRecord(local, tokens) {
  const constant = local.constantValueObject;
  if (!constant) return null;
  if (constant.isNull) {
    if (local.type.specialType === 'System_String') return { name: local.name, type: 'string', value: null };
    if (local.type.specialType === 'System_Object') return { name: local.name, type: 'object', value: null };
    const signature = new Writer().u8(0x12).compressed(codedIndex('TypeDefOrRef', tokens.type(local.type))).finish();
    return { name: local.name, signature };
  }
  if (constant.type === 'decimal') {
    const { mantissa, scale } = constant.value;
    const coefficient = mantissa < 0n ? -mantissa : mantissa;
    const signature = new Writer().u8(0x11).compressed(codedIndex('TypeDefOrRef', tokens.type(local.type)));
    signature.u8(scale | (mantissa < 0n ? 0x80 : 0));
    for (let shift = 0n; shift < 96n; shift += 32n) signature.u32(Number(BigInt.asUintN(32, coefficient >> shift)));
    return { name: local.name, signature: signature.finish() };
  }
  if (!constantTypes.has(constant.type)) return null;
  const record = { name: local.name, type: constant.type, value: constant.value };
  if (local.type.typeKind === TypeKind.Enum) record.enumType = tokens.type(local.type);
  return record;
}

/** Lexical scopes refer to stream markers or exception labels, never estimated source-to-IL proportions. */
export class CilDebugScopes {
  constructor(emitter) {
    this.emitter = emitter;
    this.root = { start: null, end: null, syntax: null, region: null };
    this.scopes = [this.root];
    this.bySyntax = new Map();
    this.locals = new Map();
    this.constants = new Map();
    this.hoisted = new Map();
  }
  begin(node, marker) {
    if (!scopeStatements.has(node.kind)) return null;
    const scope = { start: marker, end: null, syntax: node.syntax, region: null };
    this.scopes.push(scope);
    this.bySyntax.set(node.syntax, scope);
    return scope;
  }
  catchClause(clause, region) {
    const syntax = clause.block.syntax?.parent;
    if (!syntax) return;
    const scope = { start: null, end: null, syntax, region };
    this.scopes.push(scope);
    this.bySyntax.set(syntax, scope);
  }
  local(local, slot) {
    if (!local.isImplicitlyDeclared && !local.synthesizedKind && !local.name.startsWith('<')) this.locals.set(local, slot);
  }
  declarations(node) {
    for (const declaration of node.declarations ?? []) {
      if (!declaration.local?.isConst) continue;
      const local = declaration.local;
      // Any enum reference needed by a constant must be allocated while method metadata is still being collected.
      const constant = constantRecord(local, this.emitter.tokens);
      if (constant) this.constants.set(local, constant);
    }
  }
  markHoisted(fields) {
    let ordinal = this.emitter.frame.stateMachine.hoistedCount - fields.size;
    for (const slot of fields.keys()) this.hoisted.set(slot, ordinal++);
  }
  ownerOf(local) {
    let child = local.syntax;
    for (let syntax = child?.parent; syntax; child = syntax, syntax = syntax.parent) {
      // Variables in the governing expression remain visible after the switch statement.
      if (syntax.kind === 'SwitchStatement' && syntax.expression === child) continue;
      const scope = this.bySyntax.get(syntax);
      if (scope) return scope;
      if (unobservedScopes.has(syntax.kind)) return null;
      if (functionBoundaries.has(syntax.kind)) return this.root;
    }
    return this.root;
  }
  resolve(layout, length) {
    const resolved = new Map();
    const hoistedScopes = Array.from({ length: this.emitter.frame.stateMachine?.hoistedCount ?? 0 }, () => ({ start: 0, end: 0 }));
    for (const scope of this.scopes) {
      const start = scope === this.root ? 0 : layout.get(scope.region?.filterStart ?? scope.region?.handlerStart ?? scope.start);
      const end = scope === this.root ? length : layout.get(scope.region?.handlerEnd ?? scope.end);
      if (start !== undefined && end > start) resolved.set(scope, { start, end, locals: [], constants: [] });
    }
    for (const [local, slot] of this.locals) {
      const scope = resolved.get(this.ownerOf(local));
      if (!scope) continue;
      if (this.hoisted.has(slot)) hoistedScopes[this.hoisted.get(slot)] = { start: scope.start, end: scope.end };
      else scope.locals.push({ name: local.name, slot });
    }
    for (const [local, constant] of this.constants) resolved.get(this.ownerOf(local))?.constants.push(constant);
    return { scopes: [...resolved.values()], hoistedScopes };
  }
}
