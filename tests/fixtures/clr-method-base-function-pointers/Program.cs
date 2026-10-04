using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

var assembly = Assembly.GetExecutingAssembly();
const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public;
var records = new List<object>();
foreach (var name in new[] { "Child", "KindChild", "ConventionChild", "ArityChild", "ReturnChild", "ParameterChild", "NestedChild" })
{
    var typeName = $"Fixture.{name}";
    try
    {
        foreach (var method in assembly.GetType(typeName, true)!.GetMethods(flags).OrderBy(method => method.MetadataToken))
            records.Add(new { token = method.MetadataToken, name = method.Name,
                declaringType = method.DeclaringType!.FullName, baseToken = method.GetBaseDefinition().MetadataToken,
                baseType = method.GetBaseDefinition().DeclaringType!.FullName });
    }
    catch (TypeLoadException error)
    {
        records.Add(new { declaringType = typeName, error = error.GetType().Name });
    }
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, records }));

namespace Fixture
{
    public unsafe class Root
    {
        public virtual int Managed(delegate* managed<int, int> value) => 0;
        public virtual int Cdecl(delegate* unmanaged[Cdecl]<int, int> value) => 0;
        public virtual int Stdcall(delegate* unmanaged[Stdcall]<int, int> value) => 0;
        public virtual int Thiscall(delegate* unmanaged[Thiscall]<int, int> value) => 0;
        public virtual int Fastcall(delegate* unmanaged[Fastcall]<int, int> value) => 0;
        public virtual int Multiple(delegate*<int, long, int> value) => 0;
        public virtual int Elements(delegate*<int*, int*> value) => 0;
        public virtual int Nested(delegate*<delegate*<int, int>, int> value) => 0;
        public virtual int ByRef(delegate*<ref int, int> value) => 0;
        public virtual int Suppressed(delegate* unmanaged[Cdecl, SuppressGCTransition]<int, int> value) => 0;
        public virtual int Generic<T>(delegate*<T, T> value) => 0;
        public virtual delegate*<int, int> ReturnPointer() => null;
    }
    public unsafe class Child : Root
    {
        public override int Managed(delegate* managed<int, int> value) => 0;
        public override int Cdecl(delegate* unmanaged[Cdecl]<int, int> value) => 0;
        public override int Stdcall(delegate* unmanaged[Stdcall]<int, int> value) => 0;
        public override int Thiscall(delegate* unmanaged[Thiscall]<int, int> value) => 0;
        public override int Fastcall(delegate* unmanaged[Fastcall]<int, int> value) => 0;
        public override int Multiple(delegate*<int, long, int> value) => 0;
        public override int Elements(delegate*<int*, int*> value) => 0;
        public override int Nested(delegate*<delegate*<int, int>, int> value) => 0;
        public override int ByRef(delegate*<ref int, int> value) => 0;
        public override int Suppressed(delegate* unmanaged[Cdecl, SuppressGCTransition]<int, int> value) => 0;
        public override int Generic<T>(delegate*<T, T> value) => 0;
        public override delegate*<int, int> ReturnPointer() => null;
    }

    public unsafe class KindRoot
    {
        public virtual int M(delegate* managed<int, int> value) => 0;
    }

    public unsafe class KindMiddle : KindRoot
    {
        public new virtual int M(delegate* unmanaged[Cdecl]<int, int> value) => 0;
    }

    public unsafe class KindChild : KindMiddle
    {
        public override int M(delegate* managed<int, int> value) => 0;
    }

    public unsafe class ConventionRoot
    {
        public virtual int M(delegate* unmanaged[Cdecl]<int, int> value) => 0;
    }

    public unsafe class ConventionMiddle : ConventionRoot
    {
        public new virtual int M(delegate* unmanaged[Stdcall]<int, int> value) => 0;
    }

    public unsafe class ConventionChild : ConventionMiddle
    {
        public override int M(delegate* unmanaged[Cdecl]<int, int> value) => 0;
    }

    public unsafe class ArityRoot
    {
        public virtual int M(delegate*<int, int> value) => 0;
    }

    public unsafe class ArityMiddle : ArityRoot
    {
        public new virtual int M(delegate*<int, int, int> value) => 0;
    }

    public unsafe class ArityChild : ArityMiddle
    {
        public override int M(delegate*<int, int> value) => 0;
    }

    public unsafe class ReturnRoot
    {
        public virtual int M(delegate*<int, int> value) => 0;
    }

    public unsafe class ReturnMiddle : ReturnRoot
    {
        public new virtual int M(delegate*<int, long> value) => 0;
    }

    public unsafe class ReturnChild : ReturnMiddle
    {
        public override int M(delegate*<int, int> value) => 0;
    }

    public unsafe class ParameterRoot
    {
        public virtual int M(delegate*<int, int> value) => 0;
    }

    public unsafe class ParameterMiddle : ParameterRoot
    {
        public new virtual int M(delegate*<long, int> value) => 0;
    }

    public unsafe class ParameterChild : ParameterMiddle
    {
        public override int M(delegate*<int, int> value) => 0;
    }

    public unsafe class NestedRoot
    {
        public virtual int M(delegate*<delegate*<int, int>, int> value) => 0;
    }

    public unsafe class NestedMiddle : NestedRoot
    {
        public new virtual int M(delegate*<delegate*<long, int>, int> value) => 0;
    }

    public unsafe class NestedChild : NestedMiddle
    {
        public override int M(delegate*<delegate*<int, int>, int> value) => 0;
    }
}
