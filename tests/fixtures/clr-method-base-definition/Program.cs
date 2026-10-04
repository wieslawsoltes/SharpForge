using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Static |
    BindingFlags.Public | BindingFlags.NonPublic;
var records = typeof(Fixture.Root).Assembly.GetTypes().Where(type => type.Namespace == "Fixture")
    .SelectMany(type => type.GetMethods(flags)).OrderBy(method => method.MetadataToken)
    .Select(method => new { token = method.MetadataToken, name = method.Name,
        declaringType = method.DeclaringType!.FullName, baseToken = method.GetBaseDefinition().MetadataToken,
        baseType = method.GetBaseDefinition().DeclaringType!.FullName });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, records }));

namespace Fixture
{
    public class Payload { }
    public interface IContract { int Compute(int value); }
    public class Root
    {
        public virtual int Compute(int value) => value;
        public virtual int Compute(string value) => value.Length;
        public virtual Payload Echo(Payload value) => value;
        public virtual void Replace(ref int value) { }
        public virtual Payload[] Vector(Payload[] value) => value;
        public virtual int[,] Matrix(int[,] value) => value;
        public virtual T Generic<T>(T value) => value;
        public virtual int Reset(int value) => value;
        public static int Static(int value) => value;
        public int Plain(int value) => value;
    }
    public class Middle : Root
    {
        public override int Compute(int value) => value + 1;
        public override Payload Echo(Payload value) => value;
        public override void Replace(ref int value) { }
        public override T Generic<T>(T value) => value;
        public new virtual int Reset(int value) => value;
    }
    public class Leaf : Middle
    {
        public sealed override int Compute(int value) => value + 2;
        public override int Compute(string value) => value.Length;
        public override Payload[] Vector(Payload[] value) => value;
        public override int[,] Matrix(int[,] value) => value;
        public override int Reset(int value) => value;
    }
    public abstract class AbstractRoot { public abstract int Calculate(int value); }
    public class Concrete : AbstractRoot { public override int Calculate(int value) => value; }
}
