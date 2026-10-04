using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

using var stream = File.OpenRead(typeof(Derived<>).Assembly.Location);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
var properties = new[] { typeof(Base), typeof(Derived<>), typeof(IValue), typeof(Pair) }
    .SelectMany(type => type.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static |
        BindingFlags.Instance | BindingFlags.DeclaredOnly)).OrderBy(property => property.MetadataToken).Select(property =>
    {
        var definition = metadata.GetPropertyDefinition(MetadataTokens.PropertyDefinitionHandle(property.MetadataToken & 0xffffff));
        var getter = property.GetGetMethod(true);
        var setter = property.GetSetMethod(true);
        return new { token = property.MetadataToken, owner = property.DeclaringType!.MetadataToken, name = property.Name,
            flags = (int)property.Attributes, isStatic = (getter ?? setter)!.IsStatic, property.CanRead, property.CanWrite,
            getter = getter?.MetadataToken, setter = setter?.MetadataToken,
            others = definition.GetAccessors().Others.Select(handle => MetadataTokens.GetToken(handle)),
            indexParameterCount = property.GetIndexParameters().Length,
            signature = Convert.ToBase64String(metadata.GetBlobBytes(definition.Signature)) };
    });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, properties }));

public class Base { public virtual int Value { get; set; } }
public class Derived<T> : Base
{
    public override int Value { get; set; }
    public static string Static { get; } = "static";
    public T? Generic { get; private set; }
    public int this[int index, string key] { get => index; set { } }
    public string WriteOnly { set { } }
    protected string Protected { get; } = "protected";
}
public interface IValue { int Value { get; set; } }
public struct Pair { public int X { get; set; } }
