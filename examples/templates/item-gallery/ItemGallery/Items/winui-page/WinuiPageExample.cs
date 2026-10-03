using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace ItemGallery
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class WinuiPageExample
    {
        public Page View { get; private set; }

        public WinuiPageExample()
        {
            View = new Page();
            StackPanel panel = new StackPanel();
            panel.Padding = new Thickness(24);
            panel.Spacing = 16;
            TextBlock title = new TextBlock();
            title.Text = "WinuiPageExample";
            title.FontSize = 28;
            panel.Children.Add(title);
            View.Content = panel;
        }
    }
}
