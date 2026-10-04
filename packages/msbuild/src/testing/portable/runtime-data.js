import {portableTestSources, managedLiteral} from './harness.js';
import {portableAssertionSource} from './assertion-profile.js';

function dataExpression(type, descriptor) {
  if (!/^[A-Za-z_][\w.]*$/.test(type.fqn)) throw new Error('Unsupported managed data-provider type');
  if (descriptor.kind === 'class') return `new ${type.fqn}()`;
  if (typeof descriptor.member !== 'string' || !/^[A-Za-z_]\w*$/.test(descriptor.member)) throw new Error('Invalid data-provider member');
  const member = type.dataProviders.get(descriptor.member);
  if (!member) throw new Error('Managed data-provider member was not found: ' + descriptor.member);
  if (!member.modifiers.includes('public') || !member.modifiers.includes('static')) {
    throw new Error('The portable data-provider profile requires a public static member');
  }
  const args = descriptor.arguments ?? [];
  if (args.length !== member.parameters.length) throw new Error('Data-provider argument count mismatch');
  const call = member.kind === 'method' ? '(' + args.map((value, index) => managedLiteral(value, member.parameters[index].type)).join(', ') + ')' : '';
  return type.fqn + '.' + descriptor.member + call;
}

/** Evaluate a computed data provider inside a fresh bounded managed session; no host reflection or arbitrary JavaScript executes. */
export async function evaluateManagedTestData(symbols, type, descriptor, options = {}) {
  const {backend = 'source', maxRows = 10_000, signal} = options;
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100_000) throw new Error('Invalid test data-row budget');
  const expression = dataExpression(type, descriptor);
  const source = `namespace SharpForge.Testing { public static class DataEntry {
    public static void Main() { }
    public static object[] Read() {
      var rows = new System.Collections.Generic.List<object>();
      foreach (object[] row in ${expression}) {
        if (rows.Count >= ${maxRows}) throw new System.Exception("Test data-row limit exceeded");
        rows.Add(row);
      }
      return rows.ToArray();
    }
  } }`;
  const compiler = options.compiler ?? await import('@sharpforge/compiler');
  const sources = [...portableTestSources(symbols, [], [type.fqn]), {uri: 'sharpforge://testing/assertions.cs', text: portableAssertionSource()},
    {uri: 'sharpforge://testing/data-provider.cs', text: source}];
  const compileOptions = {langVersion: '14', ...options.compileOptions,
    name: 'SharpForge.TestData', outputKind: 'exe', mainTypeName: 'SharpForge.Testing.DataEntry'};
  const compiled = backend === 'cil' ? compiler.compileToIL(sources, compileOptions) : compiler.compile(sources, compileOptions);
  if (!compiled.success) throw new Error('Managed data provider cannot compile: ' +
    compiled.diagnostics.filter(value => value.severity === 'error').map(value => value.message).join('; '));
  const Session = options.SessionType ?? (await import('@sharpforge/runtime')).ManagedInvocationSession;
  const session = new Session(backend === 'cil' ? compiled.assembly : compiled.image,
    {backend, entryPoint: 'SharpForge.Testing.DataEntry.Main', maxInstructions: options.maxDataInstructions ?? 500_000,
      maxOutputCharacters: options.maxOutputCharacters ?? 100_000});
  try {
    const result = await session.invoke('SharpForge.Testing.DataEntry.Read', {signal});
    if (result.fault) throw result.fault;
    return result.value;
  } finally { session.dispose(); }
}
