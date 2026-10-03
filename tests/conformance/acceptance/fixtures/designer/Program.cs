using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class View {
 static Window Create() {
  var window = new Window() { Title = "Acceptance designer" };
  var root = new Canvas() { Width = 860, Height = 560 };
  var button = new Button() { Name = "Action", Content = "Designed", Width = 180, Height = 40 };
  root.Children.Add(button);
  window.Content = root;
  return window;
 }
 static void Main() { Create().Activate(); }
}
