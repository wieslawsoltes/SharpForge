// Adapted from the pinned MIT WinUI Gallery Slider sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class SliderBoundary {
    public static FrameworkElement Create() {
        return new Slider {
            Name = "fixture",
            Minimum = 0,
            Maximum = 100,
            Value = 0,
            Width = 0
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
