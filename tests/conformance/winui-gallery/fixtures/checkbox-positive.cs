// Adapted from the pinned MIT WinUI Gallery CheckBox sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class CheckBoxPositive {
    public static FrameworkElement Create() {
        return new CheckBox {
            Name = "fixture",
            Content = "Two-state CheckBox",
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
