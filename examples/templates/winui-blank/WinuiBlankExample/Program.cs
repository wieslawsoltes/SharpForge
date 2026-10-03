using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace TemplateExamples.WinuiBlank
{
    public class Program
    {
        public static void Main()
        {
            Window window = new Window();
            window.Title = "WinuiBlankExample";
            MainPage page = new MainPage();
            window.Content = page.View;
            window.Activate();
        }
    }
}
