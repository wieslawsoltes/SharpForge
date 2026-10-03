using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
using System;

namespace ItemGallery
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class WinuiFlyoutExample
    {
        public MenuFlyout View { get; private set; }
        private void Run(object sender, RoutedEventArgs args)
        {
            Console.WriteLine("Action selected");
        }

        public WinuiFlyoutExample()
        {
            View = new MenuFlyout();
            MenuFlyoutItem action = new MenuFlyoutItem();
            action.Text = "Run action";
            action.Click += Run;
            View.Items.Add(action);
        }
    }
}
