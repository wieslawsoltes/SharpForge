using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;

public static class Fixture
{
    public static Func<Func<int>> Nested()
    {
        int captured = 42;
        return () => () => captured;
    }
}

public static class OtherFixture
{
    public static Func<Func<int>> Nested()
    {
        int other = 43;
        return () => () => other;
    }
}

public static class Program
{
    private static readonly Guid LambdaMap = new("a643004c-0240-496f-a783-30d64f4979de");

    public static void Main()
    {
        string assembly = typeof(Program).Assembly.Location;
        using var pe = new PEReader(File.OpenRead(assembly));
        var metadata = pe.GetMetadataReader();
        using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(Path.ChangeExtension(assembly, ".pdb")));
        var pdb = provider.GetMetadataReader();
        var maps = new List<object>();
        var types = new List<object>();
        foreach (var typeHandle in metadata.TypeDefinitions)
        {
            var type = metadata.GetTypeDefinition(typeHandle);
            string typeName = metadata.GetString(type.Name);
            foreach (var methodHandle in type.GetMethods())
            {
                var method = metadata.GetMethodDefinition(methodHandle);
                if (metadata.GetString(method.Name) != "Nested") continue;
                foreach (var customHandle in pdb.GetCustomDebugInformation(methodHandle))
                {
                    var custom = pdb.GetCustomDebugInformation(customHandle);
                    if (pdb.GetGuid(custom.Kind) != LambdaMap) continue;
                    var reader = pdb.GetBlobReader(custom.Value);
                    int methodOrdinal = reader.ReadCompressedInteger() - 1;
                    int baseline = -reader.ReadCompressedInteger();
                    int count = reader.ReadCompressedInteger();
                    var closures = new List<object>();
                    var lambdas = new List<object>();
                    for (int i = 0; i < count; i++) closures.Add(new { syntaxOffset = baseline + reader.ReadCompressedInteger() });
                    while (reader.RemainingBytes > 0) lambdas.Add(new {
                        syntaxOffset = baseline + reader.ReadCompressedInteger(), closureOrdinal = reader.ReadCompressedInteger() - 2 });
                    maps.Add(new { containingMethod = MetadataTokens.GetToken(methodHandle),
                        containingType = MetadataTokens.GetToken(typeHandle), typeName, methodOrdinal, closures, lambdas });
                }
            }
            if (!typeName.StartsWith("<>c__DisplayClass", StringComparison.Ordinal)) continue;
            var fields = new List<object>();
            var methods = new List<object>();
            foreach (var fieldHandle in type.GetFields()) fields.Add(new {
                fieldToken = MetadataTokens.GetToken(fieldHandle), name = metadata.GetString(metadata.GetFieldDefinition(fieldHandle).Name) });
            foreach (var methodHandle in type.GetMethods()) methods.Add(new {
                methodToken = MetadataTokens.GetToken(methodHandle), name = metadata.GetString(metadata.GetMethodDefinition(methodHandle).Name) });
            types.Add(new { typeToken = MetadataTokens.GetToken(typeHandle), name = typeName,
                enclosingType = MetadataTokens.GetToken(type.GetDeclaringType()), fields, methods });
        }
        Console.WriteLine(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), maps, types }));
    }
}
