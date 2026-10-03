using System.Reflection;
using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Security.Cryptography;
using System.Text.Json;
using AttributeFixture;

static object? Scalar(object? value)
{
    if (value is Type type) return type.AssemblyQualifiedName;
    if (value is Enum enumeration) return Scalar(Convert.ChangeType(enumeration, Enum.GetUnderlyingType(enumeration.GetType())));
    if (value is long signed && (signed > 9007199254740991L || signed < -9007199254740991L)) return new Dictionary<string, string> { ["$bigint"] = signed.ToString() };
    if (value is ulong unsigned && unsigned > 9007199254740991UL) return new Dictionary<string, string> { ["$bigint"] = unsigned.ToString() };
    if (value is float single) return Scalar((double)single);
    if (value is double number)
    {
        if (double.IsNaN(number)) return new Dictionary<string, string> { ["$number"] = BitConverter.DoubleToInt64Bits(number) < 0 ? "-NaN" : "NaN" };
        if (double.IsInfinity(number)) return new Dictionary<string, string> { ["$number"] = number > 0 ? "Infinity" : "-Infinity" };
        if (number == 0 && BitConverter.DoubleToInt64Bits(number) < 0) return new Dictionary<string, string> { ["$number"] = "-0" };
    }
    if (value is Array array) return array.Cast<object?>().Select(Scalar).ToArray();
    return value;
}

static object Constant(CustomAttributeTypedArgument argument)
{
    var type = argument.ArgumentType;
    var kind = type.IsArray ? "array" : type.IsEnum ? "enum" : type == typeof(Type) ? "type" : "primitive";
    object? value = type.IsArray && argument.Value is IList<CustomAttributeTypedArgument> elements
        ? elements.Select(Constant).ToArray() : Scalar(argument.Value);
    return new { kind, type = type.IsArray ? null : type.FullName, value };
}

static object Descriptor(Type type)
{
    if (type.IsArray) return new { kind = "szarray", element = Descriptor(type.GetElementType()!) };
    if (type.IsEnum) return new { kind = "enum", name = type.FullName, underlying = Enum.GetUnderlyingType(type).FullName };
    return new { kind = "primitive", name = type.FullName };
}

static object WireDescriptor(AttributeType type)
{
    if (type.Element is not null) return new { kind = "szarray", element = WireDescriptor(type.Element) };
    if (type.RuntimeType.IsEnum) return new { kind = "enum", name = type.Name, underlying = Enum.GetUnderlyingType(type.RuntimeType).FullName };
    return new { kind = "primitive", name = type.Name };
}

static object? Input(AttributeType type, object? value, Type declaredType)
{
    if (declaredType == typeof(object)) return new { type = WireDescriptor(type), value = Input(type, value, type.RuntimeType) };
    if (value is ImmutableArray<CustomAttributeTypedArgument<AttributeType>> elements)
        return elements.Select(element => Input(element.Type, element.Value, declaredType.GetElementType()!)).ToArray();
    if (value is AttributeType serializedType) return serializedType.Name;
    return Scalar(value);
}

static object WireConstant(AttributeType type, object? value)
{
    var kind = type.Element is not null ? "array" : type.RuntimeType.IsEnum ? "enum" : type.RuntimeType == typeof(Type) ? "type" : "primitive";
    object? decoded = value is ImmutableArray<CustomAttributeTypedArgument<AttributeType>> items
        ? items.Select(item => WireConstant(item.Type, item.Value)).ToArray()
        : value is AttributeType serialized ? serialized.Name : Scalar(value);
    return new { kind, type = type.Element is not null ? null : type.Name, value = decoded };
}

static object Actual(PayloadAttribute attribute) => new
{
    values = attribute.Values.Select(Scalar).ToArray(),
    field = attribute.Field, boxed = Scalar(attribute.Boxed), target = Scalar(attribute.Target),
    enumValue = Scalar(attribute.EnumValue), strings = attribute.Strings
};

var jsonOptions = new JsonSerializerOptions { WriteIndented = true };
if (args.Length == 2 && args[0] == "reflect")
{
    var context = new AssemblyLoadContext("attribute-check", isCollectible: true);
    try
    {
        // Reuse the fixture's attribute definition while loading the patched assembly under test.
        context.Resolving += (_, name) => name.Name == typeof(PayloadAttribute).Assembly.GetName().Name ? typeof(PayloadAttribute).Assembly : null;
        var loaded = context.LoadFromAssemblyPath(Path.GetFullPath(args[1]));
        var actual = loaded.GetTypes().Where(type => type.Name.StartsWith("Case", StringComparison.Ordinal))
            .ToDictionary(type => type.Name, type => type.GetCustomAttributes().Where(attribute => attribute.GetType().Name == "PayloadAttribute").Select(attribute =>
            {
                // Patched assemblies contain their own attribute Type identity in this context.
                var attributeType = attribute.GetType();
                object? Get(string name) => attributeType.GetProperty(name)?.GetValue(attribute) ?? attributeType.GetField(name)?.GetValue(attribute);
                return new { values = Scalar(Get("Values")), field = Get("Field"), boxed = Scalar(Get("Boxed")),
                    target = Scalar(Get("Target")), enumValue = Scalar(Get("EnumValue")), strings = Scalar(Get("Strings")) };
            }).ToArray());
        Console.WriteLine(JsonSerializer.Serialize(actual, jsonOptions));
    }
    finally { context.Unload(); }
    return;
}

var assembly = typeof(PayloadAttribute).Assembly;
using var stream = File.OpenRead(assembly.Location);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
var cases = new List<object>();
foreach (var type in assembly.GetTypes().Where(type => type.Name.StartsWith("Case", StringComparison.Ordinal)))
{
    var handle = (TypeDefinitionHandle)MetadataTokens.EntityHandle(type.MetadataToken);
    var attributes = metadata.GetTypeDefinition(handle).GetCustomAttributes().ToArray();
    var data = type.GetCustomAttributesData().ToArray();
    for (var index = 0; index < data.Length; index++)
    {
        var attribute = metadata.GetCustomAttribute(attributes[index]);
        var constructorParameters = data[index].Constructor.GetParameters();
        var parameters = constructorParameters.Select(parameter => Descriptor(parameter.ParameterType)).ToArray();
        var wire = attribute.DecodeValue(new AttributeTypeProvider());
        var blobReader = metadata.GetBlobReader(attribute.Value);
        var blobSize = blobReader.Length;
        var prefixSize = blobSize < 0x80 ? 1 : blobSize < 0x4000 ? 2 : 4;
        var blobOffset = pe.PEHeaders.MetadataStartOffset + metadata.GetHeapMetadataOffset(HeapIndex.Blob)
            + MetadataTokens.GetHeapOffset(attribute.Value) + prefixSize;
        cases.Add(new { id = type.Name, blob = Convert.ToHexString(metadata.GetBlobBytes(attribute.Value)),
            constructor = MetadataTokens.GetToken(attribute.Constructor), parameters, blobOffset,
            values = wire.FixedArguments.Select((argument, ordinal) => Input(argument.Type, argument.Value, constructorParameters[ordinal].ParameterType)).ToArray(),
            constructorArguments = data[index].ConstructorArguments.Select(Constant).ToArray(),
            decodedConstructorArguments = wire.FixedArguments.Select(argument => WireConstant(argument.Type, argument.Value)).ToArray(),
            decodedNamedArguments = wire.NamedArguments.Select(argument => new { name = argument.Name,
                isField = argument.Kind == CustomAttributeNamedArgumentKind.Field, value = WireConstant(argument.Type, argument.Value) }).ToArray(),
            namedArguments = wire.NamedArguments.Select(argument =>
            {
                var native = data[index].NamedArguments.Single(value => value.MemberName == argument.Name
                    && value.IsField == (argument.Kind == CustomAttributeNamedArgumentKind.Field));
                var declared = native.IsField ? ((FieldInfo)native.MemberInfo).FieldType : ((PropertyInfo)native.MemberInfo).PropertyType;
                return new { name = native.MemberName, isField = native.IsField, value = Constant(native.TypedValue),
                    descriptor = declared == typeof(object) ? Descriptor(typeof(object)) : WireDescriptor(argument.Type),
                    inputValue = Input(argument.Type, argument.Value, declared) };
            }).ToArray(), actual = Actual((PayloadAttribute)type.GetCustomAttributes(typeof(PayloadAttribute), false)[index]) });
    }
}
var sources = new[] { "Program.cs", "Fixtures.cs", "Provider.cs", "AttributeOracle.csproj" }.ToDictionary(name => name,
    name => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(args[0], name)))));
var enums = new Dictionary<string, string> { [typeof(Signed).FullName!] = "System.Int64", [typeof(Unsigned).FullName!] = "System.UInt64" };
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, sourceSha256 = sources, enums, cases }, jsonOptions));
