// Adapted from the pinned MIT WinUI Gallery TextBlock sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class TextBlockPositive {
    public static FrameworkElement Create() {
        return new TextBlock {
            Name = "fixture",
            Text = "I am a TextBlock.",
            Width = 120
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
