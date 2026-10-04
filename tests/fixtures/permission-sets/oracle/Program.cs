using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Text.Json;

const string securityType = "System.Security.Permissions.SecurityPermissionAttribute, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089";
var security = new BlobBuilder();
new BlobEncoder(security).PermissionSetArguments(1).AddArgument(false,
    type => type.ScalarType().Boolean(), name => name.Name("Execution"), literal => literal.Scalar().Constant(true));
var custom = new BlobBuilder();
var arguments = new BlobEncoder(custom).PermissionSetArguments(2);
arguments.AddArgument(true, type => type.ScalarType().String(), name => name.Name("Label"),
    literal => literal.Scalar().Constant("café"));
arguments.AddArgument(false, type => type.ScalarType().Int32(), name => name.Name("Maximum"),
    literal => literal.Scalar().Constant(42));
var empty = new BlobBuilder();
new BlobEncoder(empty).PermissionSetBlob(0);
var single = new BlobBuilder();
new BlobEncoder(single).PermissionSetBlob(1).AddPermission(securityType, security);
var multiple = new BlobBuilder();
new BlobEncoder(multiple).PermissionSetBlob(2).AddPermission(securityType, security).AddPermission("Example.Permission", custom);
Console.WriteLine(JsonSerializer.Serialize(new {
    runtime = Environment.Version.ToString(),
    securityType,
    cases = new[] {
        new { name = "empty", blob = Convert.ToHexString(empty.ToArray()) },
        new { name = "security", blob = Convert.ToHexString(single.ToArray()) },
        new { name = "multiple", blob = Convert.ToHexString(multiple.ToArray()) }
    },
    expected = new[] {
        new { typeName = securityType, values = new object[] {
            new { name = "Execution", isField = false, type = "System.Boolean", value = (object)true }
        } },
        new { typeName = "Example.Permission", values = new object[] {
            new { name = "Label", isField = true, type = "System.String", value = (object)"café" },
            new { name = "Maximum", isField = false, type = "System.Int32", value = (object)42 }
        } }
    }
}));
