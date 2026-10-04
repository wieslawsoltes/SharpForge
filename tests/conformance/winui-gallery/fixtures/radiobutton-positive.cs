// Adapted from the pinned MIT WinUI Gallery RadioButton sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class RadioButtonPositive {
    public static FrameworkElement Create() {
        return new RadioButton {
            Name = "fixture",
            Content = "Option 1",
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
