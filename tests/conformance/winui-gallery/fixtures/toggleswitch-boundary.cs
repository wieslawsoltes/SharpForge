// Adapted from the pinned MIT WinUI Gallery ToggleSwitch sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class ToggleSwitchBoundary {
    public static FrameworkElement Create() {
        return new ToggleSwitch {
            Name = "fixture",
            Header = "",
            IsOn = false,
            Width = 0
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
