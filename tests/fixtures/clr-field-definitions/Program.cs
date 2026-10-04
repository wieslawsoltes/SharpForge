using System.Globalization;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

using var stream = File.OpenRead(typeof(Fields<>).Assembly.Location);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
var fields = new[] { typeof(Base), typeof(Fields<>), typeof(Values), typeof(Pair) }
    .SelectMany(type => type.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static |
        BindingFlags.Instance | BindingFlags.DeclaredOnly)).OrderBy(field => field.MetadataToken).Select(field =>
    {
        var definition = metadata.GetFieldDefinition(MetadataTokens.FieldDefinitionHandle(field.MetadataToken & 0xffffff));
        var handle = definition.GetDefaultValue();
        object? constant = null;
        if (!handle.IsNil)
        {
            var value = field.GetRawConstantValue();
            if (value is long or ulong) value = Convert.ToString(value, CultureInfo.InvariantCulture);
            constant = new { type = (int)metadata.GetConstant(handle).TypeCode, value };
        }
        return new { token = field.MetadataToken, owner = field.DeclaringType!.MetadataToken, name = field.Name,
            flags = (int)field.Attributes, field.IsStatic, field.IsInitOnly, field.IsLiteral, constant,
            signature = Convert.ToBase64String(metadata.GetBlobBytes(definition.Signature)) };
    });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, fields }));

public class Base { public int Inherited; }
public class Fields<T> : Base
{
    public int Instance;
    private string Hidden = "hidden";
    public static string? Shared;
    public readonly int ReadOnly;
    public volatile int Volatile;
    public const int Number = 7;
    public const long Large = long.MaxValue;
    public const string Text = "hello";
    public const object? Missing = null;
    public T? Generic;
    public int[]? Array;
}
public enum Values : short { First = 1, Second = 2 }
public struct Pair { public int X; }
