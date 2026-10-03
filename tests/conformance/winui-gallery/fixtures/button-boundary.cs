// Adapted from the pinned MIT WinUI Gallery Button sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class ButtonBoundary {
    public static FrameworkElement Create() {
        return new Button {
            Name = "fixture",
            Content = "",
            IsEnabled = false,
            Width = 0
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
