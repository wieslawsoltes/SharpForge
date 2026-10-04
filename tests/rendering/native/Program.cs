using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.UI.ViewManagement;

internal sealed record Fixture(string Id, string File, string Expected, double Width, double Height, double Dpr,
    string Theme, string XamlSha256, string Xaml, string? FocusTarget);
internal sealed record CaptureInput(int SchemaVersion, string Runtime, string InputHash, List<Fixture> Fixtures);

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 2) return 2;
        try
        {
            if (new FileInfo(args[0]).Length > 5 * 1024 * 1024) throw new InvalidDataException("SFNPIX010: Input byte budget exceeded");
            var input = JsonSerializer.Deserialize<CaptureInput>(File.ReadAllText(args[0]),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            Validate(input);
            if (!Directory.Exists(args[1]) || Directory.EnumerateFileSystemEntries(args[1]).Any())
                throw new InvalidDataException("SFNPIX010: Native output must be an existing empty attempt directory");
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("en-US");
            WinRT.ComWrappersSupport.InitializeComWrappers();
            Application.Start(initialization =>
            {
                SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
                _ = new CaptureApplication(input, Path.GetFullPath(args[1]));
            });
            return File.Exists(Path.Combine(args[1], "native.json")) ? 0 : 3;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }

    private static void Validate(CaptureInput input)
    {
        if (input == null || input.SchemaVersion != 1 || input.Fixtures == null || input.Fixtures.Count is < 1 or > 128 ||
            input.Fixtures.Select(fixture => fixture.Id).Distinct().Count() != input.Fixtures.Count ||
            !Regex.IsMatch(input.InputHash ?? "", "^[a-f0-9]{64}$") || Environment.Version.ToString() != input.Runtime)
            throw new InvalidDataException("SFNPIX010: Native identity, runtime, or fixture count mismatch");
        long totalBytes = 0, totalPixels = 0;
        foreach (var fixture in input.Fixtures)
        {
            if (!Regex.IsMatch(fixture.Id ?? "", "^native-xaml-[a-z0-9-]{1,78}$") ||
                fixture.Expected is not ("pixels" or "load-error") || fixture.Theme is not ("Light" or "Dark") ||
                fixture.FocusTarget != null && !Regex.IsMatch(fixture.FocusTarget, "^[A-Za-z_][A-Za-z0-9_]{0,79}$"))
                throw new InvalidDataException("SFNPIX010: Invalid native fixture");
            var bytes = Encoding.UTF8.GetBytes(fixture.Xaml);
            if (bytes.Length > 256 * 1024 || Convert.ToHexStringLower(SHA256.HashData(bytes)) != fixture.XamlSha256)
                throw new InvalidDataException("SFNPIX010: Native XAML hash or byte budget mismatch");
            var dimensions = NativeCapture.Dimensions(fixture);
            totalBytes += bytes.Length;
            totalPixels += (long)dimensions.Width * dimensions.Height;
        }
        if (totalBytes > 4 * 1024 * 1024 || totalPixels > 16 * 1024 * 1024)
            throw new InvalidDataException("SFNPIX010: Native aggregate capture budget exceeded");
    }
}

internal sealed class CaptureApplication : Application
{
    private readonly CaptureInput input;
    private readonly string output;
    private Window? window;

    internal CaptureApplication(CaptureInput input, string output)
    {
        this.input = input;
        this.output = output;
        RequestedTheme = ApplicationTheme.Light;
        Resources.MergedDictionaries.Add(new XamlControlsResources());
        UnhandledException += (_, args) => { Console.Error.WriteLine(args.Exception); Environment.Exit(1); };
    }

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            window = new Window { Title = "SharpForge native XAML pixel oracle", Content = new Grid() };
            window.Activate();
            var capture = new NativeCapture(window, output);
            var observations = new List<object>();
            foreach (var fixture in input.Fixtures) observations.Add(await capture.Capture(fixture));
            var settings = new UISettings();
            var accent = settings.GetColorValue(UIColorType.Accent);
            var result = new
            {
                schemaVersion = 1, inputHash = input.InputHash, runtime = Environment.Version.ToString(), culture = CultureInfo.CurrentCulture.Name,
                toolVersion = typeof(Application).Assembly.GetName().Version?.ToString(),
                operatingSystem = new { description = RuntimeInformation.OSDescription, version = Environment.OSVersion.VersionString,
                    architecture = RuntimeInformation.OSArchitecture.ToString() },
                environment = new { highContrast = new AccessibilitySettings().HighContrast, textScaleFactor = settings.TextScaleFactor,
                    animationsEnabled = settings.AnimationsEnabled, installedFontFiles = FontFiles(),
                    accentRgba = new[] { (int)accent.R, (int)accent.G, (int)accent.B, (int)accent.A },
                    fontObservation = "Requested Segoe UI and installed file hashes; resolved fallback glyph faces are not inspected",
                    backendObservation = "Native WinUI RenderTargetBitmap; physical adapter is not inspected" },
                stabilityPolicy = new { consecutiveCaptures = 3, maximumRenderingTurns = 120 }, observations
            };
            File.WriteAllText(Path.Combine(output, "native.json"), JsonSerializer.Serialize(result));
            window.Close();
            window = null;
            Exit();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            window?.Close();
            Environment.Exit(1);
        }
    }

    private static List<object> FontFiles()
    {
        var result = new List<object>();
        foreach (var name in new[] { "segoeui.ttf", "segoeuib.ttf", "seguisym.ttf", "seguiemj.ttf" })
        {
            var file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), name);
            if (!File.Exists(file)) { result.Add(new { name, available = false }); continue; }
            if (new FileInfo(file).Length > 32 * 1024 * 1024) throw new InvalidDataException("SFNPIX010: Font provenance byte budget exceeded");
            result.Add(new { name, available = true, sha256 = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(file))) });
        }
        return result;
    }
}
