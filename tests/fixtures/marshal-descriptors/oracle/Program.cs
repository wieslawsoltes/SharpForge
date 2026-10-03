using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Text.Json;

[StructLayout(LayoutKind.Sequential)]
public struct Fields
{
    [MarshalAs(UnmanagedType.Bool)] public bool Flag;
    [MarshalAs(UnmanagedType.LPStr)] public string Text;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 130)] public string FixedText;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 5, ArraySubType = UnmanagedType.I2)] public short[] Numbers;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 7)] public byte[] DefaultNumbers;
    [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_I4)] public int[] SafeNumbers;
}

public static class Native
{
    [DllImport("never-loaded")]
    public static extern void ArrayBoth([MarshalAs(UnmanagedType.LPArray, ArraySubType = UnmanagedType.I4,
        SizeParamIndex = 1, SizeConst = 4)] int[] values, int count);
    [DllImport("never-loaded")]
    public static extern void ArrayParameter([MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] int[] values, int count);
    [DllImport("never-loaded")]
    public static extern void ArrayConstant([MarshalAs(UnmanagedType.LPArray, SizeConst = 20000)] int[] values);
    [DllImport("never-loaded")]
    public static extern void ArrayDefault([MarshalAs(UnmanagedType.LPArray)] int[] values);
    [DllImport("never-loaded")]
    public static extern void Interface([MarshalAs(UnmanagedType.Interface, IidParameterIndex = 1)] object value, int iid);
    [DllImport("never-loaded")]
    public static extern void Custom([MarshalAs(UnmanagedType.CustomMarshaler,
        MarshalType = "Example.Marshaler", MarshalCookie = "café")] object value);
    [DllImport("never-loaded")]
    public static extern void SafeRecord([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_RECORD,
        SafeArrayUserDefinedSubType = typeof(Fields))] Fields[] values);
    [DllImport("never-loaded")]
    [return: MarshalAs(UnmanagedType.I4)]
    public static extern int ReturnValue();
}

public static class Program
{
    public static void Main()
    {
        using var pe = new PEReader(File.OpenRead(typeof(Program).Assembly.Location));
        var metadata = pe.GetMetadataReader();
        var records = new List<object>();
        void Add(string name, BlobHandle blob, MarshalAsAttribute attribute)
        {
            records.Add(new {
                name, blob = Convert.ToHexString(metadata.GetBlobBytes(blob)), type = (int)attribute.Value,
                elementType = (int)attribute.ArraySubType, sizeConstant = attribute.SizeConst,
                sizeParameterIndex = attribute.SizeParamIndex, iidParameterIndex = attribute.IidParameterIndex,
                variantType = (int)attribute.SafeArraySubType,
                userDefinedType = attribute.SafeArrayUserDefinedSubType?.AssemblyQualifiedName,
                managedTypeName = attribute.MarshalType, cookie = attribute.MarshalCookie
            });
        }
        foreach (var field in typeof(Fields).GetFields())
        {
            var handle = MetadataTokens.FieldDefinitionHandle(field.MetadataToken & 0xffffff);
            Add(field.Name, metadata.GetFieldDefinition(handle).GetMarshallingDescriptor(), field.GetCustomAttribute<MarshalAsAttribute>()!);
        }
        foreach (var method in typeof(Native).GetMethods(BindingFlags.Public | BindingFlags.Static))
        {
            foreach (var parameter in method.GetParameters().Prepend(method.ReturnParameter))
            {
                var attribute = parameter.GetCustomAttribute<MarshalAsAttribute>();
                if (attribute is null) continue;
                var handle = MetadataTokens.ParameterHandle(parameter.MetadataToken & 0xffffff);
                Add(method.Name, metadata.GetParameter(handle).GetMarshallingDescriptor(), attribute);
            }
        }
        Console.WriteLine(JsonSerializer.Serialize(new { runtime = Environment.Version.ToString(), records }));
    }
}
