using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Windows.UI.ViewManagement;

// Native observations only: the Windows implementation supplies every ramp entry.
internal static class AccentPalette
{
    internal static object Capture(Application application)
    {
        var settings = new UISettings();
        var colors = new Dictionary<string, string>
        {
            ["SystemAccentColor"] = Read(settings, UIColorType.Accent),
            ["SystemAccentColorLight1"] = Read(settings, UIColorType.AccentLight1),
            ["SystemAccentColorLight2"] = Read(settings, UIColorType.AccentLight2),
            ["SystemAccentColorLight3"] = Read(settings, UIColorType.AccentLight3),
            ["SystemAccentColorDark1"] = Read(settings, UIColorType.AccentDark1),
            ["SystemAccentColorDark2"] = Read(settings, UIColorType.AccentDark2),
            ["SystemAccentColorDark3"] = Read(settings, UIColorType.AccentDark3),
        };
        return new
        {
            schemaVersion = 1,
            source = "Windows.UI.ViewManagement.UISettings.GetColorValue",
            colors,
            environment = new
            {
                osVersion = Environment.OSVersion.Version.ToString(),
                osArchitecture = RuntimeInformation.OSArchitecture.ToString(),
                processArchitecture = RuntimeInformation.ProcessArchitecture.ToString(),
                runtimeVersion = Environment.Version.ToString(),
                winuiAssembly = typeof(Application).Assembly.FullName,
                applicationTheme = application.RequestedTheme.ToString(),
                highContrast = new AccessibilitySettings().HighContrast,
            },
        };
    }

    private static string Read(UISettings settings, UIColorType type)
    {
        var color = settings.GetColorValue(type);
        return $"#{color.A:X2}{color.R:X2}{color.G:X2}{color.B:X2}";
    }
}
