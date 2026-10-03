using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Microsoft.UI;
class Program
{
    static void Main()
    {
        StackPanel panel = new StackPanel(); panel.Spacing = 18; panel.Padding = new Thickness(24);
        panel.Children.Add(new TextBlock() { Text = "One scene · three rendering backends", FontSize = 24 });
        Canvas canvas = new Canvas(); canvas.Height = 180; canvas.Width = 560;
        Rectangle rectangle = new Rectangle(); rectangle.Width = 180; rectangle.Height = 110;
        rectangle.Fill = new SolidColorBrush(Colors.DodgerBlue); Canvas.SetLeft(rectangle, 20); Canvas.SetTop(rectangle, 25);
        Ellipse ellipse = new Ellipse(); ellipse.Width = 130; ellipse.Height = 130;
        ellipse.Fill = new SolidColorBrush(Colors.Orange); Canvas.SetLeft(ellipse, 230); Canvas.SetTop(ellipse, 15);
        Line line = new Line(); line.X1 = 380; line.Y1 = 140; line.X2 = 520; line.Y2 = 25;
        line.Stroke = new SolidColorBrush(Colors.CornflowerBlue); line.StrokeThickness = 5;
        canvas.Children.Add(rectangle); canvas.Children.Add(ellipse); canvas.Children.Add(line);
        SharpForge.UI.DrawingSurface drawing = new SharpForge.UI.DrawingSurface(); drawing.Width = 560; drawing.Height = 100;
        for (int i = 0; i < 8; i++)
            drawing.FillRectangle(i * 65 + 10, 80 - i * 8, 48, i * 8 + 12, Colors.CornflowerBlue);
        panel.Children.Add(canvas); panel.Children.Add(drawing);
        Window window = new Window(); window.Title = "WebGPU with fallbacks"; window.Content = panel; window.Activate();
    }
}
