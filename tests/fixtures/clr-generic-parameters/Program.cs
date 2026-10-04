using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

using var stream = File.OpenRead(typeof(Fixture.Ref<>).Assembly.Location);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
object Describe(Type parameter) => new {
    token = parameter.MetadataToken, name = parameter.Name, fullName = parameter.FullName, @namespace = parameter.Namespace,
    text = parameter.ToString(), position = parameter.GenericParameterPosition, attributes = (int)parameter.GenericParameterAttributes,
    owner = parameter.DeclaringType!.FullName,
    constraints = metadata.GetGenericParameter(MetadataTokens.GenericParameterHandle(parameter.MetadataToken & 0xffffff))
        .GetConstraints().Select(handle => MetadataTokens.GetToken(metadata.GetGenericParameterConstraint(handle).Type)).ToArray(),
};
Console.WriteLine(JsonSerializer.Serialize(new {
    runtime = RuntimeInformation.FrameworkDescription,
    definitions = new[] { typeof(Fixture.IVariant<,>), typeof(Fixture.Ref<>), typeof(Fixture.Value<>),
        typeof(Fixture.Related<,>), typeof(Fixture.Outer<>), typeof(Fixture.Outer<>.Inner<>) }
        .Select(type => new { token = type.MetadataToken, name = type.FullName, parameters = type.GetGenericArguments().Select(Describe) }),
    methodParameter = typeof(Fixture.Ref<>).GetMethod("Method")!.GetGenericArguments()[0].MetadataToken,
}));

namespace Fixture
{
    public interface IVariant<out T, in U> { }
    public class Ref<T> where T : class, new() { public static void Method<V>() where V : struct { } }
    public class Value<T> where T : struct { }
    public class Related<T, U> where T : IDisposable where U : T { }
    public class Outer<T> { public class Inner<U> where U : T { } }
}
