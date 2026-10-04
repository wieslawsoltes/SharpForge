using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

static string Name(Type type) => type.IsGenericType
    ? $"{type.GetGenericTypeDefinition().FullName}[{string.Join(",", type.GetGenericArguments().Select(Name))}]"
    : type.FullName ?? type.Name;
static object Describe(Type type) => new {
    name = Name(type), rank = type.GetArrayRank(), szarray = type.IsSZArray,
    baseType = Name(type.BaseType!), interfaces = type.GetInterfaces().Select(Name).Order(StringComparer.Ordinal).ToArray(),
    methods = type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
        .Where(method => new[] { "Get", "Set", "Address" }.Contains(method.Name))
        .Select(method => new { name = method.Name, result = Name(method.ReturnType),
            parameters = method.GetParameters().Select(parameter => Name(parameter.ParameterType)).ToArray() }).ToArray(),
    constructors = type.GetConstructors().Select(ctor => ctor.GetParameters().Length).Order().ToArray(),
};
Console.WriteLine(JsonSerializer.Serialize(new {
    runtime = RuntimeInformation.FrameworkDescription,
    arrays = new[] { typeof(int[]), typeof(int).MakeArrayType(1), typeof(int[,]), typeof(string[,,]), typeof(int[][]) }.Select(Describe),
    pointerName = Name(typeof(int).MakePointerType()), byrefName = Name(typeof(int).MakeByRefType()),
}));

public static class ArrayFactory
{
    public static int[,] Create() => new int[2, 3];
}
