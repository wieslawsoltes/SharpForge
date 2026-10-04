using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;

public static class Fixture
{
    public static async Task<int> Locals()
    {
        int first = 1;
        await Task.Yield();
        {
            int nested = first + 1;
            await Task.Yield();
            Console.WriteLine(nested);
        }
        await Task.Yield();
        return first;
    }
}

public static class Program
{
    private static readonly Guid HoistedScopes = new("6da9a61e-f8c7-4874-be62-68bc5630df71");
    private static readonly Guid AsyncSteps = new("54fd2ac5-e925-401a-9c2a-f94f171072f8");

    public static void Main()
    {
        string assembly = typeof(Program).Assembly.Location;
        using var pe = new PEReader(File.OpenRead(assembly));
        var metadata = pe.GetMetadataReader();
        using var provider = MetadataReaderProvider.FromPortablePdbStream(File.OpenRead(Path.ChangeExtension(assembly, ".pdb")));
        var pdb = provider.GetMetadataReader();
        foreach (var handle in pdb.MethodDebugInformation)
        {
            var debug = pdb.GetMethodDebugInformation(handle);
            var kickoff = debug.GetStateMachineKickoffMethod();
            if (kickoff.IsNil) continue;
            var moveNext = MetadataTokens.MethodDefinitionHandle(MetadataTokens.GetRowNumber(handle));
            var definition = metadata.GetMethodDefinition(moveNext);
            var type = metadata.GetTypeDefinition(definition.GetDeclaringType());
            var scopes = new List<object>();
            var awaits = new List<object>();
            foreach (var customHandle in pdb.GetCustomDebugInformation(moveNext))
            {
                var custom = pdb.GetCustomDebugInformation(customHandle);
                var kind = pdb.GetGuid(custom.Kind);
                var reader = pdb.GetBlobReader(custom.Value);
                if (kind == HoistedScopes)
                {
                    while (reader.RemainingBytes > 0)
                    {
                        uint start = reader.ReadUInt32();
                        scopes.Add(new { start, end = start + reader.ReadUInt32() });
                    }
                }
                else if (kind == AsyncSteps)
                {
                    reader.ReadUInt32();
                    while (reader.RemainingBytes > 0)
                    {
                        awaits.Add(new { yieldOffset = reader.ReadUInt32(), resumeOffset = reader.ReadUInt32(),
                            resumeMethod = 0x06000000 | reader.ReadCompressedInteger() });
                    }
                }
            }
            var fields = type.GetFields().Select(fieldHandle => {
                var field = metadata.GetFieldDefinition(fieldHandle);
                return new { fieldToken = MetadataTokens.GetToken(fieldHandle), fieldName = metadata.GetString(field.Name) };
            }).ToArray();
            Console.WriteLine(JsonSerializer.Serialize(new {
                runtime = Environment.Version.ToString(), moveNext = MetadataTokens.GetToken(moveNext),
                kickoff = MetadataTokens.GetToken(kickoff), typeToken = MetadataTokens.GetToken(definition.GetDeclaringType()),
                scopes, awaits, fields
            }));
        }
    }
}
