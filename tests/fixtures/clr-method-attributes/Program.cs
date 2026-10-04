using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;

const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Static |
    BindingFlags.Public | BindingFlags.NonPublic;
var records = typeof(Fixture.Sample).Assembly.GetTypes().Where(type => type.Namespace == "Fixture")
    .SelectMany(type => type.GetMethods(flags).Cast<MethodBase>().Concat(type.GetConstructors(flags)))
    .OrderBy(method => method.MetadataToken).Select(method => new
    {
        token = method.MetadataToken, name = method.Name, attributes = (int)method.Attributes,
        implementationFlags = (int)method.MethodImplementationFlags, callingConvention = (int)method.CallingConvention,
        isStatic = method.IsStatic, isAbstract = method.IsAbstract, isFinal = method.IsFinal,
        isVirtual = method.IsVirtual, isHideBySig = method.IsHideBySig, isSpecialName = method.IsSpecialName,
        isPrivate = method.IsPrivate, isFamilyAndAssembly = method.IsFamilyAndAssembly,
        isAssembly = method.IsAssembly, isFamily = method.IsFamily, isFamilyOrAssembly = method.IsFamilyOrAssembly,
        isPublic = method.IsPublic
    });
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, records }));

namespace Fixture
{
    public abstract class Sample
    {
        public Sample() { }
        static Sample() { }
        private void Private() { }
        private protected void FamilyAndAssembly() { }
        internal void Assembly() { }
        protected void Family() { }
        protected internal void FamilyOrAssembly() { }
        public void Public() { }
        public abstract void Abstract();
        public virtual void Virtual() { }
        public int Value => 1;
        public void Variadic(__arglist) { }
        public static void StaticVariadic(__arglist) { }
        public T Generic<T>(T value) => value;
        [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.Synchronized)]
        public static void Implementation() { }
    }
    public sealed class Derived : Sample
    {
        public sealed override void Abstract() { }
        public sealed override void Virtual() { }
    }
}
