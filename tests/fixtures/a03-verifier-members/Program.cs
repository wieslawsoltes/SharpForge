using System;
using System.Linq;
using System.Reflection;
using System.Text.Json;

static class Program
{
    static void Main()
    {
        var module = Assembly.Load(Convert.FromBase64String("ASSEMBLY_BASE64")).ManifestModule;
        int[] tokens = { MEMBER_TOKENS };
        var members = tokens.Select(token => {
            var member = module.ResolveMember(token);
            return new { token, definition = member.MetadataToken, owner = member.DeclaringType.MetadataToken,
                name = member.Name, kind = member is FieldInfo ? "field" : "method",
                flags = member is FieldInfo field ? (int)field.Attributes : (int)((MethodBase)member).Attributes };
        });
        Console.Write(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), members }));
    }
}
