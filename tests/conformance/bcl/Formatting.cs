static partial class Oracle
{
    public static void Main()
    {
        Begin("formatting");
        Case("formatting-integer-decimal", () => 42.ToString("D", CultureInfo.CurrentCulture));
        Case("formatting-integer-zero-padding", () => 42.ToString("D6", CultureInfo.CurrentCulture));
        Case("formatting-integer-negative-padding", () => (-42).ToString("D6", CultureInfo.CurrentCulture));
        Case("formatting-integer-hex", () => 255.ToString("X4", CultureInfo.CurrentCulture));
        Case("formatting-integer-negative-hex", () => (-1).ToString("x8", CultureInfo.InvariantCulture));
        Case("formatting-integer-number-culture", () => 1234567.ToString("N2", CultureInfo.CurrentCulture));
        Case("formatting-integer-minimum", () => int.MinValue.ToString(CultureInfo.CurrentCulture));
        Case("formatting-integer-invalid-specifier", () => 42.ToString("Q", CultureInfo.InvariantCulture));
        Case("formatting-double-fixed-culture", () => 1234.5.ToString("F2", CultureInfo.CurrentCulture));
        Case("formatting-double-number-culture", () => 1234.5.ToString("N3", CultureInfo.CurrentCulture));
        Case("formatting-double-exponent", () => 1234.5.ToString("E3", CultureInfo.InvariantCulture));
        Case("formatting-double-roundtrip", () => (1.0 / 3.0).ToString("R", CultureInfo.InvariantCulture));
        Case("formatting-double-negative-zero", () => (-0.0).ToString("R", CultureInfo.InvariantCulture));
        Case("formatting-double-nan", () => double.NaN.ToString("G", CultureInfo.InvariantCulture));
        Case("formatting-double-infinity", () => double.PositiveInfinity.ToString("G", CultureInfo.InvariantCulture));
        Case("formatting-double-negative-infinity", () => double.NegativeInfinity.ToString("G", CultureInfo.InvariantCulture));
        Case("formatting-single-roundtrip", () => 0.1f.ToString("R", CultureInfo.InvariantCulture));
        Case("formatting-decimal-scale", () => 1.2300m.ToString("G", CultureInfo.InvariantCulture));
        Case("formatting-decimal-currency-culture", () => 1234.5m.ToString("C2", CultureInfo.CurrentCulture));
        Case("formatting-decimal-percent-culture", () => 0.125m.ToString("P1", CultureInfo.CurrentCulture));
        Case("formatting-custom-positive-section", () => 12.5m.ToString("0.0;[0.0];zero", CultureInfo.CurrentCulture));
        Case("formatting-custom-negative-section", () => (-12.5m).ToString("0.0;[0.0];zero", CultureInfo.CurrentCulture));
        Case("formatting-custom-zero-section", () => 0m.ToString("0.0;[0.0];zero", CultureInfo.CurrentCulture));
        Case("formatting-composite-alignment", () => string.Format(CultureInfo.CurrentCulture, "[{0,5:D3}]", 12));
        Case("formatting-composite-left-alignment", () => string.Format(CultureInfo.CurrentCulture, "[{0,-5}]", "x"));
        Case("formatting-composite-escaped-braces", () => string.Format(CultureInfo.InvariantCulture, "{{{0}}}", 42));
        Case("formatting-composite-null-argument", () => string.Format(CultureInfo.CurrentCulture, "a{0}b", (object)null));
        Case("formatting-composite-missing-argument", () => string.Format(CultureInfo.InvariantCulture, "{1}", 42));
        Case("formatting-composite-unclosed-brace", () => string.Format(CultureInfo.InvariantCulture, "{0", 42));
        Case("formatting-composite-null-format", () => string.Format(CultureInfo.InvariantCulture, (string)null, 42));
        Case("formatting-parse-int-signed", () => int.Parse(" +42 ", NumberStyles.Integer, CultureInfo.InvariantCulture));
        Case("formatting-parse-int-hex", () => int.Parse("7FFFFFFF", NumberStyles.HexNumber, CultureInfo.InvariantCulture));
        Case("formatting-parse-int-overflow", () => int.Parse("2147483648", CultureInfo.InvariantCulture));
        Case("formatting-parse-int-invalid", () => int.Parse("no-number", CultureInfo.CurrentCulture));
        Case("formatting-parse-int-empty", () => int.Parse("", CultureInfo.CurrentCulture));
        Case("formatting-try-parse-int-empty", () => int.TryParse("", out int value) + "|" + value);
        Case("formatting-parse-decimal-culture-roundtrip", () => decimal.Parse(1234.5m.ToString(CultureInfo.CurrentCulture), CultureInfo.CurrentCulture));
        Case("formatting-parse-double-exponent", () => double.Parse("1.25e3", NumberStyles.Float, CultureInfo.InvariantCulture));
        Case("formatting-guid-lowercase", () => new Guid("00112233-4455-6677-8899-aabbccddeeff").ToString("D"));
        Case("formatting-builder-composite-culture", () => new StringBuilder().AppendFormat(CultureInfo.CurrentCulture, "{0:N2}|{1:D3}", 1234.5m, 7).ToString());
    }
}
