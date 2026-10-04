using System;
using System.Linq;
using System.Text.Json;

interface IRoot { }
interface IChild : IRoot { }
interface IUnrelated { }
class Parent { }
class Left : Parent, IChild { }
class Right : Parent { }
class Open<T> { }

static class Program
{
    static void Main()
    {
        Type[] types = { typeof(IRoot), typeof(IChild), typeof(IUnrelated), typeof(Parent), typeof(Left), typeof(Right) };
        var pairs = from source in types from target in types
            select new { source = source.MetadataToken, target = target.MetadataToken,
                assignable = target.IsAssignableFrom(source) };
        Console.Write(JsonSerializer.Serialize(new {
            runtime = Environment.Version.ToString(),
            types = types.Select(type => new { token = type.MetadataToken, name = type.FullName,
                baseToken = type.BaseType?.Assembly == type.Assembly ? type.BaseType.MetadataToken : (int?)null }),
            pairs
        }));
    }
}
