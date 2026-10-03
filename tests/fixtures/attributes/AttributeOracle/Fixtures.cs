using System;

namespace AttributeFixture;

public enum Signed : long { Low = long.MinValue, High = long.MaxValue }
public enum Unsigned : ulong { High = ulong.MaxValue }

[AttributeUsage(AttributeTargets.Class, AllowMultiple = true)]
public sealed class PayloadAttribute : Attribute
{
    public object?[] Values { get; }
    public string? Field;
    public object? Boxed { get; set; }
    public Type? Target { get; set; }
    public Signed EnumValue { get; set; }
    public string?[]? Strings { get; set; }
    public PayloadAttribute(bool boolean, char character, sbyte i1, byte u1, short i2, ushort u2,
        int i4, uint u4, long i8, ulong u8, float r4, double r8, string? text, Type? type,
        Signed enumeration, int[]? array, object? boxed)
    {
        Values = [boolean, character, i1, u1, i2, u2, i4, u4, i8, u8, r4, r8, text, type, enumeration, array, boxed];
    }
}

[Payload(true, 'Ω', sbyte.MinValue, byte.MaxValue, short.MinValue, ushort.MaxValue,
    int.MinValue, uint.MaxValue, long.MinValue, ulong.MaxValue, 1.25f, -0.0d, "héllo😀", typeof(string),
    Signed.High, new int[] { 0, -1, int.MaxValue }, (byte)255,
    Field = "named", Boxed = new object[] { "box", 42, Unsigned.High, typeof(int), null },
    Target = typeof(PayloadAttribute), EnumValue = Signed.Low, Strings = new string?[] { "", null, "✓" })]
public class CaseFull { }

[Payload(false, '\uffff', 0, 0, 0, 0, 0, 0, 0, 0, float.NaN, double.PositiveInfinity, null, null,
    Signed.Low, null, null, Field = null, Boxed = null, Target = null, Strings = null)]
public class CaseNull { }

[Payload(true, '\0', sbyte.MaxValue, 0, short.MaxValue, 0, int.MaxValue, 0, long.MaxValue, 0,
    float.NegativeInfinity, double.NaN, "", typeof(int[]), Signed.Low, new int[] {}, "text",
    Boxed = new byte[] { 0, 255 }, Field = "")]
public class CaseBoxed { }
