using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;

internal static class Program
{
    internal static string Output = "";
    internal static Stopwatch Clock = Stopwatch.StartNew();
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1) return 2;
        Output = args[0];
        try
        {
            if (Environment.Version.ToString() != "10.0.5") throw new InvalidOperationException("CoreCLR version drift: " + Environment.Version);
            WinRT.ComWrappersSupport.InitializeComWrappers();
            Application.Start(_args =>
            {
                SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
                _ = new OracleApplication();
            });
            return File.Exists(Output) ? 0 : 3;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            return 1;
        }
    }
}

internal sealed class OracleApplication : Application
{
    private Window? window;
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        try { Run(); }
        catch (Exception error) { Console.Error.WriteLine(error); Environment.Exit(1); }
    }

    private void Run()
    {
        long allocatedBefore = GC.GetAllocatedBytesForCurrentThread();
        var accentPalette = AccentPalette.Capture(this);
        var button = new Button { Content = "Oracle → café", Width = 120 };
        Check((string)button.Content == "Oracle → café" && button.Width == 120, "control/property round trip");
        Check((double)button.ReadLocalValue(FrameworkElement.WidthProperty) == 120, "dependency property local value");
        button.ClearValue(FrameworkElement.WidthProperty);
        Check(double.IsNaN(button.Width), "dependency property default after clear");
        button.Width = 0;
        Check(button.Width == 0, "zero width boundary");
        string negativeWidth = "";
        try { button.Width = -1; } catch (Exception error) { negativeWidth = error.GetType().FullName!; }
        Check(negativeWidth.Length > 0, "negative width must be rejected");
        string malformedXaml = "";
        try { XamlReader.Load("<Button xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\">"); }
        catch (Exception error) { malformedXaml = error.GetType().FullName!; }
        Check(malformedXaml.Length > 0, "malformed XAML must be rejected");
        var panel = new StackPanel();
        panel.Children.Add(button);
        Check(panel.Children.Count == 1 && ReferenceEquals(panel.Children[0], button), "native child collection");
        panel.Children.Remove(button);
        Check(panel.Children.Count == 0, "native child removal");
        panel.Children.Add(button);
        window = new Window { Title = "SharpForge native WinUI oracle", Content = panel };
        bool closed = false;
        window.Closed += (_, _) => closed = true;
        window.Activate();
        var queue = DispatcherQueue.GetForCurrentThread();
        Check(queue.HasThreadAccess, "UI thread access");
        var order = new List<int>();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var cancelledToken = cancellation.Token;
        bool cancelledWorkRan = false;
        Check(queue.TryEnqueue(() => { order.Add(1); if (!cancelledToken.IsCancellationRequested) cancelledWorkRan = true; }), "first enqueue");
        Check(queue.TryEnqueue(() =>
        {
            try
            {
                order.Add(2);
                Check(queue.HasThreadAccess && order.Count == 2 && order[0] == 1 && !cancelledWorkRan, "dispatcher FIFO and cancelled callback");
                window.Close();
                Check(closed, "window closed event/disposal");
                double coldStartupMs = Program.Clock.Elapsed.TotalMilliseconds;
                var samples = new List<double>();
                for (int i = 0; i < 20; i++)
                {
                    var watch = Stopwatch.StartNew();
                    var next = new Button { Content = i, Width = i };
                    Check(next.Width == i, "warm control correctness");
                    samples.Add(watch.Elapsed.TotalMilliseconds);
                }
                long allocated = GC.GetAllocatedBytesForCurrentThread() - allocatedBefore;
                var result = new
                {
                    content = (string)button.Content,
                    dependencyPropertyCleared = true,
                    zeroWidth = true,
                    negativeWidthException = negativeWidth,
                    malformedXamlException = malformedXaml,
                    childrenRemoved = true,
                    dispatcherThreadAccess = queue.HasThreadAccess,
                    dispatcherOrder = order,
                    cancelledWorkRan,
                    windowClosed = closed,
                    accentPalette,
                };
                File.WriteAllText(Program.Output, JsonSerializer.Serialize(new { result, measurements = new { coldStartupMs, warmControlMs = samples, managedAllocatedBytesOnUIThread = allocated } }));
                Exit();
            }
            catch (Exception error) { Console.Error.WriteLine(error); Environment.Exit(1); }
        }), "second enqueue");
    }

    private static void Check(bool condition, string label)
    {
        if (!condition) throw new InvalidOperationException("WinUI oracle failed: " + label);
    }
}
