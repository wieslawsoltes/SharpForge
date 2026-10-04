using System;

namespace Outer
{
    using System.Text;
    using Alias = System.Text.StringBuilder;
    namespace Inner
    {
        using static System.Math;
        public static class Fixture
        {
            public static int Value()
            {
                var builder = new Alias();
                return Abs(builder.Length - 7);
            }
        }
    }
}

internal static class Program
{
    static void Main()
    {
        var path = typeof(Program).Assembly.Location;
        using var pe = new System.Reflection.PortableExecutable.PEReader(System.IO.File.OpenRead(path));
        var metadata = System.Reflection.Metadata.PEReaderExtensions.GetMetadataReader(pe);
        using var provider = System.Reflection.Metadata.MetadataReaderProvider.FromPortablePdbStream(
            System.IO.File.OpenRead(System.IO.Path.ChangeExtension(path, ".pdb")));
        var pdb = provider.GetMetadataReader();
        var method = typeof(Outer.Inner.Fixture).GetMethod("Value")!.MetadataToken;
        var handle = System.Reflection.Metadata.Ecma335.MetadataTokens.MethodDefinitionHandle(method & 0xffffff);
        var chain = new System.Collections.Generic.List<System.Reflection.Metadata.ImportScopeHandle>();
        foreach (var scopeHandle in pdb.GetLocalScopes(handle))
        {
            var scope = pdb.GetLocalScope(scopeHandle);
            for (var import = scope.ImportScope; !import.IsNil; import = pdb.GetImportScope(import).Parent) chain.Add(import);
            break;
        }
        chain.Reverse();
        var entries = new System.Collections.Generic.List<object>();
        foreach (var scopeHandle in chain)
        foreach (var import in pdb.GetImportScope(scopeHandle).GetImports())
        {
            var kind = (int)import.Kind;
            string? typeName = null;
            if (kind is 3 or 9)
            {
                var type = metadata.GetTypeReference((System.Reflection.Metadata.TypeReferenceHandle)import.TargetType);
                typeName = metadata.GetString(type.Namespace) + "." + metadata.GetString(type.Name);
            }
            entries.Add(new {
                kind, scopeId = System.Reflection.Metadata.Ecma335.MetadataTokens.GetRowNumber(scopeHandle),
                alias = kind == 9 ? System.Text.Encoding.UTF8.GetString(pdb.GetBlobBytes(import.Alias)) : null,
                @namespace = kind == 1 ? System.Text.Encoding.UTF8.GetString(pdb.GetBlobBytes(import.TargetNamespace)) : null,
                type = kind is 3 or 9 ? System.Reflection.Metadata.Ecma335.MetadataTokens.GetToken(import.TargetType) : (int?)null,
                typeName
            });
        }
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new {
            runtime = Environment.Version.ToString(), method,
            importScope = System.Reflection.Metadata.Ecma335.MetadataTokens.GetRowNumber(chain[^1]),
            entries, result = Outer.Inner.Fixture.Value()
        }));
    }
}
