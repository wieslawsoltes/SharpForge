using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

static class Program
{
    static string Display(Type type)
    {
        if (type == typeof(void)) return "void";
        if (type == typeof(int)) return "int";
        if (type == typeof(string)) return "string";
        if (type.IsGenericParameter) return (type.DeclaringMethod is null ? "!" : "!!") + type.GenericParameterPosition;
        if (type.IsByRef) return Display(type.GetElementType()!) + "&";
        if (type.IsSZArray) return Display(type.GetElementType()!) + "[]";
        return type.FullName!;
    }
    static void Main()
    {
        const BindingFlags flags = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public |
            BindingFlags.NonPublic | BindingFlags.DeclaredOnly;
        var types = typeof(Program).Assembly.GetTypes().Where(type => type.Namespace == "Fixture").OrderBy(type => type.MetadataToken);
        var definitions = types.Select(type => new
        {
            token = type.MetadataToken, name = type.FullName,
            methods = type.GetMethods(flags).Cast<MethodBase>().Concat(type.GetConstructors(flags)).OrderBy(method => method.MetadataToken)
                .Select(method => new
                {
                    token = method.MetadataToken, name = method.Name, declaringType = method.DeclaringType!.MetadataToken,
                    attributes = (int)method.Attributes, implementationFlags = (int)method.MethodImplementationFlags,
                    isStatic = method.IsStatic, returnType = method is MethodInfo info ? Display(info.ReturnType) : "void",
                    parameters = method.GetParameters().Select(parameter => Display(parameter.ParameterType)),
                    genericArity = method.IsGenericMethodDefinition ? method.GetGenericArguments().Length : 0,
                    body = method.GetMethodBody()?.GetILAsByteArray() is byte[] body ? Convert.ToBase64String(body) : null
                })
        });
        Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, definitions }));
    }
}

namespace Fixture
{
    public interface IContract { int Compute(int value); }
    public abstract class Base
    {
        public abstract int Compute(int value);
        protected virtual string Label() => "Base";
    }
    public sealed class Derived : Base, IContract
    {
        static readonly int Offset;
        static Derived() { Offset = 3; }
        public Derived() { }
        public Derived(int ignored) { }
        public override int Compute(int value) => value + Offset;
        public static int Overload(int value) => value;
        public static string Overload(string value) => value;
        private static void Replace(ref int[] values) { values = new[] { 1, 2 }; }
    }
    public class Generic<T>
    {
        public U Choose<U>(T first, U second) => second;
        public T[] Vector(T value) => new[] { value };
    }
    public enum Empty { Zero }
}
