using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public;
var records = new[] { typeof(Fixture.Root), typeof(Fixture.Middle), typeof(Fixture.Leaf) }
    .SelectMany(type => type.GetMethods(flags)).OrderBy(method => method.MetadataToken)
    .Select(method => new { token = method.MetadataToken, name = method.Name,
        declaringType = method.DeclaringType!.FullName, baseToken = method.GetBaseDefinition().MetadataToken,
        baseType = method.GetBaseDefinition().DeclaringType!.FullName });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, records }));

namespace Fixture
{
    public class Box<T> { }
    public class Pair<T, U> { }
    public struct Value<T> { }
    public class Root
    {
        public virtual Box<int> Echo(Box<int> value) => value;
        public virtual Box<string> Echo(Box<string> value) => value;
        public virtual Pair<string, Box<int[]>> Nested(Pair<string, Box<int[]>> value) => value;
        public virtual Value<int> Struct(Value<int> value) => value;
        public virtual Box<T> Generic<T>(Box<T> value) => value;
        public virtual Box<int>[] Vector(Box<int>[] value) => value;
    }
    public class Middle : Root
    {
        public override Box<int> Echo(Box<int> value) => value;
        public override Box<T> Generic<T>(Box<T> value) => value;
    }
    public class Leaf : Middle
    {
        public override Box<int> Echo(Box<int> value) => value;
        public override Box<string> Echo(Box<string> value) => value;
        public override Pair<string, Box<int[]>> Nested(Pair<string, Box<int[]>> value) => value;
        public override Value<int> Struct(Value<int> value) => value;
        public override Box<int>[] Vector(Box<int>[] value) => value;
    }
}
