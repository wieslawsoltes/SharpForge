using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
// Handwritten code outside construction must remain byte-identical.
public class View {
    public static Window Create() {
        Window window = new Window();
        Grid root = new Grid { Name = "Root", Width = 640, Height = 480 };
        Button action = new Button { Name = "Action", Content = "Run", Width = 160, Height = 40 };
        Grid.SetRow(action, 0);
        Grid.SetColumn(action, 0);
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(240) });
        root.Children.Add(action);
        window.Content = root;
        return window;
    }
    // Handler source is owned by the user.
    static void OnClick(object sender, RoutedEventArgs args) { Console.WriteLine("clicked"); }
}
class Program { static void Main() { Window window = View.Create(); window.Activate(); } }
