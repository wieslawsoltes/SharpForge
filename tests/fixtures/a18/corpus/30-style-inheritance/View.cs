using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
// Handwritten code outside construction must remain byte-identical.
public class View {
    public static Window Create() {
        Style foundation = new Style("Button");
        foundation.Setters.Add(new Setter(FrameworkElement.HeightProperty, 44.0));
        Style accent = new Style("Button");
        accent.BasedOn = foundation;
        accent.Setters.Add(new Setter(Control.FontSizeProperty, 18.0));
        Window window = new Window();
        Canvas root = new Canvas { Name = "Root", Width = 640, Height = 480 };
        Button action = new Button { Name = "Action", Content = "Run", Width = 160, Height = 40 };
        Canvas.SetLeft(action, 20);
        Canvas.SetTop(action, 30);
        action.Style = accent;
        root.Children.Add(action);
        window.Content = root;
        return window;
    }
    // Handler source is owned by the user.
    static void OnClick(object sender, RoutedEventArgs args) { Console.WriteLine("clicked"); }
}
class Program { static void Main() { Window window = View.Create(); window.Activate(); } }
