using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GenericInstantiationOracle;

internal static class Program
{
    private static void Main(string[] args)
    {
        if (args.Length != 1) throw new ArgumentException("Expected one absolute capture directory.");
        var directory = Path.GetFullPath(args[0]);
        var fixturePath = Path.Combine(directory, "Fixture.dll");
        if (!File.Exists(fixturePath)) throw new FileNotFoundException("Required Roslyn Fixture.dll is absent.", fixturePath);
        if (Environment.Version.ToString() != "10.0.5") throw new InvalidOperationException("CoreCLR 10.0.5 is required.");
        var images = new[]
        {
            MetadataImages.Consumer(directory, "consumerA", "GenericConsumerA"),
            MetadataImages.Consumer(directory, "consumerB", "GenericConsumerB"),
            MetadataImages.Malformed(directory),
            MetadataImages.Nested(directory),
            MetadataImages.Circular(directory)
        };
        var types = new TypeObservations();
        types.Register(typeof(Fixture.Box<>).Assembly, "fixture");
        var assemblies = new Dictionary<string, Assembly>(StringComparer.Ordinal);
        foreach (var image in images)
        {
            var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(directory, image.file));
            types.Register(assembly, image.id);
            assemblies.Add(image.id, assembly);
        }
        var cases = new CaseObservations(types);
        var definitions = CaseMatrix.DefinitionTokens(fixturePath);
        var matrix = new CaseMatrix(types, cases, typeof(Fixture.Box<>).Assembly, definitions);
        matrix.Definitions();
        matrix.Graphs();
        matrix.Elements();
        matrix.Consumers(images, assemblies);
        matrix.Scopes(images.Single(image => image.id == "consumerA"), assemblies["consumerA"]);
        matrix.FunctionPointers();
        matrix.Rejections();
        matrix.MetadataOnly(images, assemblies);
        var signatures = images.Select(image => new
        {
            image = image.id,
            rows = SignatureObservations.Read(Path.Combine(directory, image.file))
        }).ToArray();
        var lifetime = LifetimeObservations.Capture(types, fixturePath);
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            schemaVersion = 2,
            runtime = Environment.Version.ToString(),
            framework = RuntimeInformation.FrameworkDescription,
            architecture = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
            coreLibrary = typeof(object).Assembly.FullName,
            images,
            tokens = new
            {
                definitions,
                methods = new
                {
                    scope = typeof(Fixture.MethodOwner<>).GetMethod("M")!.MetadataToken,
                    shapes = typeof(Fixture.MethodOwner<>).GetMethod("Shapes")!.MetadataToken,
                    nestedFunction = typeof(Fixture.MethodOwner<>).GetMethod("Nested")!.MetadataToken
                }
            },
            cases = cases.Cases,
            identities = cases.Identities,
            signatures,
            lifetime
        }, new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull }));
    }
}
