using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
public class MonitorView {
 static int count;
 static TextBlock status;
 static int Step() { return 1; }
 static void Click(object sender, RoutedEventArgs args) {
  count += Step();
  status.Text = "Monitor:" + count;
  Console.WriteLine("monitor-count:" + count);
 }
 static Window Create() {
  var window = new Window() { Title = "Monitor" };
  var root = new Canvas() { Width = 800, Height = 560 };
  var button = new Button() { Name = "MonitorAction", Content = Caption.Text(), Width = 180, Height = 40 };
  Canvas.SetLeft(button, 32); Canvas.SetTop(button, 40);
  button.Click += Click;
  status = new TextBlock() { Name = "MonitorStatus", Text = "Monitor:0", Width = 320, Height = 32 };
  Canvas.SetLeft(status, 32); Canvas.SetTop(status, 104);
  root.Children.Add(button); root.Children.Add(status); window.Content = root;
  return window;
 }
 static void Main() {
  count = 0;
  Create().Activate();
  Console.WriteLine("monitor-started");
 }
}
