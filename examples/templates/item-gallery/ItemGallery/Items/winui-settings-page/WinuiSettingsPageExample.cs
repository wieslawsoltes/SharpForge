using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace ItemGallery
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class WinuiSettingsPageExample
    {
        public Page View { get; private set; }
        private TextBox input;
        private CheckBox enabled;
        private TextBlock result;
        private void Apply(object sender, RoutedEventArgs args)
        {
            result.Text = "Saved: " + input.Text;
        }

        public WinuiSettingsPageExample()
        {
            View = new Page();
            StackPanel panel = new StackPanel();
            panel.Padding = new Thickness(24);
            panel.Spacing = 12;
            TextBlock title = new TextBlock();
            title.Text = "Settings";
            title.FontSize = 28;
            input = new TextBox();
            input.PlaceholderText = "Display name";
            enabled = new CheckBox();
            enabled.Content = "Enable feature";
            result = new TextBlock();
            Button apply = new Button();
            apply.Content = "Apply settings";
            apply.Click += Apply;
            panel.Children.Add(title);
            panel.Children.Add(input);
            panel.Children.Add(enabled);
            panel.Children.Add(apply);
            panel.Children.Add(result);
            View.Content = panel;
        }
    }
}
