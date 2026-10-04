using System;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

[Serializable, StructLayout(LayoutKind.Explicit, Pack = 2, Size = 24, CharSet = CharSet.Unicode)]
public struct Layout
{
    [FieldOffset(0), NonSerialized] public int Number;
    [FieldOffset(8), MarshalAs(UnmanagedType.ByValTStr, SizeConst = 4)] public string Text;
}

[StructLayout(LayoutKind.Sequential, Pack = 4, Size = 16)]
public struct ArrayLayout
{
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3, ArraySubType = UnmanagedType.I2)] public short[] Values;
}

[ComImport, Guid("68D2B61F-50B6-4BA3-87CD-A4A6103BA4A0")]
public interface ICom
{
    [PreserveSig] int Fetch([In, Out] ref int value);
}

public static class Native
{
    [DllImport("libc.so.6", EntryPoint = "abs", CallingConvention = CallingConvention.Cdecl,
        CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true,
        BestFitMapping = false, ThrowOnUnmappableChar = true)]
    public static extern int Abs(int value);

    [DllImport("libc.so.6", EntryPoint = "unused", PreserveSig = false, CharSet = CharSet.Unicode,
        CallingConvention = CallingConvention.StdCall, BestFitMapping = true, ThrowOnUnmappableChar = false)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool Mapped([In, Out, MarshalAs(UnmanagedType.LPArray,
        ArraySubType = UnmanagedType.I4, SizeParamIndex = 1, SizeConst = 2)] int[] values, [Optional] int count);

    [DllImport("unused")]
    public static extern void Shapes(
        [MarshalAs(UnmanagedType.LPArray, SizeConst = 3)] int[] fixedCount,
        [MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 3)] int[] parameterCount,
        [MarshalAs(UnmanagedType.LPArray)] int[] unspecified,
        int count,
        [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_RECORD,
            SafeArrayUserDefinedSubType = typeof(Layout))] object records,
        [MarshalAs(UnmanagedType.CustomMarshaler, MarshalType = "Example.Marshal, Example", MarshalCookie = "ą-cookie")] object custom);

    [SpecialName, MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.NoOptimization)]
    public static int Managed() { return 5; }
}

public static class Program
{
    private static MarshalAsAttribute MarshalOf(ICustomAttributeProvider provider)
    {
        return (MarshalAsAttribute)provider.GetCustomAttributes(typeof(MarshalAsAttribute), false)[0];
    }

    private static void DumpMarshal(MarshalAsAttribute attribute)
    {
        Console.WriteLine((int)attribute.Value + ":" + (int)attribute.ArraySubType + ":" + attribute.SizeConst + ":" + attribute.SizeParamIndex);
        Console.WriteLine((int)attribute.SafeArraySubType + ":" + attribute.SafeArrayUserDefinedSubType);
        Console.WriteLine(attribute.MarshalType + ":" + attribute.MarshalCookie);
    }

    public static void Main()
    {
        Type layout = typeof(Layout);
        StructLayoutAttribute structure = layout.StructLayoutAttribute;
        Console.WriteLine(layout.IsSerializable + ":" + layout.IsExplicitLayout);
        Console.WriteLine((int)structure.Value + ":" + structure.Pack + ":" + structure.Size + ":" + (int)structure.CharSet);
        Console.WriteLine(Marshal.OffsetOf(typeof(Layout), "Text"));
        Console.WriteLine(layout.GetField("Number").IsNotSerialized);
        DumpMarshal(MarshalOf(layout.GetField("Text")));
        DumpMarshal(MarshalOf(typeof(ArrayLayout).GetField("Values")));
        Console.WriteLine(typeof(ICom).IsImport);
        Console.WriteLine((int)typeof(ICom).GetMethod("Fetch").GetMethodImplementationFlags());
        ParameterInfo comParameter = typeof(ICom).GetMethod("Fetch").GetParameters()[0];
        Console.WriteLine(comParameter.IsIn + ":" + comParameter.IsOut);
        foreach (string name in new string[] { "Abs", "Mapped" })
        {
            MethodInfo method = typeof(Native).GetMethod(name);
            DllImportAttribute import = (DllImportAttribute)Attribute.GetCustomAttribute(method, typeof(DllImportAttribute));
            Console.WriteLine(import.Value + ":" + import.EntryPoint + ":" + (int)import.CallingConvention + ":" + (int)import.CharSet);
            Console.WriteLine(import.ExactSpelling + ":" + import.SetLastError + ":" + import.BestFitMapping + ":"
                + import.ThrowOnUnmappableChar + ":" + import.PreserveSig);
        }
        MethodInfo mapped = typeof(Native).GetMethod("Mapped");
        DumpMarshal(MarshalOf(mapped.ReturnParameter));
        DumpMarshal(MarshalOf(mapped.GetParameters()[0]));
        Console.WriteLine(mapped.GetParameters()[0].IsIn + ":" + mapped.GetParameters()[0].IsOut + ":" + mapped.GetParameters()[1].IsOptional);
        foreach (ParameterInfo parameter in typeof(Native).GetMethod("Shapes").GetParameters())
            if (parameter.Name != "count") DumpMarshal(MarshalOf(parameter));
        MethodInfo managed = typeof(Native).GetMethod("Managed");
        Console.WriteLine(managed.IsSpecialName + ":" + (int)managed.GetMethodImplementationFlags());
        // The fixture's execution target is Linux; all preceding reflection assertions are platform independent.
        Console.WriteLine(Native.Abs(-12));
    }
}
