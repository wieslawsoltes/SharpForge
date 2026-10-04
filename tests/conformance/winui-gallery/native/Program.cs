using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Markup;

internal static class Program
{
    internal static string Input = "";
    internal static string Output = "";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 2) return 2;
        Input = args[0];
        Output = args[1];
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        if (Environment.Version.ToString() != "10.0.5") throw new InvalidOperationException("Runtime pin drift");
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(_args =>
        {
            SynchronizationContext.SetSynchronizationContext(
                new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
            _ = new GalleryApplication();
        });
        return File.Exists(Output) ? 0 : 3;
    }
}

internal sealed class GalleryApplication : Application
{
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(Program.Input, "fixtures.json")));
            var rows = new List<object>();
            foreach (var fixture in manifest.RootElement.GetProperty("cases").EnumerateArray())
            {
                var id = fixture.GetProperty("id").GetString()!;
                var xaml = Observe(fixture, () => (FrameworkElement)XamlReader.Load(
                    File.ReadAllText(Path.Combine(Program.Input, fixture.GetProperty("xaml").GetString()!))));
                object? csharp = null;
                if (fixture.TryGetProperty("className", out var name))
                {
                    csharp = Observe(fixture, () => (FrameworkElement)Assembly.GetExecutingAssembly()
                        .GetType(name.GetString()!, true)!.GetMethod("Create")!.Invoke(null, null)!);
                }
                rows.Add(new { id, xaml, csharp });
            }
            File.WriteAllText(Program.Output, JsonSerializer.Serialize(rows));
            Exit();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            Environment.Exit(1);
        }
    }

    private static object Observe(JsonElement fixture, Func<FrameworkElement> create)
    {
        try
        {
            var control = create();
            var properties = new Dictionary<string, object?>();
            foreach (var property in fixture.GetProperty("properties").EnumerateArray())
            {
                string name = property.GetString()!;
                properties.Add(name, control.GetType().GetProperty(name)!.GetValue(control));
            }
            return new { rejected = false, properties };
        }
        catch (Exception error)
        {
            while (error is TargetInvocationException && error.InnerException != null) error = error.InnerException;
            return new { rejected = true, exception = error.GetType().FullName };
        }
    }
}
