using System;
using System.Numerics;
using Microsoft.UI;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;

class Program
{
    static void Main()
    {
        Grid anchor = new Grid { Name = "anchor", Width = 100, Height = 60, Background = new SolidColorBrush(Colors.White) };
        Window window = new Window { Content = anchor };
        window.Activate();
        Visual element = ElementCompositionPreview.GetElementVisual(anchor);
        Compositor compositor = element.Compositor;
        ContainerVisual overlay = compositor.CreateContainerVisual();
        SpriteVisual red = compositor.CreateSpriteVisual();
        red.Size = new Vector2(40, 30);
        red.Brush = compositor.CreateColorBrush(Colors.Red);
        SpriteVisual blue = compositor.CreateSpriteVisual();
        blue.Size = new Vector2(20, 15);
        blue.Offset = new Vector3(10, 5, 0);
        blue.Brush = compositor.CreateColorBrush(Colors.Blue);
        blue.Clip = compositor.CreateInsetClip(1, 2, 3, 4);
        overlay.Children.InsertAtBottom(red);
        overlay.Children.InsertAtTop(blue);
        ElementCompositionPreview.SetElementChildVisual(anchor, overlay);
        Console.WriteLine(ElementCompositionPreview.GetElementChildVisual(anchor) == overlay);
        try { blue.Opacity = 2; }
        catch (Exception) { Console.WriteLine("range-rejected"); }
        Vector3KeyFrameAnimation movement = compositor.CreateVector3KeyFrameAnimation();
        movement.Duration = TimeSpan.FromSeconds(1);
        movement.InsertKeyFrame(0, new Vector3(0, 0, 0));
        movement.InsertKeyFrame(1, new Vector3(20, 10, 0));
        element.StartAnimation("Offset", movement);
    }
}
