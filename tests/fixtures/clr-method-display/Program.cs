using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;

class Program
{
    static void Main()
    {
        const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Static |
            BindingFlags.Public | BindingFlags.NonPublic;
        var methods = typeof(Fixture.Methods).Assembly.GetTypes().Where(type => type.Namespace == "Fixture")
            .SelectMany(type => type.GetMethods(flags).Cast<MethodBase>().Concat(type.GetConstructors(flags)))
            .OrderBy(method => method.MetadataToken);
        var records = methods.Select(method => new { token = method.MetadataToken, name = method.Name,
            owner = method.DeclaringType.FullName, text = method.ToString() });
        Console.Write(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), records }));
    }
}
namespace Fixture
{
    public class Payload { }
    public class Methods
    {
        static Methods() { }
        public Methods() { }
        public Methods(int value, string text) { }
        public int Primitive(string value, object other, bool flag) => 1;
        public Payload Named(Payload value) => value;
        public int[] Arrays(int[,] matrix, string[][] text) => null;
        public void ByRef(ref int value, out string text) { text = ""; }
        public ref readonly int ReadOnly(in int value) => ref value;
        public List<int> Constructed(Dictionary<string, List<int[]>> value) => null;
        public T Generic<T>(T value) => value;
        public U Multiple<T, U>(T value, U other) => other;
        public void Vararg(int value, __arglist) { }
        public Inner Nested(Inner value, Inner[] values) => value;
        public class Inner { }
    }
    public class GenericOwner<T>
    {
        public GenericOwner(T value) { }
        public T Echo(T value) => value;
        public U Combine<U>(T value, U other) => other;
    }
}
