using System.Globalization;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

using var stream = File.OpenRead(typeof(Fixture).Assembly.Location);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
object Describe(ParameterInfo parameter, Dictionary<int, ParameterHandle> rows)
{
    rows.TryGetValue(parameter.Position + 1, out var handle);
    var definition = handle.IsNil ? default : metadata.GetParameter(handle);
    var constantHandle = handle.IsNil ? default : definition.GetDefaultValue();
    object? constant = null;
    if (!constantHandle.IsNil)
    {
        var value = parameter.RawDefaultValue;
        if (value is long or ulong) value = Convert.ToString(value, CultureInfo.InvariantCulture);
        constant = new { type = (int)metadata.GetConstant(constantHandle).TypeCode, value };
    }
    return new { token = handle.IsNil ? 0 : MetadataTokens.GetToken(handle), position = parameter.Position,
        name = parameter.Name, flags = (int)parameter.Attributes, constant };
}
var methods = typeof(Fixture).GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)
    .OrderBy(method => method.MetadataToken).Select(method =>
    {
        var definition = metadata.GetMethodDefinition(MetadataTokens.MethodDefinitionHandle(method.MetadataToken & 0xffffff));
        var rows = definition.GetParameters().ToDictionary(handle => metadata.GetParameter(handle).SequenceNumber);
        return new { token = method.MetadataToken, name = method.Name,
            parameters = method.GetParameters().Select(parameter => Describe(parameter, rows)),
            returnParameter = Describe(method.ReturnParameter, rows) };
    });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, methods }));

public static class Fixture
{
    public static void Defaults(int number = 7, string text = "hello", object? missing = null, long large = 1234567890123) { }
    public static void Directions(ref int input, out string output, [Optional] int optional)
    {
        output = input.ToString(CultureInfo.InvariantCulture);
    }
    [return: MarshalAs(UnmanagedType.I4)]
    public static int Result() => 1;
}
