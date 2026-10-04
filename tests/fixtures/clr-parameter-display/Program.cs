using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;

class Program
{
    static void Main()
    {
        const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public;
        var records = new List<object>();
        void Record(ParameterInfo parameter, MemberInfo member, string kind)
        {
            records.Add(new { token = member.MetadataToken, kind, name = member.Name,
                position = parameter.Position, parameterName = parameter.Name, text = parameter.ToString() });
        }
        foreach (var method in typeof(Fixture.Methods).GetMethods(flags).Where(method => !method.IsSpecialName))
        {
            Record(method.ReturnParameter, method, "method");
            foreach (var parameter in method.GetParameters()) Record(parameter, method, "method");
        }
        foreach (var constructor in typeof(Fixture.Methods).GetConstructors(flags))
            foreach (var parameter in constructor.GetParameters()) Record(parameter, constructor, "constructor");
        foreach (var property in typeof(Fixture.Methods).GetProperties(flags))
            foreach (var parameter in property.GetIndexParameters()) Record(parameter, property, "property");
        Console.Write(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), records }));
    }
}
namespace Fixture
{
    public class Box<T> { }
    public class Outer<T> { public class Inner<U> { } }
    public class Methods
    {
        public Methods(string name) { }
        [return: MarshalAs(UnmanagedType.I4)]
        public int Scalars(int count, string name, object value) => count;
        public int ByRef(ref int count, in string text, out object output) { output = text; return count; }
        public T Generic<T>(T value, Dictionary<string, T[]> boxes) => value;
        public Box<Outer<int>.Inner<string>> Nested(Box<Outer<int>.Inner<string>> value) => value;
        public int this[int index, string text] => index;
    }
}
