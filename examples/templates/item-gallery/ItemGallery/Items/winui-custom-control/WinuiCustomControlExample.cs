using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace ItemGallery
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class WinuiCustomControlExample
    {
        public Border View { get; private set; }

        public WinuiCustomControlExample()
        {
            View = new Border();
            View.Padding = new Thickness(16);
            View.CornerRadius = new CornerRadius(6);
            View.Background = new SolidColorBrush(Colors.DodgerBlue);
            TextBlock label = new TextBlock();
            label.Text = "Ready";
            label.Foreground = new SolidColorBrush(Colors.White);
            View.Child = label;
        }
    }
}
