// Adapted from the pinned MIT WinUI Gallery ProgressBar sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class ProgressBarPositive {
    public static FrameworkElement Create() {
        return new ProgressBar {
            Name = "fixture",
            Minimum = 0,
            Maximum = 100,
            Value = 50,
            Width = 120
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
