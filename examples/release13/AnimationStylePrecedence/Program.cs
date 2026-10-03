using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
class Program
{
    static void Main()
    {
        var style = new Style("Button"); var baseOpacity = new Setter(Button.OpacityProperty, 0.4); style.Setters.Add(baseOpacity);
        var button = new Button() { Style = style };
        var animation = new DoubleAnimation() { From = 0, To = 1, Duration = new Duration(TimeSpan.FromSeconds(1)) };
        Storyboard.SetTarget(animation, button); Storyboard.SetTargetProperty(animation, "Opacity");
        var storyboard = new Storyboard(); storyboard.Children.Add(animation); storyboard.Begin();
        SharpForge.UI.AnimationClock.AdvanceBy(500); Console.WriteLine(button.Opacity);
        baseOpacity.Value = 0.8; Console.WriteLine(button.Opacity);
        storyboard.Stop(); Console.WriteLine(button.Opacity);
    }
}
