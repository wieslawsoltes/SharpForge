import {Builtins, syncIntrinsicDefinitions} from '@sharpforge/bytecode';
import {canonicalType, frameworkType} from '@sharpforge/framework';

const pathOf = node => node?.kind === 'Name' ? node.name : node?.kind === 'Member' && pathOf(node.target)
  ? pathOf(node.target) + '.' + node.name : null;
const aliases = Object.freeze({
  'System.Object': 'object', 'System.String': 'string', 'System.Boolean': 'bool', 'System.Char': 'char',
  'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort',
  'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong',
  'System.IntPtr': 'nint', 'System.UIntPtr': 'nuint', 'System.Single': 'float', 'System.Double': 'double',
  'System.Decimal': 'decimal', 'System.Void': 'void',
});
const primitives = new Set(['bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint',
  'long', 'ulong', 'nint', 'nuint', 'float', 'double', 'decimal', 'void']);
export const synchronizationType = type => type?.endsWith('&')
  ? synchronizationType(type.slice(0, -1)) + '&' : aliases[type] ?? canonicalType(type);
export const synchronizationBuiltin = descriptor => Builtins.find(builtin => builtin?.synchronization === descriptor);

export function containsLockAwait(node) {
  return node && typeof node === 'object' && (node.kind === 'Await' || Object.entries(node).some(([key, value]) =>
    !['source', 'tokens', 'symbol', 'green'].includes(key) &&
    (Array.isArray(value) ? value.some(containsLockAwait) : containsLockAwait(value))));
}

function argumentScore(compiler, argument, parameter, template, index) {
  if (parameter.endsWith('&')) {
    const reading = template.name === 'Read';
    if (argument?.kind !== 'RefArgument' || !(argument.modifier === 'ref' || reading && argument.modifier === 'in')) return null;
    return synchronizationType(compiler.infer(argument.expression)).replace(/&$/, '') === parameter.slice(0, -1) ? 0 : null;
  }
  if (argument?.kind === 'RefArgument') return null;
  const actual = synchronizationType(compiler.infer(argument));
  if (actual === parameter) return 0;
  // A matching reference fixes the overload. Normal assignment binding checks the remaining value arguments.
  if (index > 0 && template.parameters[0].endsWith('&')) return 1;
  if (parameter === 'object' && !compiler.synchronizationValueType(actual)) return 1;
  return compiler.frameworkConversion?.(parameter, actual) ? 1 : null;
}

/** Shared, side-effect-free overload queries for the bound and fused profiles. */
export const SynchronizationQueries = Base => class extends Base {
  synchronizationOwner(node) {
    if (node?.kind !== 'Member') return null;
    const name = pathOf(node.target);
    if (!/^(?:System\.Threading\.)?(?:Monitor|Interlocked|Volatile|Thread)$/.test(name ?? '')) return null;
    if (!node.boundSynchronization && (this.lookup(name.split('.')[0]) || this.c.typeMap.has(name))) return null;
    return name.startsWith('System.') ? name : 'System.Threading.' + name;
  }

  synchronizationValueType(type) {
    type = synchronizationType(type);
    const user = this.c.typeMap.get(type), framework = frameworkType(type);
    return primitives.has(type) || ['value', 'enum'].includes(framework?.kind) || !!user?.valueType ||
      ['Struct', 'Enum'].includes(user?.node?.kind);
  }

  synchronizationBinding(node, report = false) {
    if (node?.kind !== 'Call') return null;
    const owner = this.synchronizationOwner(node.target);
    if (!owner) return null;
    const templates = syncIntrinsicDefinitions.filter(item => item.owner === owner && item.name === node.target.name);
    if (!templates.length) return null;
    const explicit = node.target.typeArguments?.map(type => synchronizationType(this.c.resolveType(type, node)));
    const first = node.args[0];
    const inferred = first?.kind === 'RefArgument' ? synchronizationType(this.infer(first.expression)).replace(/&$/, '') : null;
    const candidates = [];
    for (const template of templates) {
      const generic = template.genericArity === 1;
      if (explicit && (!generic || explicit.length !== 1)) continue;
      const type = generic ? explicit?.[0] ?? inferred : null;
      if (generic && !type) continue;
      const parameters = template.parameters.map(parameter => synchronizationType(parameter.replaceAll('!!0', type ?? '!!0')));
      if (parameters.length !== node.args.length) continue;
      const scores = parameters.map((parameter, index) => argumentScore(this, node.args[index], parameter, template, index));
      if (scores.some(score => score === null)) continue;
      candidates.push({template, parameters, type, result: synchronizationType(template.returnType.replaceAll('!!0', type ?? '!!0')),
        score: scores.reduce((sum, score) => sum + score, generic ? 10 : 0)});
    }
    candidates.sort((left, right) => left.score - right.score);
    if (!candidates.length) {
      if (report) this.c.report(node, 'CS1501', [owner + '.' + node.target.name, node.args.length]);
      return {error: true};
    }
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
      if (report) this.c.report(node, 'CS0121', [owner + '.' + node.target.name, owner + '.' + node.target.name]);
      return {error: true};
    }
    const selected = candidates[0];
    if (selected.type && owner === 'System.Threading.Volatile' && this.synchronizationValueType(selected.type)) {
      if (report) this.c.report(node, 'CS0452', [node.target.name, 'T', selected.type]);
      return {error: true};
    }
    return selected;
  }

  infer(node) {
    if (node?.kind === 'RefArgument') return synchronizationType(this.infer(node.expression)).replace(/&$/, '') + '&';
    const binding = this.synchronizationBinding(node);
    if (binding) return binding.error ? 'error' : binding.result;
    if (node?.kind === 'Member' && this.synchronizationOwner(node) === 'System.Threading.Monitor' &&
        node.name === 'LockContentionCount') return 'long';
    return super.infer(node);
  }
};
