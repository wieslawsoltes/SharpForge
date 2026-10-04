using System;
using System.Collections.Immutable;
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
var names = new SignatureNames();
string Name(EntityHandle handle) => names.Name(metadata, handle);
string MethodName(EntityHandle handle)
{
    if (handle.IsNil) return "";
    if (handle.Kind == HandleKind.MemberReference)
    {
        var reference = metadata.GetMemberReference((MemberReferenceHandle)handle);
        return Name(reference.Parent) + "::" + metadata.GetString(reference.Name) + " "
            + SignatureNames.Method(reference.DecodeMethodSignature(names, null));
    }
    var method = metadata.GetMethodDefinition((MethodDefinitionHandle)handle);
    return Name(method.GetDeclaringType()) + "::" + metadata.GetString(method.Name) + " "
        + SignatureNames.Method(method.DecodeSignature(names, null));
}
string AttributeName(CustomAttributeHandle handle)
{
    var constructor = metadata.GetCustomAttribute(handle).Constructor;
    var owner = constructor.Kind == HandleKind.MemberReference
        ? metadata.GetMemberReference((MemberReferenceHandle)constructor).Parent
        : metadata.GetMethodDefinition((MethodDefinitionHandle)constructor).GetDeclaringType();
    return Name(owner);
}
object? Value(object? value) => value is ImmutableArray<CustomAttributeTypedArgument<string>> array
    ? array.Select(item => new { type = item.Type, value = Value(item.Value) }).ToArray() : value;
object[] Attributes(CustomAttributeHandleCollection handles) => handles.Select(handle =>
{
    var attribute = metadata.GetCustomAttribute(handle);
    var value = attribute.DecodeValue(names);
    return new
    {
        name = AttributeName(handle), constructor = MethodName(attribute.Constructor),
        arguments = value.FixedArguments.Select(item => new { type = item.Type, value = Value(item.Value) }).ToArray(),
        named = value.NamedArguments.Select(item => new
        {
            name = item.Name, kind = item.Kind.ToString(), type = item.Type, value = Value(item.Value),
        }).ToArray(),
    };
}).OrderBy(item => item.name, StringComparer.Ordinal).ToArray();
object? Constant(ConstantHandle handle)
{
    if (handle.IsNil) return null;
    var constant = metadata.GetConstant(handle);
    return new { type = constant.TypeCode.ToString(), bytes = Convert.ToHexString(metadata.GetBlobBytes(constant.Value)) };
}
var surface = metadata.TypeDefinitions.Select(handle =>
{
    var type = metadata.GetTypeDefinition(handle);
    var layout = type.GetLayout();
    return new
    {
        name = Name(handle), flags = (int)type.Attributes, baseType = Name(type.BaseType),
        classSize = layout.Size, packingSize = layout.PackingSize, attributes = Attributes(type.GetCustomAttributes()),
        interfaces = type.GetInterfaceImplementations().Select(item => Name(metadata.GetInterfaceImplementation(item).Interface))
            .OrderBy(name => name, StringComparer.Ordinal).ToArray(),
        implementations = type.GetMethodImplementations().Select(item =>
        {
            var implementation = metadata.GetMethodImplementation(item);
            return new { body = MethodName(implementation.MethodBody), declaration = MethodName(implementation.MethodDeclaration) };
        }).OrderBy(item => item.body, StringComparer.Ordinal).ToArray(),
        fields = type.GetFields().Select(fieldHandle =>
        {
            var field = metadata.GetFieldDefinition(fieldHandle);
            return new { name = metadata.GetString(field.Name), flags = (int)field.Attributes,
                signature = field.DecodeSignature(names, null), constant = Constant(field.GetDefaultValue()),
                attributes = Attributes(field.GetCustomAttributes()) };
        }).OrderBy(field => field.name, StringComparer.Ordinal).ToArray(),
        methods = type.GetMethods().Select(methodHandle =>
        {
            var method = metadata.GetMethodDefinition(methodHandle);
            return new { name = metadata.GetString(method.Name), flags = (int)method.Attributes, implFlags = (int)method.ImplAttributes,
                signature = SignatureNames.Method(method.DecodeSignature(names, null)), attributes = Attributes(method.GetCustomAttributes()) };
        }).OrderBy(method => method.name, StringComparer.Ordinal).ThenBy(method => method.signature, StringComparer.Ordinal).ToArray(),
        properties = type.GetProperties().Select(handle =>
        {
            var property = metadata.GetPropertyDefinition(handle);
            var accessors = property.GetAccessors();
            return new { name = metadata.GetString(property.Name), signature = SignatureNames.Method(property.DecodeSignature(names, null)),
                getter = MethodName(accessors.Getter), setter = MethodName(accessors.Setter), attributes = Attributes(property.GetCustomAttributes()) };
        }).OrderBy(item => item.name, StringComparer.Ordinal).ToArray(),
        events = type.GetEvents().Select(handle =>
        {
            var @event = metadata.GetEventDefinition(handle);
            var accessors = @event.GetAccessors();
            return new { name = metadata.GetString(@event.Name), type = Name(@event.Type), adder = MethodName(accessors.Adder),
                remover = MethodName(accessors.Remover), attributes = Attributes(@event.GetCustomAttributes()) };
        }).OrderBy(item => item.name, StringComparer.Ordinal).ToArray(),
    };
}).OrderBy(type => type.name, StringComparer.Ordinal).ToArray();
var bodies = metadata.MethodDefinitions.Select(metadata.GetMethodDefinition).Where(method => method.RelativeVirtualAddress != 0)
    .Select(method => pe.GetMethodBody(method.RelativeVirtualAddress).GetILBytes()!).ToArray();
var loadRejection = "none";
var loadHResult = 0;
try { Assembly.LoadFile(Path.GetFullPath(args[0])); }
catch (BadImageFormatException error) { loadRejection = error.GetType().Name; loadHResult = error.HResult; }
var result = new
{
    runtime = Environment.Version.ToString(), surface,
    markerCount = metadata.GetAssemblyDefinition().GetCustomAttributes()
        .Count(handle => AttributeName(handle) == "System.Runtime.CompilerServices.ReferenceAssemblyAttribute"),
    bodyCount = bodies.Length,
    allBodiesThrowNull = bodies.All(body => body.SequenceEqual(new byte[] { 0x14, 0x7a })),
    loadRejection, loadHResult,
};
Console.WriteLine(JsonSerializer.Serialize(result));
