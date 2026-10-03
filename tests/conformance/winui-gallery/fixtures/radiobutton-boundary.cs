// Adapted from the pinned MIT WinUI Gallery RadioButton sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class RadioButtonBoundary {
    public static FrameworkElement Create() {
        return new RadioButton {
            Name = "fixture",
            Content = "",
            IsChecked = false,
            Width = 0
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
