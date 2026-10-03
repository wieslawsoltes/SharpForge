using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace TemplateExamples.WinuiNavigation
{
    public class Program
    {
        public static void Main()
        {
            Window window = new Window();
            window.Title = "WinuiNavigationExample";
            Shell page = new Shell();
            window.Content = page.View;
            window.Activate();
        }
    }
}
