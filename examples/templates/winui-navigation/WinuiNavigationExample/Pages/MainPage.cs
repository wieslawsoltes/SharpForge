using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace TemplateExamples.WinuiNavigation
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class MainPage
    {
        public Page View { get; private set; }

        public MainPage()
        {
            View = new Page();
            StackPanel panel = new StackPanel();
            panel.Padding = new Thickness(24);
            panel.Spacing = 16;
            TextBlock title = new TextBlock();
            title.Text = "MainPage";
            title.FontSize = 28;
            panel.Children.Add(title);
            View.Content = panel;
        }
    }
}
