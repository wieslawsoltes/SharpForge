using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
public class MonitorView {
 static Window Create() {
  var window = new Window() { Title = "Monitor" };
  var root = new Canvas() { Width = 800, Height = 560 };
  var button = new Button() { Name = "MonitorAction", Content = Caption.Text(), Width = 180, Height = 40 };
  Canvas.SetLeft(button, 32); Canvas.SetTop(button, 40);
  root.Children.Add(button); window.Content = root;
  return window;
 }
 static void Main() { Create().Activate(); }
}
