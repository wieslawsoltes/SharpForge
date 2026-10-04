using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;

if (args.Length != 1) throw new ArgumentException("Expected one assembly path");
using var stream = File.OpenRead(args[0]);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
string Name(EntityHandle handle)
{
    if (handle.Kind == HandleKind.TypeReference)
    {
        var type = metadata.GetTypeReference((TypeReferenceHandle)handle);
        var prefix = metadata.GetString(type.Namespace);
        return (prefix.Length == 0 ? "" : prefix + ".") + metadata.GetString(type.Name);
    }
    var definition = metadata.GetTypeDefinition((TypeDefinitionHandle)handle);
    var outer = definition.GetDeclaringType();
    var space = metadata.GetString(definition.Namespace);
    return (!outer.IsNil ? Name(outer) + "+" : space.Length == 0 ? "" : space + ".") + metadata.GetString(definition.Name);
}
string AttributeName(CustomAttributeHandle handle)
{
    var constructor = metadata.GetCustomAttribute(handle).Constructor;
    var owner = constructor.Kind == HandleKind.MemberReference
        ? metadata.GetMemberReference((MemberReferenceHandle)constructor).Parent
        : metadata.GetMethodDefinition((MethodDefinitionHandle)constructor).GetDeclaringType();
    return Name(owner);
}
var surface = metadata.TypeDefinitions.Select(handle =>
{
    var type = metadata.GetTypeDefinition(handle);
    return new
    {
        name = Name(handle),
        flags = (int)type.Attributes,
        fields = type.GetFields().Select(fieldHandle =>
        {
            var field = metadata.GetFieldDefinition(fieldHandle);
            return new { name = metadata.GetString(field.Name), flags = (int)field.Attributes };
        }).OrderBy(field => field.name, StringComparer.Ordinal).ToArray(),
        methods = type.GetMethods().Select(methodHandle =>
        {
            var method = metadata.GetMethodDefinition(methodHandle);
            return new { name = metadata.GetString(method.Name), flags = (int)method.Attributes, implFlags = (int)method.ImplAttributes };
        }).OrderBy(method => method.name, StringComparer.Ordinal).ToArray(),
        properties = type.GetProperties().Select(property => metadata.GetString(metadata.GetPropertyDefinition(property).Name))
            .OrderBy(name => name, StringComparer.Ordinal).ToArray(),
        events = type.GetEvents().Select(@event => metadata.GetString(metadata.GetEventDefinition(@event).Name))
            .OrderBy(name => name, StringComparer.Ordinal).ToArray(),
    };
}).OrderBy(type => type.name, StringComparer.Ordinal).ToArray();
var bodies = metadata.MethodDefinitions.Select(metadata.GetMethodDefinition).Where(method => method.RelativeVirtualAddress != 0)
    .Select(method => pe.GetMethodBody(method.RelativeVirtualAddress).GetILBytes()!).ToArray();
var loadRejection = "none";
try { Assembly.LoadFile(Path.GetFullPath(args[0])); }
catch (BadImageFormatException error) { loadRejection = error.GetType().Name; }
var result = new
{
    runtime = Environment.Version.ToString(),
    surface,
    markerCount = metadata.GetAssemblyDefinition().GetCustomAttributes()
        .Count(handle => AttributeName(handle) == "System.Runtime.CompilerServices.ReferenceAssemblyAttribute"),
    bodyCount = bodies.Length,
    allBodiesThrowNull = bodies.All(body => body.SequenceEqual(new byte[] { 0x14, 0x7a })),
    loadRejection,
};
Console.WriteLine(JsonSerializer.Serialize(result));
