using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
using TemplateExamples.WinuiLibrarySolution.Controls;

namespace TemplateExamples.WinuiLibrarySolution
{
    public class Program
    {
        public static void Main()
        {
            Window window = new Window();
            window.Title = "WinuiLibrarySolutionExample";
            CardControl card = new CardControl();
            card.SetCaption("Control from the referenced library");
            window.Content = card.View;
            window.Activate();
        }
    }
}
