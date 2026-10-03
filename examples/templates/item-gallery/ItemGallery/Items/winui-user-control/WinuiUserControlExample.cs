using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace ItemGallery
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class WinuiUserControlExample
    {
        public UserControl View { get; private set; }
        private TextBlock caption;
        public void SetCaption(string value)
        {
            caption.Text = value;
        }

        public WinuiUserControlExample()
        {
            View = new UserControl();
            Border border = new Border();
            border.Padding = new Thickness(16);
            border.CornerRadius = new CornerRadius(8);
            border.Background = new SolidColorBrush(Colors.DodgerBlue);
            caption = new TextBlock();
            caption.Text = "Reusable control";
            caption.Foreground = new SolidColorBrush(Colors.White);
            border.Child = caption;
            View.Content = border;
        }
    }
}
