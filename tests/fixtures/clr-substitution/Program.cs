using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

static class Program
{
    static readonly Dictionary<Type, string> Aliases = new()
    {
        [typeof(void)] = "void", [typeof(bool)] = "bool", [typeof(char)] = "char",
        [typeof(sbyte)] = "sbyte", [typeof(byte)] = "byte", [typeof(short)] = "short", [typeof(ushort)] = "ushort",
        [typeof(int)] = "int", [typeof(uint)] = "uint", [typeof(long)] = "long", [typeof(ulong)] = "ulong",
        [typeof(float)] = "float", [typeof(double)] = "double", [typeof(string)] = "string",
        [typeof(object)] = "object", [typeof(IntPtr)] = "nint", [typeof(UIntPtr)] = "nuint"
    };
    static readonly Dictionary<int, string> Names = new();
    static string Display(Type type)
    {
        if (Aliases.TryGetValue(type, out var alias)) return alias;
        if (type.IsGenericParameter) return (type.DeclaringMethod is null ? "!" : "!!") + type.GenericParameterPosition;
        if (type.IsByRef) return Display(type.GetElementType()!) + "&";
        if (type.IsPointer) return Display(type.GetElementType()!) + "*";
        if (type.IsArray) return Display(type.GetElementType()!) + (type.IsSZArray ? "[]" :
            type.GetArrayRank() == 1 ? "[*]" : "[" + new string(',', type.GetArrayRank() - 1) + "]");
        if (type.IsGenericType)
        {
            var definition = type.GetGenericTypeDefinition();
            Names[definition.MetadataToken] = definition.FullName!;
            return definition.FullName + "<" + string.Join(", ", type.GetGenericArguments().Select(Display)) + ">";
        }
        Names[type.MetadataToken] = type.FullName!;
        return type.FullName!;
    }
    static object Expected(MethodInfo method) => new
    {
        kind = "method", isStatic = method.IsStatic, returnType = Display(method.ReturnType),
        parameters = method.GetParameters().Select(parameter => Display(parameter.ParameterType)).ToArray()
    };
    static void Main()
    {
        var cases = new List<object>();
        var open = typeof(Dictionary<,>);
        var closed = typeof(Dictionary<string, int>);
        using var stream = File.OpenRead(open.Assembly.Location);
        using var pe = new PEReader(stream);
        var metadata = pe.GetMetadataReader();
        const BindingFlags flags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;
        foreach (var field in closed.GetFields(flags).OrderBy(field => field.MetadataToken))
        {
            var definition = metadata.GetFieldDefinition(MetadataTokens.FieldDefinitionHandle(field.MetadataToken & 0xffffff));
            cases.Add(new { name = "Dictionary." + field.Name, signature = Convert.ToBase64String(metadata.GetBlobBytes(definition.Signature)),
                typeArguments = new[] { "string", "int" }, expected = new { kind = "field", type = Display(field.FieldType) } });
        }
        var selected = new[] { "Add", "TryGetValue", "TryAdd", "ContainsKey", "GetEnumerator" };
        foreach (var method in closed.GetMethods(flags).Where(method => selected.Contains(method.Name)).OrderBy(method => method.MetadataToken))
        {
            var definition = metadata.GetMethodDefinition(MetadataTokens.MethodDefinitionHandle(method.MetadataToken & 0xffffff));
            cases.Add(new { name = "Dictionary." + method.Name, signature = Convert.ToBase64String(metadata.GetBlobBytes(definition.Signature)),
                typeArguments = new[] { "string", "int" }, expected = Expected(method) });
        }
        var property = closed.GetProperty("Item")!;
        var propertyDefinition = metadata.GetPropertyDefinition(MetadataTokens.PropertyDefinitionHandle(property.MetadataToken & 0xffffff));
        cases.Add(new { name = "Dictionary.Item", signature = Convert.ToBase64String(metadata.GetBlobBytes(propertyDefinition.Signature)),
            typeArguments = new[] { "string", "int" }, expected = new { kind = "property", isStatic = false,
                returnType = Display(property.PropertyType), parameters = property.GetIndexParameters().Select(parameter => Display(parameter.ParameterType)),
                callingConvention = 8 } });
        using var ownStream = File.OpenRead(typeof(Program).Assembly.Location);
        using var ownPe = new PEReader(ownStream);
        var ownMetadata = ownPe.GetMetadataReader();
        var generic = typeof(Pair<string, int>).GetMethod("Generic")!.MakeGenericMethod(typeof(long));
        var genericDefinition = ownMetadata.GetMethodDefinition(MetadataTokens.MethodDefinitionHandle(generic.MetadataToken & 0xffffff));
        cases.Add(new { name = "Pair.Generic", signature = Convert.ToBase64String(ownMetadata.GetBlobBytes(genericDefinition.Signature)),
            typeArguments = new[] { "string", "int" }, methodArguments = new[] { "long" },
            expected = new { kind = "method", isStatic = false, returnType = Display(generic.ReturnType),
                parameters = generic.GetParameters().Select(parameter => Display(parameter.ParameterType)), genericArity = 1 } });
        Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription,
            coreLibrary = open.Assembly.GetName().FullName, names = Names, cases }));
    }
}

public class Pair<TKey, TValue>
{
    public TResult Generic<TResult>(TKey key, ref TResult result) => result;
}
