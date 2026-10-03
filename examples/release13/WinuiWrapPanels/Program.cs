using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
class Program
{
    static void Main()
    {
        var items = new VariableSizedWrapGrid() { Name = "Cards", Width = 780, Height = 380, ItemWidth = 180, ItemHeight = 84, MaximumRowsOrColumns = 4, Orientation = Orientation.Horizontal };
        for (int i = 0; i < 9; i++)
        {
            var button = new Button() { Content = $"Card {i + 1:D2}", Margin = new Thickness(5), FontSize = 18 };
            if (i == 0) { VariableSizedWrapGrid.SetColumnSpan(button, 2); button.Background = new SolidColorBrush(Colors.DodgerBlue); }
            items.Children.Add(button);
        }
        var panel = new StackPanel() { Padding = new Thickness(24), Spacing = 16 };
        panel.Children.Add(new TextBlock() { Text = "Wrapping layouts with real cell spans", FontSize = 26 }); panel.Children.Add(items);
        var window = new Window() { Content = panel }; window.Activate();
    }
}
