import { definition, wrapNamespace, joinPath } from '../common.js';
import { testClassSource, testPackages } from '../project/tests.js';

const bodies = {
  interface: name => `public interface ${name}\n{\n    void Execute();\n}`,
  record: name => `public record ${name}(int Id, string Name);`,
  struct: name => `public struct ${name}\n{\n    public int Value { get; set; }\n}`,
  enum: name => `public enum ${name}\n{\n    None = 0,\n    Active = 1,\n    Complete = 2\n}`,
  delegate: name => `public delegate void ${name}(object sender, System.EventArgs args);`,
  exception: name => `public class ${name} : System.Exception\n{\n    public ${name}() { }\n` +
    `    public ${name}(string message) : base(message) { }\n` +
    `    public ${name}(string message, System.Exception innerException) : base(message, innerException) { }\n}`,
  attribute: name => `[System.AttributeUsage(System.AttributeTargets.All, AllowMultiple = false, Inherited = true)]\n` +
    `public sealed class ${name} : System.Attribute\n{\n    public string Name { get; }\n` +
    `    public ${name}(string name)\n    {\n        Name = name;\n    }\n}`,
  'extension-methods': name => `public static class ${name}\n{\n    public static bool IsEven(this int value)\n    {\n        return value % 2 == 0;\n    }\n}`
};

const labels = {
  interface: ['Interface', 'IService.cs'], record: ['Record', 'Record1.cs'], struct: ['Struct', 'Struct1.cs'],
  enum: ['Enum', 'Status.cs'], delegate: ['Delegate', 'ChangedHandler.cs'], exception: ['Exception Class', 'CustomException.cs'],
  attribute: ['Attribute Class', 'CustomAttribute.cs'], 'extension-methods': ['Extension Methods', 'Extensions.cs']
};

export const coreCodeTemplates = Object.freeze([
  ...Object.entries(labels).map(([id, [name, fileName]]) => definition(id, name, 'C# ' + name.toLowerCase() + ' with namespace and nullable options.', 'Code', {
    fileName, kind: 'item', nativeOnly: true, targets: ['native-dotnet'], prerequisites: ['Native .NET SDK'], generate: generateCodeItem
  })),
  definition('top-level-program', 'Top-level Program', 'Executable top-level statements; the selected project must have a single entry point.', 'Code', {
    fileName: 'Program.cs', kind: 'item', nativeOnly: true, targets: ['native-dotnet'], prerequisites: ['Native .NET SDK'], generate: generateCodeItem
  }),
  ...Object.keys(testPackages).map(framework => definition(framework + '-test-class', framework + ' Test Class',
    'A passing native test class with the required package references.', 'Tests', {
      fileName: 'UnitTest1.cs', kind: 'item', nativeOnly: true, targets: ['native-dotnet'],
      prerequisites: ['Native .NET SDK and test framework packages'], generate: generateCodeItem
    }))
]);

export function generateCodeItem(template, options) {
  let text;
  let packages;
  if (template.id.endsWith('-test-class')) {
    const framework = template.id.replace('-test-class', '');
    text = testClassSource(framework, options.identifier, options.namespace, options);
    packages = testPackages[framework];
  } else if (template.id === 'top-level-program') {
    text = (options.implicitUsings ? '' : 'using System;\n\n') + 'Console.WriteLine("Hello, World!");\n';
  } else text = wrapNamespace(options.namespace, bodies[template.id](options.identifier), '', options);
  return { records: [{ path: joinPath(options.folder, options.name), text }], packageReferences: packages, warnings: [] };
}
