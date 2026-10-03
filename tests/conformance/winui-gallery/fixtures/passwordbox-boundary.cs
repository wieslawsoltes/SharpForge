// Adapted from the pinned MIT WinUI Gallery PasswordBox sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class PasswordBoxBoundary {
    public static FrameworkElement Create() {
        return new PasswordBox {
            Name = "fixture",
            Password = "",
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
