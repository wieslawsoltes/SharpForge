import {canonicalType} from '@sharpforge/framework';
import {CilError} from '../binary.js';
import {codedIndex} from './indices.js';
import {parseSignatureType} from './signature-parser.js';
import {registeredNestedType} from './nested-signatures.js';

function referenceAssembly(builder, fullName) {
  if (fullName.startsWith('Microsoft.UI.') || fullName.startsWith('Windows.UI.')) return 'SharpForge.WinUI';
  if (fullName.startsWith('SharpForge.Runtime.')) return 'SharpForge.Runtime';
  if (builder.framework === 'mscorlib4') return 'mscorlib';
  if (fullName === 'System.Console') return 'System.Console';
  if (fullName === 'System.Diagnostics.Debug') return 'System.Diagnostics.Debug';
  return 'System.Runtime';
}

/** Intern ordinary and nested TypeRefs, using TypeSpecs for closed generic signatures. */
export function internTypeReference(builder, fullName, assembly) {
  const canonical = fullName.includes('<') ? fullName : canonicalType(fullName);
  if (canonical !== fullName) fullName = canonical;
  const generic = fullName.endsWith('>') && fullName.indexOf('<') > 0;
  if (generic || registeredNestedType(fullName)) {
    const key = 'typespec:' + (assembly ?? '') + ':' + fullName;
    if (builder.typeRefs.has(key)) return builder.typeRefs.get(key);
    const result = builder.typeSpec(parseSignatureType(fullName, name => builder.typeRef(name, assembly)));
    builder.typeRefs.set(key, result);
    return result;
  }
  assembly ??= referenceAssembly(builder, fullName);
  const key = assembly + ':' + fullName;
  if (builder.typeRefs.has(key)) return builder.typeRefs.get(key);
  const nesting = fullName.lastIndexOf('+');
  let scope;
  let name;
  let namespace;
  if (nesting >= 0) {
    const parts = fullName.split('+');
    if (parts.length > 65 || parts.some(part => !part)) throw new CilError('Invalid or excessive nested type name');
    scope = builder.typeRef(fullName.slice(0, nesting), assembly);
    if (scope >>> 24 !== 1) throw new CilError('Nested TypeRef requires an open enclosing TypeRef');
    name = fullName.slice(nesting + 1);
    namespace = '';
  } else {
    const split = fullName.lastIndexOf('.');
    scope = builder.assemblyRef(assembly);
    name = fullName.slice(split + 1);
    namespace = split < 0 ? '' : fullName.slice(0, split);
  }
  const result = builder.add(1, [codedIndex('ResolutionScope', scope), builder.string(name), builder.string(namespace)]);
  builder.typeRefs.set(key, result);
  return result;
}
