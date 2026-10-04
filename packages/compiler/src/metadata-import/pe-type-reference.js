import { DiagnosticId } from '../diagnostics/codes.js';
import { ErrorTypeSymbol } from '../symbols/types.js';
import { Table, tokenOf, tableOf, ridOf } from './pe-metadata.js';
import { formatMetadataTypeName, unqualifiedMetadataTypeName } from './metadata-type-names.js';

function nestedReference(assembly, scope, metadataName) {
  const outer = assembly._typeRef(ridOf(scope));
  if (outer instanceof ErrorTypeSymbol) return assembly._missing(outer.metadataFullName ?? outer.name, outer.reason, metadataName);
  const match = /^(.*?)(?:`(\d+))?$/.exec(metadataName);
  const nested = outer.containingAssembly?._nested.get(outer)?.get(metadataName)
    ?? outer.getTypeMembers?.(match[1], Number(match[2] ?? 0))[0];
  const ownerName = outer.metadataFullName ?? outer.toDisplayString();
  return nested ?? assembly._missing(ownerName, { code: DiagnosticId.CS7069,
    args: [formatMetadataTypeName(ownerName + '+' + metadataName), outer.containingAssembly?.name ?? 'runtime profile'] }, metadataName);
}

/** Resolve one TypeRef row through explicit assembly bindings, forwarders and an optional runtime profile seam. */
export function resolveMetadataTypeReference(assembly, rid) {
  const metadata = assembly.metadata;
  const row = metadata.row(Table.TypeRef, rid);
  const metadataName = metadata.string(row[1]);
  const namespace = metadata.string(row[2]);
  const fullName = namespace ? namespace + '.' + metadataName : metadataName;
  const scope = row[0] ? tokenOf([Table.Module, Table.ModuleRef, Table.AssemblyRef, Table.TypeRef][row[0] & 3], row[0] >>> 2) : 0;
  if (tableOf(scope) === Table.TypeRef && scope) return nestedReference(assembly, scope, metadataName);
  if (tableOf(scope) === Table.AssemblyRef && scope) {
    const index = ridOf(scope) - 1;
    const target = assembly._bound[index];
    const identity = assembly.referencedAssemblyIdentities[index];
    if (!target) {
      return assembly.runtimeProfileResolver?.resolveType(fullName, identity)
        ?? assembly._missing(fullName, { code: DiagnosticId.CS0012, args: [unqualifiedMetadataTypeName(fullName), identity.getDisplayName()] });
    }
    const found = target._resolveTopLevel(fullName, []);
    return found ? found.type ?? assembly._missing(fullName, found.error)
      : assembly._missing(fullName, { code: DiagnosticId.CS7069, args: [formatMetadataTypeName(fullName), target.name] });
  }
  if (tableOf(scope) === Table.ModuleRef && scope) {
    return assembly._missing(fullName, { code: DiagnosticId.CS7069, args: [formatMetadataTypeName(fullName), assembly.name] });
  }
  const found = assembly._resolveTopLevel(fullName, []);
  return found ? found.type ?? assembly._missing(fullName, found.error)
    : assembly._missing(fullName, { code: DiagnosticId.CS7069, args: [formatMetadataTypeName(fullName), assembly.name] });
}
