// Adapted from the pinned MIT WinUI Gallery ToggleButton sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
namespace GalleryCases {
public class ToggleButtonPositive {
    public static FrameworkElement Create() {
        return new ToggleButton {
            Name = "fixture",
            Content = "Toggle button",
            IsChecked = true,
            Width = 120
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
