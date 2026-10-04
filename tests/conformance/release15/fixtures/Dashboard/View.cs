using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
public class DashboardView {
 static int count;
 static TextBlock status;
 static int Step() { return 1; }
 static void Click(object sender, RoutedEventArgs args) {
  count += Step();
  status.Text = "Dashboard:" + count;
  Console.WriteLine("dashboard-count:" + count);
 }
 static Window Create() {
  var window = new Window() { Title = "Dashboard" };
  var root = new Canvas() { Width = 800, Height = 560 };
  var button = new Button() { Name = "DashboardAction", Content = Caption.Text(), Width = 180, Height = 40 };
  Canvas.SetLeft(button, 32); Canvas.SetTop(button, 40);
  button.Click += Click;
  status = new TextBlock() { Name = "DashboardStatus", Text = "Dashboard:0", Width = 320, Height = 32 };
  Canvas.SetLeft(status, 32); Canvas.SetTop(status, 104);
  root.Children.Add(button); root.Children.Add(status); window.Content = root;
  return window;
 }
 static void Main() {
  count = 0;
  Create().Activate();
  Console.WriteLine("dashboard-started");
 }
}
