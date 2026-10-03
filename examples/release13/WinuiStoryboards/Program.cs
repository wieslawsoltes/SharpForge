using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
class Program
{
    static Storyboard motion;
    static TextBlock status;
    static void Play(object sender, RoutedEventArgs e) { motion.Begin(); status.Text = "Playing"; }
    static void Pause(object sender, RoutedEventArgs e) { motion.Pause(); status.Text = "Paused"; }
    static void Resume(object sender, RoutedEventArgs e) { motion.Resume(); status.Text = "Playing"; }
    static void Stop(object sender, RoutedEventArgs e) { motion.Stop(); status.Text = "Stopped — base value restored"; }
    static void Completed(object sender, RoutedEventArgs e) { status.Text = "Complete — play again"; }
    static void Main()
    {
        var panel = new StackPanel() { Padding = new Thickness(28), Spacing = 18 };
        panel.Children.Add(new TextBlock() { Text = "Managed storyboard playback", FontSize = 28 });
        status = new TextBlock() { Name = "AnimationStatus", Text = "Ready", FontSize = 16 };
        var track = new Canvas() { Width = 620, Height = 110 };
        var tile = new Button() { Name = "AnimatedTile", Content = "Animated", Width = 160, Height = 48 };
        tile.RenderTransform = new TranslateTransform(); Canvas.SetTop(tile, 24); track.Children.Add(tile);
        var animation = new DoubleAnimation() { From = 0, To = 380, Duration = new Duration(TimeSpan.FromSeconds(2)), AutoReverse = true, EasingFunction = new SineEase() { EasingMode = EasingMode.EaseInOut } };
        Storyboard.SetTarget(animation, tile); Storyboard.SetTargetProperty(animation, "RenderTransform.X");
        motion = new Storyboard(); motion.Children.Add(animation); motion.Completed += Completed;
        var controls = new StackPanel() { Orientation = Orientation.Horizontal, Spacing = 10 };
        var play = new Button() { Content = "Play" }; play.Click += Play;
        var pause = new Button() { Content = "Pause" }; pause.Click += Pause;
        var resume = new Button() { Content = "Resume" }; resume.Click += Resume;
        var stop = new Button() { Content = "Stop" }; stop.Click += Stop;
        controls.Children.Add(play); controls.Children.Add(pause); controls.Children.Add(resume); controls.Children.Add(stop);
        panel.Children.Add(track); panel.Children.Add(controls); panel.Children.Add(status);
        var window = new Window() { Title = "Storyboard + managed callbacks", Content = panel }; window.Activate();
    }
}
