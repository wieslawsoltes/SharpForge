using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
// Handwritten code outside construction must remain byte-identical.
public class View {
    public static Window Create() {
        Window window = new Window();
        StackPanel root = new StackPanel { Name = "Root", Children = {
            new Button { Name = "First", Content = "One", Width = 160 },
            new Button { Name = "Second", Content = "Two" }
        } };
        window.Content = root;
        return window;
    }
    // Handler source is owned by the user.
    static void OnClick(object sender, RoutedEventArgs args) { Console.WriteLine("clicked"); }
}
class Program { static void Main() { Window window = View.Create(); window.Activate(); } }
