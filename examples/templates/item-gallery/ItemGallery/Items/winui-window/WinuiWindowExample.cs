using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace ItemGallery
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class WinuiWindowExample
    {
        public Window View { get; private set; }
        public void Activate()
        {
            View.Activate();
        }

        public WinuiWindowExample()
        {
            View = new Window();
            View.Title = "WinuiWindowExample";
            View.Content = new TextBlock() { Text = "Tool window", FontSize = 24 };
        }
    }
}
