using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;

static class Program
{
    static void Main()
    {
        var module = Assembly.Load(Convert.FromBase64String("ASSEMBLY_BASE64")).ManifestModule;
        int[] tokens = { TYPE_TOKENS };
        var types = tokens.Select(token => {
            try {
                var type = module.ResolveType(token);
                return new { token, success = true, definition = type.MetadataToken,
                    local = type.Module == module, name = type.FullName, generic = type.IsGenericTypeDefinition,
                    baseToken = type.BaseType?.Module == module ? type.BaseType.MetadataToken : (int?)null,
                    interfaces = type.GetInterfaces().Select(value => value.MetadataToken).ToArray(),
                    error = "" };
            } catch (Exception error) {
                return new { token, success = false, definition = 0, local = false, name = (string)null,
                    generic = false, baseToken = (int?)null, interfaces = Array.Empty<int>(),
                    error = error.GetType().Name };
            }
        });
        Console.Write(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), types }));
    }
}
