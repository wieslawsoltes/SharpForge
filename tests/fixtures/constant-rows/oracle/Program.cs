using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

using var stream = File.OpenRead(args[0]);
using var pe = new PEReader(stream);
var metadata = pe.GetMetadataReader();
var rows = new List<object>();
for (var index = 1; index <= metadata.GetTableRowCount(TableIndex.Constant); index++)
{
    var handle = MetadataTokens.ConstantHandle(index);
    var constant = metadata.GetConstant(handle);
    var parent = constant.Parent;
    var (flags, defaultHandle) = parent.Kind switch
    {
        HandleKind.FieldDefinition => ((int)metadata.GetFieldDefinition((FieldDefinitionHandle)parent).Attributes,
            metadata.GetFieldDefinition((FieldDefinitionHandle)parent).GetDefaultValue()),
        HandleKind.Parameter => ((int)metadata.GetParameter((ParameterHandle)parent).Attributes,
            metadata.GetParameter((ParameterHandle)parent).GetDefaultValue()),
        HandleKind.PropertyDefinition => ((int)metadata.GetPropertyDefinition((PropertyDefinitionHandle)parent).Attributes,
            metadata.GetPropertyDefinition((PropertyDefinitionHandle)parent).GetDefaultValue()),
        _ => throw new InvalidOperationException("Unexpected Constant parent")
    };
    if (defaultHandle != handle) throw new InvalidOperationException("Default lookup selected a different Constant row");
    var reader = metadata.GetBlobReader(constant.Value);
    rows.Add(new { parent = MetadataTokens.GetToken(parent), flags, type = (int)constant.TypeCode,
        blob = Convert.ToHexString(metadata.GetBlobBytes(constant.Value)), value = reader.ReadConstant(constant.TypeCode) });
}
Console.WriteLine(JsonSerializer.Serialize(new { runtime = RuntimeInformation.FrameworkDescription, rows },
    new JsonSerializerOptions { WriteIndented = true }));
