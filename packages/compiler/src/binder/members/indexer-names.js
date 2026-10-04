/**
 * `[IndexerName("Name")]` (SF-A02-T10.2, C# spec 22.5.6.6): the metadata name of an indexer, `Item` unless the
 * attribute says otherwise. The name is what the accessors are called (`get_Name`, `set_Name`) and what other members
 * of the type may not be named; indexing itself never uses it.
 *
 *   CS0415  the attribute on a property that is not an indexer, or on an explicit interface implementation
 *   CS0633  the argument is not a valid identifier (a keyword is one; `@name`, the empty string and null are not)
 *   CS0668  the indexers of one type have different names
 *   CS0102  another member or a type parameter of the type has the name of its indexers
 *   CS0082  a method has the name and the parameter types of an accessor (`get_Item(int)` next to `this[int]`)
 *
 * An override has the name of the indexer it overrides, whatever attribute it carries. The names are assigned once
 * the attributes are bound, before any body is: a body that names an accessor (CS0571) sees the final names.
 */
import { DiagnosticId } from '../../diagnostics/codes.js';
import { SymbolKind, RefKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { attributesNamed } from '../bound-attributes.js';

const attributeName = 'System.Runtime.CompilerServices.IndexerNameAttribute';
const defaultName = 'Item';
const identifier = /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}\p{Cf}]*$/u;

const isProperty = member => member.kind === SymbolKind.Property;
const isIndexer = member => isProperty(member) && (member.isIndexer || member.syntax?.kind === 'IndexerDeclaration');
const isExplicit = member => !!member.explicitInterfaceSyntax;

/** The metadata name of an indexer: the one `[IndexerName]` gave it, the imported one, else `Item`. */
export function indexerNameOf(indexer) {
  const definition = indexer.originalDefinition ?? indexer,
    name = definition.indexerName ?? definition.metadataName;
  return !name || name === 'this[]' ? defaultName : name;
}

/** The name of a property as its accessors carry it: the indexer name for an indexer. */
export const accessorBaseName = property => (isIndexer(property) ? indexerNameOf(property) : property.name);

const constantOf = argument => {
  const value = argument?.constantValue;
  return value && typeof value === 'object' && 'value' in value ? value.value : undefined;
};

/** The name an `[IndexerName]` attribute gives, or a `{ code, at }` row when its argument is not an identifier. */
function nameFromAttribute(attribute) {
  const argument = attribute.arguments[0],
    value = constantOf(argument);
  if (typeof value === 'string' && identifier.test(value)) return { name: value };
  // An argument that did not bind has its own diagnostic.
  if (!attribute.attributeConstructor || argument?.hasErrors) return {};
  const written = attribute.syntax.argumentList?.arguments?.[0];
  return { code: DiagnosticId.CS0633, at: written?.expression ?? written ?? attribute.syntax.name, args: ['IndexerName'] };
}

const parameterKey = parameter => (parameter.refKind === RefKind.None ? '' : 'ref ') + (parameter.type?.toDisplayString() ?? '?');
const signatureOf = parameters => parameters.map(parameterKey).join(',');

/** CS0082 rows: ordinary methods of `type` that take the name and parameter types of an accessor of `property`. */
function reservedAccessorRows(type, property, methods) {
  const rows = [],
    base = accessorBaseName(property);
  for (const [prefix, accessor] of [['get_', property.getMethod], ['set_', property.setMethod]]) {
    if (!accessor) continue;
    const name = prefix + base,
      signature = signatureOf(accessor.parameters);
    if (!methods.some(method => method.name === name && signatureOf(method.parameters) === signature)) continue;
    const keyword = accessor.syntax?.keyword;
    rows.push({ member: property, code: DiagnosticId.CS0082, args: [type.toDisplayString(), name], at: keyword ?? undefined });
  }
  return rows;
}

/**
 * Names the indexers of a source type and checks the names. Base types must have been named before.
 * @returns {{member:object,code:string,args:any[],at?:object}[]} `at` overrides the location of `member`
 */
export function assignIndexerNames(type) {
  const rows = [],
    members = type.getMembers(),
    indexers = members.filter(isIndexer);
  for (const property of members.filter(isProperty)) {
    for (const attribute of attributesNamed(property, attributeName)) {
      if (!isIndexer(property) || isExplicit(property)) {
        rows.push({ member: property, code: DiagnosticId.CS0415, args: [], at: attribute.syntax.name });
        continue;
      }
      const result = nameFromAttribute(attribute);
      if (result.code) rows.push({ member: property, ...result });
      else if (result.name && !property.isOverride) property.indexerName = result.name;
    }
    if (isIndexer(property) && property.overriddenMember) property.indexerName = indexerNameOf(property.overriddenMember);
  }
  const taken = new Set(members.filter(member => !isIndexer(member) && !member.isAccessor).map(member => member.name));
  for (const nested of type.getTypeMembers?.() ?? []) taken.add(nested.name);
  for (const parameter of type.typeParameters ?? []) taken.add(parameter.name);
  let previous = null;
  for (const indexer of indexers) {
    if (isExplicit(indexer)) continue;
    const name = indexerNameOf(indexer);
    for (const [prefix, accessor] of [['get_', indexer.getMethod], ['set_', indexer.setMethod]]) if (accessor) accessor.name = prefix + name;
    if (previous !== null && previous !== name) rows.push({ member: indexer, code: DiagnosticId.CS0668, args: [] });
    previous = name;
    if (taken.has(name)) rows.push({ member: indexer, code: DiagnosticId.CS0102, args: [type.toDisplayString(), name] });
  }
  const methods = members.filter(member => member.kind === SymbolKind.Method && member.methodKind === MethodKind.Ordinary);
  if (methods.length) for (const property of members.filter(isProperty)) if (!isExplicit(property)) rows.push(...reservedAccessorRows(type, property, methods));
  return rows;
}

/** Class mixin (analysis phase): indexer names, assigned once the attributes are bound. */
export const IndexerNames = Base =>
  class extends Base {
    bindAttributes() {
      super.bindAttributes();
      const done = new Set();
      const visit = type => {
        const definition = type?.originalDefinition ?? type;
        if (!definition?.isSource || done.has(definition)) return;
        done.add(definition);
        visit(definition.baseType);
        for (const row of assignIndexerNames(definition)) {
          if (row.at) this.report(this.at(row.member).uri, row.at, row.code, row.args);
          else this.reportAt(row.member, row.code, row.args);
        }
      };
      for (const type of this.assembly.types) visit(type);
    }
  };
