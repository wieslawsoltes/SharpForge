using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
class Program
{
    static TextBox input;
    static TextBlock status;
    static Setter fontSize;
    static int count;
    static void Change(object sender, RoutedEventArgs args)
    {
        count++;
        fontSize.Value = 18.0 + count;
        status.Text = input.Text + ": " + count;
    }
    static void Main()
    {
        Style style = new Style("Button");
        fontSize = new Setter(Button.FontSizeProperty, 18.0);
        style.Setters.Add(fontSize);
        style.Setters.Add(new Setter(Button.PaddingProperty, new Thickness(12)));
        ControlTemplate template = new ControlTemplate();
        template.TargetTypeName = "TextBox";
        Border border = new Border();
        border.Padding = new Thickness(8);
        TextBox part = new TextBox();
        part.Name = "PART_Input";
        border.Child = part;
        template.VisualTree = border;
        template.Bind(part, "Text", TextBox.TextProperty);
        input = new TextBox(); input.Name = "StyledInput"; input.Text = "Type here"; input.Template = template;
        TextBox second = new TextBox(); second.Text = "Independent instance"; second.Template = template;
        Button button = new Button(); button.Content = "Change shared style"; button.Style = style; button.Click += Change;
        Button follower = new Button(); follower.Content = "Shared style follower"; follower.Style = style;
        status = new TextBlock(); status.Text = "Ready";
        StackPanel panel = new StackPanel(); panel.Padding = new Thickness(24); panel.Spacing = 12;
        panel.Children.Add(input); panel.Children.Add(second); panel.Children.Add(button); panel.Children.Add(follower); panel.Children.Add(status);
        Window window = new Window(); window.Title = "Shared styles and instance templates"; window.Content = panel; window.Activate();
    }
}
