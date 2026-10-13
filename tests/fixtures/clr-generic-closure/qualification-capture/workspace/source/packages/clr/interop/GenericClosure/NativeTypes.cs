using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using GenericInstantiationOracle;

namespace GenericClosureOracle;

internal sealed class NativeFailure(string stage, Exception native) : Exception("A native operation threw", native)
{
    public string Stage { get; } = stage;
    public Exception Native { get; } = native;
}

internal sealed class ClosureLoadContext(string directory, IReadOnlyDictionary<string, ClosureImage> images, TypeObservations observations)
    : AssemblyLoadContext("GenericClosure", isCollectible: false)
{
    private readonly Dictionary<string, ClosureImage> byAssemblyName = images.Values.ToDictionary(image => image.assemblyName, StringComparer.Ordinal);
    private readonly HashSet<Assembly> registered = new();

    private void Register(Assembly assembly, string image)
    {
        if (!registered.Add(assembly)) return;
        try { observations.Register(assembly, image); }
        catch (ArgumentException error)
        {
            throw new InvalidDataException("Observer assembly-scope registration failed", error);
        }
    }

    protected override Assembly? Load(AssemblyName name)
    {
        if (name.Name is null || !byAssemblyName.TryGetValue(name.Name, out var image)) return null;
        var assembly = LoadFromAssemblyPath(Path.Combine(directory, image.file));
        // Lazy reflection can load another image while Describe is running; its scope must already be registered.
        Register(assembly, image.id);
        return assembly;
    }

    public void RegisterImages()
    {
        foreach (var assembly in Assemblies) Register(assembly, byAssemblyName[assembly.GetName().Name!].id);
    }
}

internal sealed class NativeTypes
{
    private readonly string directory;
    private readonly IReadOnlyDictionary<string, ClosureImage> images;
    private readonly ClosureLoadContext context;
    private readonly Action<string> progress;
    public TypeObservations Observations { get; } = new();

    public NativeTypes(string directory, IReadOnlyDictionary<string, ClosureImage> images, Action<string> progress)
    {
        this.directory = directory;
        this.images = images;
        this.progress = progress;
        context = new ClosureLoadContext(directory, images, Observations);
    }

    private T Call<T>(string stage, Func<T> operation)
    {
        progress(stage);
        try { return operation(); }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException or TypeLoadException
            or BadImageFormatException or NotSupportedException or FileLoadException or FileNotFoundException)
        {
            throw new NativeFailure(stage, error);
        }
    }

    public Type Resolve(DefinitionReference reference, string stage)
    {
        var path = Path.Combine(directory, images[reference.image].file);
        var assembly = Call("resolveModule", () => context.LoadFromAssemblyPath(path));
        var module = assembly.ManifestModule;
        return Call(stage, () => module.ResolveType(reference.token));
    }

    public Type Parameter(DefinitionReference owner, int index)
    {
        var type = Resolve(owner, "resolveArguments");
        var arguments = Call("resolveArguments", type.GetGenericArguments);
        if (index >= arguments.Length) throw new InvalidOperationException("Authored formal index exceeds its native owner arity");
        return arguments[index];
    }

    public Type Instantiate(DefinitionReference definition, BoundArgument[] arguments, string stage)
    {
        var type = Resolve(definition, stage == "makeGenericType" ? "resolveDefinition" : "resolveArguments");
        var actual = arguments.Select(argument => argument.resolve(this)).ToArray();
        return Call(stage, () => type.MakeGenericType(actual));
    }

    public Type Array(BoundArgument element)
    {
        var type = element.resolve(this);
        return Call("resolveArguments", type.MakeArrayType);
    }

    public void RegisterImages() => context.RegisterImages();
}
