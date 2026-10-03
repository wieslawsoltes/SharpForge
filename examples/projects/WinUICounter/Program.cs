using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
class Program
{
    static TextBlock display;
    static int count;
    static void Increment(object sender, RoutedEventArgs args)
    {
        count++;
        display.Text = "Count: " + count;
    }
    static void Main()
    {
        Window window = new Window();
        window.Title = "SharpForge · Code-first WinUI";
        StackPanel panel = new StackPanel();
        panel.Spacing = 16;
        panel.Padding = new Thickness(24);
        TextBlock title = new TextBlock();
        title.Text = "A live managed application";
        title.FontSize = 26;
        display = new TextBlock();
        display.Name = "Counter";
        display.Text = "Count: 0";
        display.FontSize = 38;
        display.Foreground = new SolidColorBrush(Colors.DodgerBlue);
        Button button = new Button();
        button.Name = "IncrementButton";
        button.Content = "Increment";
        button.HorizontalAlignment = HorizontalAlignment.Left;
        button.Click += Increment;
        panel.Children.Add(title);
        panel.Children.Add(display);
        panel.Children.Add(button);
        window.Content = panel;
        window.Activate();
    }
}
