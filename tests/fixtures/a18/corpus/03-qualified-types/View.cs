// Handwritten code outside construction must remain byte-identical.
public class View {
    public static Microsoft.UI.Xaml.Window Create() {
        Microsoft.UI.Xaml.Window window = new Microsoft.UI.Xaml.Window();
        Microsoft.UI.Xaml.Controls.Canvas root = new Microsoft.UI.Xaml.Controls.Canvas { Name = "Root", Width = 640, Height = 480 };
        Microsoft.UI.Xaml.Controls.Button action = new Microsoft.UI.Xaml.Controls.Button { Name = "Action", Content = "Run", Width = 160, Height = 40 };
        Microsoft.UI.Xaml.Controls.Canvas.SetLeft(action, 20);
        Microsoft.UI.Xaml.Controls.Canvas.SetTop(action, 30);
        root.Children.Add(action);
        window.Content = root;
        return window;
    }
    // Handler source is owned by the user.
    static void OnClick(object sender, Microsoft.UI.Xaml.RoutedEventArgs args) { Console.WriteLine("clicked"); }
}
class Program { static void Main() { Microsoft.UI.Xaml.Window window = View.Create(); window.Activate(); } }
