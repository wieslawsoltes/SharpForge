using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Windows.Foundation;
using Windows.Graphics;

internal sealed record Viewport(double Width, double Height);
internal sealed record Fixture(string Id, string Expected, Viewport Viewport, string Xaml);
internal sealed record Input(string Runtime, string InputHash, List<Fixture> Fixtures);
internal static class Program
{
    internal static Input Input = null!;
    internal static string Output = "";
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 2) return 2;
        try
        {
            Input = JsonSerializer.Deserialize<Input>(File.ReadAllText(args[0]), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
            if (Input == null || Input.Fixtures == null || Input.Fixtures.Count != 20 ||
                Input.Fixtures.Select(f => f.Id).Distinct().Count() != Input.Fixtures.Count) throw new InvalidDataException("Invalid measurement input");
            if (Environment.Version.ToString() != Input.Runtime) throw new InvalidOperationException("CoreCLR version drift: " + Environment.Version);
            Output = args[1];
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo("en-US");
            WinRT.ComWrappersSupport.InitializeComWrappers();
            Application.Start(initialization =>
            {
                SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
                _ = new MeasurementApplication();
            });
            return File.Exists(Output) ? 0 : 3;
        }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}

internal sealed class MeasurementApplication : Application
{
    private Window window = null!;
    internal MeasurementApplication()
    {
        RequestedTheme = ApplicationTheme.Light;
        Resources.MergedDictionaries.Add(new XamlControlsResources());
        UnhandledException += (_, args) => { Console.Error.WriteLine(args.Exception); Environment.Exit(1); };
    }
    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            window = new Window { Title = "SharpForge WinUI measurement oracle" };
            window.Content = new Grid();
            window.Activate();
            var observations = new List<object>();
            foreach (var fixture in Program.Input.Fixtures) observations.Add(await Measure(fixture));
            File.WriteAllText(Program.Output, JsonSerializer.Serialize(new
            {
                schemaVersion = 1, inputHash = Program.Input.InputHash, runtime = Environment.Version.ToString(), culture = CultureInfo.CurrentCulture.Name,
                theme = RequestedTheme.ToString(), winuiAssemblyVersion = typeof(Application).Assembly.GetName().Version?.ToString(),
                observations
            }));
            window.Close();
            Exit();
        }
        catch (Exception error) { Console.Error.WriteLine(error); Environment.Exit(1); }
    }
    private async Task<object> Measure(Fixture fixture)
    {
        var size = fixture.Viewport;
        if (!double.IsFinite(size.Width) || !double.IsFinite(size.Height) || size.Width is < 1 or > 2048 || size.Height is < 1 or > 2048)
            throw new InvalidDataException("Invalid viewport: " + fixture.Id);
        object content;
        try { content = XamlReader.Load(fixture.Xaml); }
        catch (Exception error)
        {
            if (fixture.Expected != "load-error") throw;
            return new { id = fixture.Id, status = "load-error", exception = error.GetType().FullName, hresult = error.HResult };
        }
        if (fixture.Expected != "loaded") throw new InvalidOperationException("Expected XAML failure did not occur: " + fixture.Id);
        if (content is not FrameworkElement element) throw new InvalidDataException("XAML fixture root must be FrameworkElement: " + fixture.Id);
        var root = new Grid { Width = size.Width, Height = size.Height, HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top, RequestedTheme = ElementTheme.Light };
        root.Children.Add(element);
        var loaded = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        root.Loaded += (_, _) => loaded.TrySetResult(true);
        window.Content = root;
        await loaded.Task.WaitAsync(TimeSpan.FromSeconds(15));
        double scale = root.XamlRoot.RasterizationScale;
        window.AppWindow.ResizeClient(new SizeInt32((int)Math.Ceiling(size.Width * scale), (int)Math.Ceiling(size.Height * scale)));
        await NextTurn();
        root.Measure(new Size(size.Width, size.Height));
        root.Arrange(new Rect(0, 0, size.Width, size.Height));
        root.UpdateLayout();
        await NextTurn();
        root.UpdateLayout();
        return new { id = fixture.Id, status = "loaded", viewport = new { width = size.Width, height = size.Height },
            rasterizationScale = scale, layout = Snapshot.Visual(element), automation = Snapshot.Automation(element) };
    }
    private static Task NextTurn()
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!DispatcherQueue.GetForCurrentThread().TryEnqueue(DispatcherQueuePriority.Low, () => completion.TrySetResult(true)))
            throw new InvalidOperationException("Dispatcher rejected measurement callback");
        return completion.Task;
    }
}
