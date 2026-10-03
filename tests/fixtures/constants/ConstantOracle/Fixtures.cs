public static class Constants
{
    public const bool Boolean = true;
    public const char Character = '\ud800';
    public const sbyte SignedByte = sbyte.MinValue;
    public const byte Byte = byte.MaxValue;
    public const short SignedShort = short.MinValue;
    public const ushort Short = ushort.MaxValue;
    public const int SignedInt = int.MinValue;
    public const uint Int = uint.MaxValue;
    public const long SignedLong = long.MinValue;
    public const ulong Long = ulong.MaxValue;
    public const float Single = float.PositiveInfinity;
    public const double Double = double.NegativeInfinity;
    public const double NaN = double.NaN;
    public const double NegativeZero = -0d;
    public const string Text = "\ufeffab\0空\ud800x\udfff";
    public const string Empty = "";
    public const string? NullString = null;
    public const object? NullObject = null;
    public const SignedEnum Enumeration = SignedEnum.Minimum;
    public static void Optional(int number = -42, char letter = '空', string? text = null, object? value = null) { }
}
public enum SignedEnum : long { Minimum = long.MinValue }
