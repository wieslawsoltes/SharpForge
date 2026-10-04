using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;

internal sealed record FixtureFile(string Name, string? AssemblyName, byte[] Bytes);
internal sealed record FixtureInfo(string? FileName, string? ReferencedAssembly, int ResourceLocation);
internal sealed record FixtureCase(string Id, string AssemblyName, string Resource, string Classification, byte[]? ExpectedBytes)
{
    public FixtureInfo? ExpectedInfo { get; init; }
}
internal sealed record FixtureCorpus(List<FixtureFile> Files, List<FixtureCase> Cases);

internal static class Images
{
    private static readonly byte[] Binary = { 0, 127, 128, 255 };
    private static readonly byte[] First = { 17 };
    private static readonly Version Version = new(1, 0, 0, 0);

    private sealed record ResourceSpec(string Name, byte[]? Data = null)
    {
        public ManifestResourceAttributes Attributes { get; init; } = ManifestResourceAttributes.Public;
        public string? Reference { get; init; }
        public string? File { get; init; }
        public uint Offset { get; init; }
    }

    private sealed record FileSpec(FixtureFile Image, bool ContainsMetadata);
    private sealed record ImageSpec(string Name)
    {
        public bool IsModule { get; init; }
        public bool ManagedEntryPoint { get; init; }
        public bool EntryPointInFirstFile { get; init; }
        public int HashAlgorithm { get; init; } = 0x800c;
        public IReadOnlyList<ResourceSpec> Resources { get; init; } = Array.Empty<ResourceSpec>();
        public IReadOnlyList<FileSpec> Files { get; init; } = Array.Empty<FileSpec>();
        public string FileName => Name + (IsModule ? ".netmodule" : EntryPointInFirstFile ? ".exe" : ".dll");
    }

    public static FixtureCorpus Create()
    {
        var corpus = new FixtureCorpus(new List<FixtureFile>(), new List<FixtureCase>());
        AddEmbedded(corpus);
        AddForwarded(corpus);
        AddLinkedFiles(corpus);
        AddForwardedLinkedFile(corpus);
        AddLinkedModules(corpus);
        AddEntryPointModule(corpus);
        AddMalformedEmbedded(corpus);
        return corpus;
    }

    private static void AddEmbedded(FixtureCorpus corpus)
    {
        var unicode = Encoding.UTF8.GetBytes("Zażółć\0😃");
        var image = Build(new ImageSpec("ManifestEmbedded") { Resources = new[] {
            new ResourceSpec("payload", Binary),
            new ResourceSpec("private/空", unicode) { Attributes = ManifestResourceAttributes.Private },
            new ResourceSpec("empty", Array.Empty<byte>()),
        } });
        corpus.Files.Add(image);
        var info = new FixtureInfo(null, null, 5);
        corpus.Cases.Add(new("embedded-binary", image.AssemblyName!, "payload", "embedded", Binary) { ExpectedInfo = info });
        corpus.Cases.Add(new("embedded-private-unicode", image.AssemblyName!, "private/空", "embedded", unicode) { ExpectedInfo = info });
        corpus.Cases.Add(new("embedded-empty", image.AssemblyName!, "empty", "embedded", Array.Empty<byte>()) { ExpectedInfo = info });
        corpus.Cases.Add(new("embedded-absent", image.AssemblyName!, "absent", "embedded", null));
    }

    private static void AddForwarded(FixtureCorpus corpus)
    {
        var target = Build(new ImageSpec("ManifestTarget") { Resources = new[] { new ResourceSpec("payload", Binary) } });
        var bridge = Build(new ImageSpec("ManifestBridge") { Resources = new[] {
            new ResourceSpec("payload") { Reference = target.AssemblyName },
            new ResourceSpec("missing") { Reference = target.AssemblyName },
        } });
        var facade = Build(new ImageSpec("ManifestFacade") { Resources = new[] {
            new ResourceSpec("payload") { Reference = bridge.AssemblyName },
            new ResourceSpec("missing") { Reference = bridge.AssemblyName },
        } });
        corpus.Files.AddRange(new[] { target, bridge, facade });
        corpus.Cases.Add(new("forwarded-two-hop", facade.AssemblyName!, "payload", "forwarded", Binary) {
            ExpectedInfo = new FixtureInfo(null, target.AssemblyName, 7),
        });
        corpus.Cases.Add(new("forwarded-missing", facade.AssemblyName!, "missing", "forwarded", null));
    }

    private static void AddMalformedEmbedded(FixtureCorpus corpus)
    {
        var image = Build(new ImageSpec("ManifestMalformedEmbedded") {
            Resources = new[] { new ResourceSpec("payload", Binary) },
        });
        using var reader = new PEReader(new MemoryStream(image.Bytes, writable: false));
        var directory = reader.PEHeaders.CorHeader!.ResourcesDirectory;
        if (!reader.PEHeaders.TryGetDirectoryOffset(directory, out var offset))
            throw new InvalidOperationException("The authored image must have a CLI resource directory");
        BinaryPrimitives.WriteUInt32LittleEndian(image.Bytes.AsSpan(offset, 4), uint.MaxValue);
        corpus.Files.Add(image);
        corpus.Cases.Add(new("malformed-embedded-length", image.AssemblyName!, "payload", "malformed-embedded", null));
    }

    private static void AddLinkedFiles(FixtureCorpus corpus)
    {
        var algorithms = new[] { ("None", 0), ("MD5", 0x8003), ("SHA1", 0x8004),
            ("SHA256", 0x800c), ("SHA384", 0x800d), ("SHA512", 0x800e) };
        var lengths = new[] { 0, 55, 56, 57, 63, 64 };
        for (var index = 0; index < algorithms.Length; index++)
        {
            var (label, algorithm) = algorithms[index];
            var bytes = Enumerable.Range(0, lengths[index]).Select(value => (byte)(value * 17 + index)).ToArray();
            var file = new FixtureFile($"hash-{label.ToLowerInvariant()}.bin", null, bytes);
            var owner = Build(new ImageSpec("ManifestLinked" + label) {
                HashAlgorithm = algorithm,
                Files = new[] { new FileSpec(file, false) },
                Resources = new[] { new ResourceSpec("payload") { File = file.Name } },
            });
            corpus.Files.AddRange(new[] { file, owner });
            corpus.Cases.Add(new("linked-file-" + label.ToLowerInvariant(), owner.AssemblyName!, "payload", "linked-file", bytes) {
                ExpectedInfo = new FixtureInfo(file.Name, null, 0),
            });
        }
    }

    private static void AddLinkedModules(FixtureCorpus corpus)
    {
        var module = Build(new ImageSpec("ManifestChild") {
            IsModule = true,
            Resources = new[] { new ResourceSpec("first", First), new ResourceSpec("payload", Binary) },
        });
        corpus.Files.Add(module);
        var matching = LinkedModuleOwner("ManifestModuleMatch", module, "payload", 8);
        var different = LinkedModuleOwner("ManifestModuleDifference", module, "payload", 0);
        var alias = LinkedModuleOwner("ManifestModuleAlias", module, "parent-only", 8);
        corpus.Files.AddRange(new[] { matching, different, alias });
        var info = new FixtureInfo(module.Name, null, 1);
        corpus.Cases.Add(new("module-matching-offset", matching.AssemblyName!, "payload", "linked-module", Binary) { ExpectedInfo = info });
        corpus.Cases.Add(new("module-offset-disagreement", different.AssemblyName!, "payload", "module-offset-difference", First) {
            ExpectedInfo = info,
        });
        corpus.Cases.Add(new("module-parent-only-name", alias.AssemblyName!, "parent-only", "module-parent-name", Binary) {
            ExpectedInfo = info,
        });
    }

    private static void AddForwardedLinkedFile(FixtureCorpus corpus)
    {
        var file = corpus.Files.Single(image => image.Name == "hash-sha256.bin");
        var owner = corpus.Files.Single(image => image.AssemblyName == "ManifestLinkedSHA256");
        var facade = Build(new ImageSpec("ManifestLinkedFacade") { Resources = new[] {
            new ResourceSpec("payload") { Reference = owner.AssemblyName },
        } });
        corpus.Files.Add(facade);
        corpus.Cases.Add(new("forwarded-linked-file", facade.AssemblyName!, "payload", "forwarded-linked-file", file.Bytes) {
            ExpectedInfo = new FixtureInfo(file.Name, owner.AssemblyName, 2),
        });
    }

    private static FixtureFile LinkedModuleOwner(string name, FixtureFile module, string resourceName, uint offset)
    {
        return Build(new ImageSpec(name) {
            Files = new[] { new FileSpec(module, true) },
            Resources = new[] { new ResourceSpec(resourceName) { File = module.Name, Offset = offset } },
        });
    }

    private static void AddEntryPointModule(FixtureCorpus corpus)
    {
        var module = Build(new ImageSpec("ManifestEntryChild") {
            IsModule = true, ManagedEntryPoint = true,
            Resources = new[] { new ResourceSpec("payload", Binary) },
        });
        var owner = Build(new ImageSpec("ManifestEntryOwner") {
            EntryPointInFirstFile = true,
            Files = new[] { new FileSpec(module, true) },
            Resources = new[] { new ResourceSpec("payload") { File = module.Name } },
        });
        corpus.Files.AddRange(new[] { module, owner });
        corpus.Cases.Add(new("module-managed-entry-point", owner.AssemblyName!, "payload", "module-entry-point", Binary) {
            ExpectedInfo = new FixtureInfo(module.Name, null, 1),
        });
    }

    private static FixtureFile Build(ImageSpec spec)
    {
        var metadata = new MetadataBuilder();
        var id = BlobContentId.FromHash(SHA256.HashData(Encoding.UTF8.GetBytes(spec.Name)));
        metadata.AddModule(0, metadata.GetOrAddString(spec.FileName), metadata.GetOrAddGuid(id.Guid), default, default);
        if (!spec.IsModule)
        {
            metadata.AddAssembly(metadata.GetOrAddString(spec.Name), Version, default, default, default,
                (AssemblyHashAlgorithm)spec.HashAlgorithm);
        }
        metadata.AddTypeDefinition(TypeAttributes.NotPublic, default, metadata.GetOrAddString("<Module>"), default,
            MetadataTokens.FieldDefinitionHandle(1), MetadataTokens.MethodDefinitionHandle(1));
        var files = AddFiles(metadata, spec);
        var references = AddReferences(metadata, spec.Resources);
        var resources = AddResources(metadata, spec.Resources, files, references);
        var il = new BlobBuilder();
        var entryPoint = spec.ManagedEntryPoint ? AddEntryPoint(metadata, il) : default;
        var characteristics = Characteristics.ExecutableImage;
        if (!spec.EntryPointInFirstFile) characteristics |= Characteristics.Dll;
        var builder = new ManagedPEBuilder(new PEHeaderBuilder(imageCharacteristics: characteristics),
            new MetadataRootBuilder(metadata), il, managedResources: resources, strongNameSignatureSize: 0,
            entryPoint: entryPoint, flags: CorFlags.ILOnly, deterministicIdProvider: _ => id);
        var serialized = new BlobBuilder();
        builder.Serialize(serialized);
        var bytes = serialized.ToArray();
        if (spec.EntryPointInFirstFile) SetFileEntryPoint(bytes, files.Values.First());
        return new FixtureFile(spec.FileName, spec.IsModule ? null : spec.Name, bytes);
    }

    private static Dictionary<string, AssemblyFileHandle> AddFiles(MetadataBuilder metadata, ImageSpec spec)
    {
        var result = new Dictionary<string, AssemblyFileHandle>(StringComparer.Ordinal);
        foreach (var file in spec.Files)
        {
            var hash = Hash(spec.HashAlgorithm, file.Image.Bytes);
            var handle = metadata.AddAssemblyFile(metadata.GetOrAddString(file.Image.Name), metadata.GetOrAddBlob(hash), file.ContainsMetadata);
            result.Add(file.Image.Name, handle);
        }
        return result;
    }

    private static Dictionary<string, AssemblyReferenceHandle> AddReferences(MetadataBuilder metadata, IReadOnlyList<ResourceSpec> resources)
    {
        var result = new Dictionary<string, AssemblyReferenceHandle>(StringComparer.Ordinal);
        foreach (var resource in resources)
        {
            if (resource.Reference is not string name || result.ContainsKey(name)) continue;
            result.Add(name, metadata.AddAssemblyReference(metadata.GetOrAddString(name), Version, default, default, default, default));
        }
        return result;
    }

    private static BlobBuilder AddResources(MetadataBuilder metadata, IReadOnlyList<ResourceSpec> resources,
        Dictionary<string, AssemblyFileHandle> files, Dictionary<string, AssemblyReferenceHandle> references)
    {
        var data = new BlobBuilder();
        foreach (var resource in resources)
        {
            EntityHandle implementation = default;
            var offset = resource.Offset;
            if (resource.File is string file) implementation = files[file];
            else if (resource.Reference is string reference) implementation = references[reference];
            else
            {
                var bytes = resource.Data ?? throw new InvalidOperationException("An embedded fixture needs explicit bytes");
                while ((data.Count & 7) != 0) data.WriteByte(0);
                offset = (uint)data.Count;
                data.WriteUInt32((uint)bytes.Length);
                data.WriteBytes(bytes);
            }
            metadata.AddManifestResource(resource.Attributes, metadata.GetOrAddString(resource.Name), implementation, offset);
        }
        return data;
    }

    private static MethodDefinitionHandle AddEntryPoint(MetadataBuilder metadata, BlobBuilder il)
    {
        // Tiny IL body: one-byte ret. It is present for metadata validity and is never invoked by this oracle.
        il.WriteByte(0x06);
        il.WriteByte(0x2a);
        return metadata.AddMethodDefinition(MethodAttributes.Public | MethodAttributes.Static | MethodAttributes.HideBySig,
            MethodImplAttributes.IL, metadata.GetOrAddString("Main"), metadata.GetOrAddBlob(new byte[] { 0, 0, 1 }),
            0, MetadataTokens.ParameterHandle(1));
    }

    private static void SetFileEntryPoint(byte[] bytes, AssemblyFileHandle file)
    {
        // ManagedPEBuilder's typed entryPoint argument only accepts MethodDef; CLI also permits a File token here.
        using var reader = new PEReader(new MemoryStream(bytes, writable: false));
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(reader.PEHeaders.CorHeaderStartOffset + 20, 4), MetadataTokens.GetToken(file));
    }

    private static byte[] Hash(int algorithm, byte[] bytes) => algorithm switch {
        0 or 0x8004 => SHA1.HashData(bytes),
        0x8003 => MD5.HashData(bytes),
        0x800c => SHA256.HashData(bytes),
        0x800d => SHA384.HashData(bytes),
        0x800e => SHA512.HashData(bytes),
        _ => throw new InvalidOperationException("Unknown fixture hash algorithm"),
    };
}
