using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Threading.Tasks;
class Program
{
    static Button button;
    static TextBlock status;
    static async void Calculate(object sender, RoutedEventArgs args)
    {
        button.IsEnabled = false;
        status.Text = "Calculating…";
        await Task.Delay(700);
        int answer = 6 * 7;
        status.Text = "Answer: " + answer;
        button.IsEnabled = true;
    }
    static void Main()
    {
        StackPanel panel = new StackPanel(); panel.Spacing = 16; panel.Padding = new Thickness(24);
        status = new TextBlock(); status.Name = "Status"; status.Text = "Ready"; status.FontSize = 26;
        button = new Button(); button.Name = "Calculate"; button.Content = "Calculate";
        button.Click += Calculate;
        panel.Children.Add(status); panel.Children.Add(button);
        Window window = new Window(); window.Title = "Async managed UI"; window.Content = panel; window.Activate();
    }
}
