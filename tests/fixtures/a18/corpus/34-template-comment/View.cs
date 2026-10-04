using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
// Handwritten code outside construction must remain byte-identical.
public class View {
    public static Window Create() {
        ControlTemplate frameTemplate = BuildFrame();
        Window window = new Window();
        Canvas root = new Canvas { Name = "Root", Width = 640, Height = 480 };
        Button action = new Button { Name = "Action", Content = "Run", Width = 160, Height = 40 };
        Canvas.SetLeft(action, 20);
        Canvas.SetTop(action, 30);
        action.Template = frameTemplate;
        root.Children.Add(action);
        window.Content = root;
        return window;
    }
    static ControlTemplate BuildFrame() {
        ControlTemplate template = new ControlTemplate();
        Border frame = new Border();
        TextBlock label = new TextBlock();
        label.Text = "Template";
        frame.Child = label;
        /* template ownership boundary */ template.VisualTree = frame;
        return template;
    }
    // Handler source is owned by the user.
    static void OnClick(object sender, RoutedEventArgs args) { Console.WriteLine("clicked"); }
}
class Program { static void Main() { Window window = View.Create(); window.Activate(); } }
