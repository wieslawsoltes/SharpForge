// Adapted from the pinned MIT WinUI Gallery TextBox sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class TextBoxBoundary {
    public static FrameworkElement Create() {
        return new TextBox {
            Name = "fixture",
            Text = "",
            MaxLength = 0,
            Width = 0
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
