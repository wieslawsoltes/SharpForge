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
    public interface IContract { int Other(int value); }
    public class Root
    {
        public virtual int Compute(int value) => value;
    }
    public class Middle : Root, IContract, IDisposable
    {
        public override int Compute(int value) => value + 1;
        int IContract.Other(int value) => value + 2;
        void IDisposable.Dispose() { }
    }
    public class Leaf : Middle
    {
        public sealed override int Compute(int value) => value + 3;
    }
}
