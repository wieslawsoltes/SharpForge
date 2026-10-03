// Adapted from the pinned MIT WinUI Gallery PasswordBox sample; see upstream.json.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
namespace GalleryCases {
public class PasswordBoxPositive {
    public static FrameworkElement Create() {
        return new PasswordBox {
            Name = "fixture",
            Password = "fixture",
            MaxLength = 20,
            Width = 120
        };
    }
    static void Main() {
        Window window = new Window { Content = Create() };
        window.Activate();
    }
}
}
