import { CilError } from '../binary.js';
import { TableId } from '../metadata/tables.js';
import { MethodAttributes, FieldAttributes } from '../metadata/rows-definitions.js';
import { codedIndex, token } from '../metadata/indices.js';
import { methodSignature } from '../metadata/signature-members.js';
import { encodeCustomAttribute } from '../metadata/custom-attributes.js';

const attributeName = 'System.Runtime.CompilerServices.ReferenceAssemblyAttribute';
const assemblyToken = token(TableId.Assembly, 1);

/**
 * Decide whether a Field or MethodDef belongs to a reference assembly. `flags` is the unsigned 16-bit metadata
 * value; context supplies struct storage, friend-assembly access and attribute-constructor retention. This performs
 * no symbol resolution. Invalid table/flags/context values throw CilError; work and storage are constant.
 */
export function referenceAssemblyMemberIncluded(table, flags, context = {}) {
  if (table !== TableId.Field && table !== TableId.MethodDef) throw new CilError('Reference member must be Field or MethodDef');
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffff) throw new CilError('Reference member flags must be unsigned 16-bit');
  if (!context || typeof context !== 'object') throw new CilError('Reference member context must be an object');
  for (const name of ['includesInternals', 'isStruct', 'isAttributeConstructor', 'isExplicitImplementation']) {
    if (context[name] !== undefined && typeof context[name] !== 'boolean') throw new CilError(`${name} must be boolean`);
  }
  if (table === TableId.Field && context.isStruct) return true;
  if (table === TableId.MethodDef
    && ((flags & MethodAttributes.Virtual) || context.isAttributeConstructor || context.isExplicitImplementation)) return true;
  const access = flags & FieldAttributes.FieldAccessMask;
  return access === FieldAttributes.Public || access === FieldAttributes.Family || access === FieldAttributes.FamORAssem
    || (!!context.includesInternals && (access === FieldAttributes.Assembly || access === FieldAttributes.FamANDAssem));
}

/**
 * Add the standard assembly marker through the supplied contract assembly (or the builder's framework default).
 * Repeated calls with the same constructor are idempotent. Callers emitting a source-defined marker retain that
 * attribute themselves. Requires one Assembly row; netmodules fail before mutation. Returns a CustomAttribute token.
 */
export function addReferenceAssemblyAttribute(builder, assembly) {
  if (builder?.rows?.[TableId.Assembly]?.length !== 1) throw new CilError('Reference assemblies require one Assembly definition');
  const owner = builder.typeRef(attributeName, assembly);
  const constructor = builder.member(owner, '.ctor', methodSignature('void', [], false));
  const parent = codedIndex('HasCustomAttribute', assemblyToken);
  const type = codedIndex('CustomAttributeType', constructor);
  const existing = (builder.rows[TableId.CustomAttribute] ?? []).findIndex(row => row[0] === parent && row[1] === type);
  if (existing >= 0) return token(TableId.CustomAttribute, existing + 1);
  return builder.addRow('CustomAttribute', { Parent: assemblyToken, Type: constructor, Value: encodeCustomAttribute([], []) });
}
