// Adapted from the pinned MIT WinUI Gallery ToggleSwitch sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class ToggleSwitchPositive {
    public static FrameworkElement Create() {
        return new ToggleSwitch {
            Name = "fixture",
            Header = "ToggleSwitch",
            IsOn = true,
            Width = 120
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
