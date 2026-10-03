// Adapted from the pinned MIT WinUI Gallery TextBlock sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class TextBlockBoundary {
    public static FrameworkElement Create() {
        return new TextBlock {
            Name = "fixture",
            Text = "",
            Width = 0
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
