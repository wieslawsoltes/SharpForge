using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

using var stream = File.OpenRead(typeof(ReadWrite).Assembly.Location);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
object Shape(Type type)
{
    if (type.IsGenericParameter) return new { kind = "genericParameter", scope = "type", index = type.GenericParameterPosition };
    if (type.IsSZArray) return new { kind = "szarray", element = Shape(type.GetElementType()!) };
    var name = type == typeof(int) ? "int" : type == typeof(long) ? "long" : type == typeof(string) ? "string" : null;
    return new { kind = "primitive", name = name ?? throw new NotSupportedException(type.FullName) };
}
object Describe(ParameterInfo parameter)
{
    var token = parameter.MetadataToken;
    var handle = MetadataTokens.ParameterHandle(token & 0xffffff);
    var constantHandle = handle.IsNil ? default : metadata.GetParameter(handle).GetDefaultValue();
    object? constant = constantHandle.IsNil ? null : new {
        type = (int)metadata.GetConstant(constantHandle).TypeCode, value = parameter.RawDefaultValue };
    return new { token = handle.IsNil ? 0 : token, position = parameter.Position, name = parameter.Name,
        flags = (int)parameter.Attributes, member = parameter.Member.MetadataToken, signatureType = Shape(parameter.ParameterType), constant };
}
var properties = new[] { typeof(ReadWrite), typeof(WriteOnly), typeof(PrivateGetter), typeof(Generic<>),
        typeof(Variadic), typeof(Plain), typeof(IIndexer) }
    .SelectMany(type => type.GetProperties(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.DeclaredOnly))
    .OrderBy(property => property.MetadataToken).Select(property => new {
        token = property.MetadataToken, name = property.Name,
        accessor = (property.GetGetMethod(true) ?? property.GetSetMethod(true))!.MetadataToken,
        parameters = property.GetIndexParameters().Select(Describe) });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, properties }));

public class ReadWrite { public int this[[In] int index = 7, string key = "key"] { get => index; set { } } }
public class WriteOnly { public int this[string key] { set { } } }
public class PrivateGetter { public int this[long offset] { private get => 0; set { } } }
public class Generic<T> { public T this[T key] => key; }
public class Variadic { public int this[params int[] indexes] => indexes.Length; }
public class Plain { public int Value { get; set; } }
public interface IIndexer { int this[int index] { get; } }
