using System.Runtime.InteropServices;
using System.Runtime.Loader;
using System.Text.Json;

string? cycleError = null;
var context = new AssemblyLoadContext("Cycle", isCollectible: true);
try {
    using var stream = File.OpenRead(args[0]);
    context.LoadFromStream(stream).GetType("Fixture.Program", throwOnError: true);
} catch (Exception error) { cycleError = error.GetType().FullName; }
finally { context.Unload(); }
if (cycleError != "System.TypeLoadException") throw new Exception($"Unexpected cycle result: {cycleError}");
var definitions = typeof(Fixture.Child).Assembly.GetTypes().Where(type => type.Namespace == "Fixture").Select(type => new {
    token = type.MetadataToken, name = type.FullName, enclosing = type.DeclaringType?.FullName,
    kind = type.IsInterface ? "interface" : type.IsEnum ? "enum" : type.IsValueType ? "valuetype" : "class",
    baseType = type.BaseType?.FullName,
    interfaces = type.GetInterfaces().Select(contract => contract.FullName).Order(StringComparer.Ordinal).ToArray(),
    underlying = type.IsEnum ? Enum.GetUnderlyingType(type).FullName : null,
});
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, cycleError, definitions }));

namespace Fixture
{
    public interface IRoot { }
    public interface IChild : IRoot { }
    public class Base : IRoot { }
    public class Child : Base, IChild { }
    public struct Pair { public int Left; public long Right; }
    public enum Code : ushort { First, Second }
    public class Outer { public class Inner { } }
}
