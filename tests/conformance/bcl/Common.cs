using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;

static partial class Oracle
{
    static string Family;
    static string Culture;
    static void Begin(string family)
    {
        Culture = Environment.GetEnvironmentVariable("SHARPFORGE_BCL_CULTURE");
        if (Culture != "invariant" && Culture != "fr-FR") throw new InvalidOperationException("Explicit BCL oracle culture required");
        var culture = Culture == "invariant" ? CultureInfo.InvariantCulture : CultureInfo.GetCultureInfo(Culture);
        CultureInfo.CurrentCulture = culture;
        CultureInfo.CurrentUICulture = culture;
        Family = family;
    }
    static string Canonical(object value) => value switch
    {
        null => null,
        string text => text,
        bool flag => flag ? "true" : "false",
        double number => number.ToString("R", CultureInfo.InvariantCulture),
        float number => number.ToString("R", CultureInfo.InvariantCulture),
        DateTime date => date.ToString("O", CultureInfo.InvariantCulture),
        DateTimeOffset date => date.ToString("O", CultureInfo.InvariantCulture),
        TimeSpan duration => duration.ToString("c", CultureInfo.InvariantCulture),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString()
    };
    static void Case(string id, Func<object> operation)
    {
        string value = null, exception = null;
        try { value = Canonical(operation()); }
        catch (Exception error) { exception = error.GetType().FullName; }
        Console.WriteLine(JsonSerializer.Serialize(new { id, family = Family, culture = Culture,
            status = exception == null ? "returned" : "exception", value, exception }));
    }
}
