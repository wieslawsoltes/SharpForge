using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;

class Program
{
    static void Main()
    {
        const BindingFlags flags = BindingFlags.DeclaredOnly | BindingFlags.Instance | BindingFlags.Public;
        var records = typeof(Fixture.Methods).GetMethods(flags).OrderBy(method => method.MetadataToken)
            .Select(method => new { token = method.MetadataToken, name = method.Name,
                owner = method.DeclaringType.FullName, text = method.ToString() });
        Console.Write(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), records }));
    }
}
namespace Fixture
{
    public class Box<T> { }
    public class Pair<T, U> { }
    public class Outer { public class Inner { } }
    public class Outer<T>
    {
        public class Inherited { }
        public class Inner<U> { public class Deep<V> { } }
    }
    public class Methods
    {
        public Box<Outer.Inner> Named(Box<Outer.Inner> value) => value;
        public Box<Outer<int>.Inherited> Inherited(Box<Outer<int>.Inherited> value) => value;
        public Box<Outer<int>.Inner<string>> Constructed(Box<Outer<int>.Inner<string>> value) => value;
        public Pair<string, Outer<int>.Inner<string>[]> Array(Pair<string, Outer<int>.Inner<string>[]> value) => value;
        public Box<Outer<int>.Inner<string>.Deep<object>> Deep(Box<Outer<int>.Inner<string>.Deep<object>> value) => value;
        public Box<Environment.SpecialFolder> External(Box<Environment.SpecialFolder> value) => value;
        public Box<List<int>.Enumerator> ExternalGeneric(Box<List<int>.Enumerator> value) => value;
        public Outer<int>.Inner<string> Outermost(Outer<int>.Inner<string> value) => value;
    }
}
