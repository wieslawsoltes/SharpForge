using System;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;

public static class Fixture
{
    public static int Sum(int[] items)
    {
        int total = 0;
        foreach (int item in items) total += item;
        return total;
    }
    public static int Gone(int seed)
    {
        int eliminated = seed;
        return seed;
    }
}

internal static class Program
{
    static string TypeName(Type type) => type == typeof(int) ? "int" :
        type == typeof(int[]) ? "int[]" : throw new NotSupportedException(type.ToString());

    static void Main()
    {
        var path = typeof(Program).Assembly.Location;
        using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(Path.ChangeExtension(path, ".pdb")));
        var pdb = provider.GetMetadataReader();
        var methods = new[] { "Sum", "Gone" }.Select(name => {
            var method = typeof(Fixture).GetMethod(name)!;
            var handle = MetadataTokens.MethodDefinitionHandle(method.MetadataToken & 0xffffff);
            var declarations = pdb.GetLocalScopes(handle).SelectMany(scopeHandle => {
                var scope = pdb.GetLocalScope(scopeHandle);
                return scope.GetLocalVariables().Select(localHandle => {
                    var local = pdb.GetLocalVariable(localHandle);
                    return new { index = local.Index, id = MetadataTokens.GetRowNumber(localHandle),
                        scopeId = MetadataTokens.GetRowNumber(scopeHandle), start = scope.StartOffset, end = scope.EndOffset,
                        name = pdb.GetString(local.Name), attributes = (int)local.Attributes,
                        compilerGenerated = local.Attributes.HasFlag(LocalVariableAttributes.DebuggerHidden) };
                });
            }).ToArray();
            var slots = method.GetMethodBody()!.LocalVariables.Select(local => {
                var recorded = declarations.Where(value => value.index == local.LocalIndex).ToArray();
                return new { index = local.LocalIndex, typeName = TypeName(local.LocalType),
                    name = recorded.Length == 1 ? recorded[0].name : null, unnamed = recorded.Length == 0,
                    declarations = recorded.Select(value => new { value.id, value.scopeId, value.start, value.end,
                        value.name, value.attributes, value.compilerGenerated }).ToArray() };
            }).ToArray();
            return new { token = method.MetadataToken, name, slots };
        }).ToArray();
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new {
            runtime = Environment.Version.ToString(), result = Fixture.Sum([1, 2, 3]) + Fixture.Gone(4), methods
        }));
    }
}
