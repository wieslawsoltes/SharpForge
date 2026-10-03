using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace TemplateExamples.WinuiNavigation
{
    public class Shell
    {
        public StackPanel View { get; private set; }
        private ContentControl content;
        private MainPage home = new MainPage();
        private SettingsPage settings = new SettingsPage();
        public Shell()
        {
            View = new StackPanel();
            View.Spacing = 12;
            StackPanel navigation = new StackPanel();
            navigation.Orientation = Orientation.Horizontal;
            navigation.Spacing = 8;
            Button homeButton = new Button() { Content = "Home" };
            homeButton.Click += ShowHome;
            Button settingsButton = new Button() { Content = "Settings" };
            settingsButton.Click += ShowSettings;
            navigation.Children.Add(homeButton);
            navigation.Children.Add(settingsButton);
            content = new ContentControl();
            content.Content = home.View;
            View.Children.Add(navigation);
            View.Children.Add(content);
        }
        private void ShowHome(object sender, RoutedEventArgs args)
        {
            content.Content = home.View;
        }
        private void ShowSettings(object sender, RoutedEventArgs args)
        {
            content.Content = settings.View;
        }
    }
}
