using Microsoft.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

class ProbeBrush : XamlCompositionBrushBase
{
    public int Connections;
    public int Disconnections;

    protected override void OnConnected()
    {
        Connections++;
        var compositor = new Compositor();
        var gradient = compositor.CreateLinearGradientBrush();
        gradient.ColorStops.Add(compositor.CreateColorGradientStop(0, Colors.Red));
        gradient.ColorStops.Add(compositor.CreateColorGradientStop(1, Colors.Blue));
        CompositionBrush = gradient;
    }

    protected override void OnDisconnected()
    {
        Disconnections++;
        CompositionBrush = null;
    }

    public bool IsReady() { return CompositionBrush != null; }
}

class Program
{
    static ProbeBrush brush;
    static Border first;
    static Border second;

    static void Disconnect(object sender, RoutedEventArgs args)
    {
        first.Background = null;
        second.Background = null;
        Console.WriteLine(brush.Connections);
        Console.WriteLine(brush.Disconnections);
    }

    static void Main()
    {
        brush = new ProbeBrush();
        first = new Border { Name = "first", Background = brush };
        second = new Border { Name = "second", Background = brush };
        var button = new Button { Name = "disconnect", Content = "Disconnect" };
        button.Click += Disconnect;
        var panel = new StackPanel();
        panel.Children.Add(first);
        panel.Children.Add(second);
        panel.Children.Add(button);
        var window = new Window { Content = panel };
        window.Activate();
        GC.Collect();
        Console.WriteLine(brush.Connections);
        Console.WriteLine(brush.IsReady());
    }
}
