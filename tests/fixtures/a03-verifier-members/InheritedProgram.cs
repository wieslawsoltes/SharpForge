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
            try {
                var member = module.ResolveMember(token);
                return new { token, success = true, definition = member.MetadataToken,
                    owner = member.DeclaringType.MetadataToken, name = member.Name,
                    kind = member is FieldInfo ? "field" : "method",
                    flags = member is FieldInfo field ? (int)field.Attributes : (int)((MethodBase)member).Attributes,
                    error = "" };
            } catch (Exception error) when (error is MissingMemberException || error is ArgumentOutOfRangeException) {
                return new { token, success = false, definition = 0, owner = 0, name = "", kind = "", flags = 0,
                    error = error.GetType().Name };
            }
        });
        Console.Write(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), members }));
    }
}
