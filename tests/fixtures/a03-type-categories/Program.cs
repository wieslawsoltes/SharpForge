using System;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Text.Json;

interface IContract { }
class Parent { }
class Child : Parent, IContract { }
struct Value { public int Number; }
enum Choice { First, Second }
class Outer { public class Nested : Parent { } }

static class Program
{
    static object Describe(Type type) => new {
        token = type.MetadataToken,
        name = type.FullName,
        category = type.IsEnum ? "enum" : type.IsValueType ? "value" : "reference"
    };

    static void Main()
    {
        var core = typeof(object).Module;
        var input = typeof(Program).Module;
        using var stream = File.OpenRead(input.Assembly.Location);
        using var pe = new PEReader(stream);
        var metadata = pe.GetMetadataReader();
        var tokens = metadata.TypeReferences.Select(handle => MetadataTokens.GetToken(handle));
        var bindings = tokens.Select(token => {
            var type = input.ResolveType(token);
            return new { token, definition = type.Module == core && !type.IsGenericType ? (int?)type.MetadataToken : null };
        }).ToArray();
        Type[] coreTypes = { typeof(object), typeof(ValueType), typeof(Enum), typeof(string),
            typeof(int), typeof(DayOfWeek), typeof(IDisposable) };
        Type[] localTypes = { typeof(Parent), typeof(Child), typeof(Value), typeof(Choice),
            typeof(IContract), typeof(Outer), typeof(Outer.Nested) };
        Console.Write(JsonSerializer.Serialize(new {
            runtime = Environment.Version.ToString(), corePath = core.Assembly.Location,
            coreMvid = core.ModuleVersionId, inputMvid = input.ModuleVersionId,
            roots = new { objectType = typeof(object).MetadataToken, valueType = typeof(ValueType).MetadataToken,
                enumType = typeof(Enum).MetadataToken },
            coreTypes = coreTypes.Select(Describe), localTypes = localTypes.Select(Describe), bindings
        }));
    }
}
