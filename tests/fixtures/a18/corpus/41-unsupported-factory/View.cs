using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
// Handwritten code outside construction must remain byte-identical.
public class View {
    public static Window Create() {
        Window window = new Window();
        Canvas root = new Canvas { Name = "Root", Width = 640, Height = 480 };
        Button action = BuildButton();
        Canvas.SetLeft(action, 20);
        Canvas.SetTop(action, 30);
        root.Children.Add(action);
        window.Content = root;
        return window;
    }
    static Button BuildButton() { return new Button { Name = "Action", Content = "Run" }; }
    // Handler source is owned by the user.
    static void OnClick(object sender, RoutedEventArgs args) { Console.WriteLine("clicked"); }
}
class Program { static void Main() { Window window = View.Create(); window.Activate(); } }
