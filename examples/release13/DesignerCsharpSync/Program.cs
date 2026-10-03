using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
class Program
{
    static int count;
    static TextBlock summary;
    // Designer owns this declarative construction method, not the handlers below.
    static Window Create()
    {
        var window = new Window() { Title = "Source + Design Studio" };
        var surface = new Canvas() { Name = "Surface", Width = 920, Height = 560, Background = new SolidColorBrush(Colors.Black) };
        var eyebrow = new TextBlock() { Text = "SHARPFORGE / TWO-WAY AUTHORING", FontSize = 13, Foreground = new SolidColorBrush(Colors.CornflowerBlue) };
        Canvas.SetLeft(eyebrow, 42); Canvas.SetTop(eyebrow, 30);
        var title = new TextBlock() { Name = "Heading", Text = "Code and design, together.", FontSize = 34, Width = 820, Foreground = new SolidColorBrush(Colors.White) };
        Canvas.SetLeft(title, 40); Canvas.SetTop(title, 76);
        var subtitle = new TextBlock() { Text = "Change properties here. Edit the same C# in the full editor.", FontSize = 17, Width = 820, Foreground = new SolidColorBrush(Colors.Gray) };
        Canvas.SetLeft(subtitle, 42); Canvas.SetTop(subtitle, 135);
        var card = new Border() { Width = 824, Height = 178, Padding = new Thickness(24), CornerRadius = new CornerRadius(12), Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 34, 48, 58)) };
        Canvas.SetLeft(card, 42); Canvas.SetTop(card, 198);
        var content = new StackPanel() { Spacing = 14 };
        var heading = new TextBlock() { Text = "Your code stays yours", FontSize = 22, Foreground = new SolidColorBrush(Colors.White) };
        summary = new TextBlock() { Name = "Summary", Text = "0 edits applied / handlers are preserved", FontSize = 18, Foreground = new SolidColorBrush(Colors.LightGray) };
        var note = new TextBlock() { Text = "Source spans / version checks / compile-checked updates", FontSize = 14, Foreground = new SolidColorBrush(Colors.LightGray) };
        content.Children.Add(heading); content.Children.Add(summary); content.Children.Add(note); card.Child = content;
        var action = new Button() { Name = "ApplyButton", Content = "Run managed action", Width = 208, Height = 44, FontSize = 15, Background = new SolidColorBrush(Colors.DodgerBlue), Foreground = new SolidColorBrush(Colors.White) };
        Canvas.SetLeft(action, 42); Canvas.SetTop(action, 416); action.Click += OnAction;
        var footer = new TextBlock() { Text = "Try Designer → Connect C# → Program.cs", FontSize = 14, Foreground = new SolidColorBrush(Colors.Gray) };
        Canvas.SetLeft(footer, 278); Canvas.SetTop(footer, 429);
        surface.Children.Add(eyebrow); surface.Children.Add(title); surface.Children.Add(subtitle); surface.Children.Add(card); surface.Children.Add(action); surface.Children.Add(footer);
        window.Content = surface;
        return window;
    }
    // This hand-written logic remains byte-for-byte untouched by property updates.
    static void OnAction(object sender, RoutedEventArgs args)
    {
        count++;
        var features = new List<string>() { "C#", "Designer", "Managed events" };
        summary.Text = $"Action {count:D2}: {string.Join(" / ", features.ToArray())}";
    }
    static void Main() { Create().Activate(); }
}
