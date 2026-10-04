using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

static object? Scalar(object? value)
{
    if (value is char character) value = character.ToString();
    if (value is string text) return new { utf16 = text.Select(character => (int)character).ToArray() };
    if (value is long signed && (signed > 9007199254740991L || signed < -9007199254740991L))
        return new { integer = signed.ToString() };
    if (value is ulong unsigned && unsigned > 9007199254740991UL) return new { integer = unsigned.ToString() };
    if (value is float single) value = (double)single;
    if (value is double number)
    {
        if (double.IsNaN(number)) return new { number = BitConverter.DoubleToInt64Bits(number) < 0 ? "-NaN" : "NaN" };
        if (double.IsInfinity(number)) return new { number = number > 0 ? "Infinity" : "-Infinity" };
        if (number == 0 && BitConverter.DoubleToInt64Bits(number) < 0) return new { number = "-0" };
    }
    return value;
}

using var stream = File.OpenRead(typeof(Constants).Assembly.Location);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
var cases = new List<object>();
void Capture(string id, ConstantHandle handle, object? reflected)
{
    var constant = metadata.GetConstant(handle);
    var reader = metadata.GetBlobReader(constant.Value);
    cases.Add(new { id, type = (int)constant.TypeCode, blob = Convert.ToHexString(metadata.GetBlobBytes(constant.Value)),
        value = Scalar(reflected), srm = Scalar(reader.ReadConstant(constant.TypeCode)) });
}
foreach (var field in typeof(Constants).GetFields(BindingFlags.Public | BindingFlags.Static))
{
    var definition = metadata.GetFieldDefinition((FieldDefinitionHandle)MetadataTokens.EntityHandle(field.MetadataToken));
    Capture(field.Name, definition.GetDefaultValue(), field.GetRawConstantValue());
}
foreach (var parameter in typeof(Constants).GetMethod("Optional")!.GetParameters())
{
    var definition = metadata.GetParameter((ParameterHandle)MetadataTokens.EntityHandle(parameter.MetadataToken));
    Capture("Optional." + parameter.Name, definition.GetDefaultValue(), parameter.RawDefaultValue);
}
var sources = new[] { "Program.cs", "Fixtures.cs", "ConstantOracle.csproj" }.ToDictionary(name => name,
    name => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(args[0], name)))));
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, sourceSha256 = sources, cases },
    new JsonSerializerOptions { WriteIndented = true }));
