using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;
namespace NativeHierarchy;
public class Derived : Base, IChild { }
public class Further : Derived { }
public class NestedDerived : Outer.Inner { }
static class Program
{
    static object Identity(Type type) => type == null ? null : new {
        name = type.FullName, token = type.MetadataToken, mvid = type.Module.ModuleVersionId.ToString(),
        assembly = type.Assembly.GetName().Name
    };
    static void Main()
    {
        var assemblies = new[] { typeof(Base).Assembly, typeof(Derived).Assembly };
        var types = assemblies.SelectMany(assembly => assembly.GetTypes()).Where(type => type.IsPublic || type.IsNestedPublic);
        Console.Write(JsonSerializer.Serialize(new {
            runtime = Environment.Version.ToString(),
            definitions = types.Select(type => new {
                identity = Identity(type), isInterface = type.IsInterface, baseType = Identity(type.BaseType),
                interfaces = type.GetInterfaces().Select(Identity).ToArray()
            }).ToArray()
        }));
    }
}
