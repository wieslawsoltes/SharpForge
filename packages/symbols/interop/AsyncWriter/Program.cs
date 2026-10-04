using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;

public abstract class NoBody
{
    public abstract void Missing();
}

public static class AsyncFixture
{
    public static async Task<int> Result(int input)
    {
        int saved = input + 1;
        await Task.Yield();
        await Task.Delay(1);
        return saved;
    }

    public static async void Fire()
    {
        await Task.Yield();
    }

    public static IEnumerable<int> Iterator()
    {
        yield return 1;
        yield return 2;
    }
}

public static class Program
{
    private static readonly Guid AsyncSteps = new("54fd2ac5-e925-401a-9c2a-f94f171072f8");

    private static object? Steps(MetadataReader pdb, MethodDefinitionHandle method)
    {
        foreach (var handle in pdb.GetCustomDebugInformation(method))
        {
            var custom = pdb.GetCustomDebugInformation(handle);
            if (pdb.GetGuid(custom.Kind) != AsyncSteps) continue;
            var reader = pdb.GetBlobReader(custom.Value);
            int catchHandlerOffset = checked((int)reader.ReadUInt32() - 1);
            var awaits = new List<object>();
            while (reader.RemainingBytes > 0)
            {
                awaits.Add(new {
                    yieldOffset = reader.ReadUInt32(), resumeOffset = reader.ReadUInt32(),
                    resumeMethod = 0x06000000 | reader.ReadCompressedInteger()
                });
            }
            return new { catchHandlerOffset, awaits, bytes = Convert.ToHexString(pdb.GetBlobBytes(custom.Value)).ToLowerInvariant() };
        }
        return null;
    }

    public static void Main(string[] args)
    {
        string assembly = typeof(Program).Assembly.Location;
        using var pe = new PEReader(File.OpenRead(assembly));
        var metadata = pe.GetMetadataReader();
        using var provider = MetadataReaderProvider.FromPortablePdbStream(
            File.OpenRead(args.Length == 0 ? Path.ChangeExtension(assembly, ".pdb") : args[0]));
        var pdb = provider.GetMetadataReader();
        var records = new List<object>();
        foreach (var handle in pdb.MethodDebugInformation)
        {
            var debug = pdb.GetMethodDebugInformation(handle);
            var kickoff = debug.GetStateMachineKickoffMethod();
            if (kickoff.IsNil) continue;
            var moveNext = MetadataTokens.MethodDefinitionHandle(MetadataTokens.GetRowNumber(handle));
            records.Add(new {
                moveNext = MetadataTokens.GetToken(moveNext), kickoff = MetadataTokens.GetToken(kickoff),
                name = metadata.GetString(metadata.GetMethodDefinition(kickoff).Name), steps = Steps(pdb, moveNext)
            });
        }
        Console.WriteLine(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), records }));
    }
}
