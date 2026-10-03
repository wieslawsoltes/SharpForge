using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace ItemGallery
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class WinuiCounterPageExample
    {
        public Page View { get; private set; }
        private TextBlock display;
        private int count;
        private void Increment(object sender, RoutedEventArgs args)
        {
            count++;
            display.Text = "Count: " + count;
        }

        public WinuiCounterPageExample()
        {
            View = new Page();
            StackPanel panel = new StackPanel();
            panel.Padding = new Thickness(24);
            panel.Spacing = 16;
            TextBlock title = new TextBlock();
            title.Text = "Welcome to your WinUI app";
            title.FontSize = 28;
            display = new TextBlock();
            display.Name = "CounterDisplay";
            display.Text = "Count: 0";
            display.FontSize = 36;
            Button button = new Button();
            button.Content = "Increment";
            button.Click += Increment;
            panel.Children.Add(title);
            panel.Children.Add(display);
            panel.Children.Add(button);
            View.Content = panel;
        }
    }
}
