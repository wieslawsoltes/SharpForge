using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using SharpForge.Runtime;
class Program
{
    static TextBlock status;
    static Button run;
    static async void Calculate(object sender, RoutedEventArgs args)
    {
        run.IsEnabled = false;
        status.Text = "Computing in isolated workers...";
        double[] values = new double[10000];
        for (int i = 0; i < values.Length; i++) values[i] = 0.5;
        double sum = await ParallelMath.SumAsync(values);
        status.Text = $"Completed: sum = {sum:F1}";
        run.IsEnabled = true;
    }
    static void Main()
    {
        var panel = new StackPanel() { Padding = new Thickness(28), Spacing = 18 };
        panel.Children.Add(new TextBlock() { Text = "Managed code · real compute workers", FontSize = 26 });
        status = new TextBlock() { Name = "ComputeStatus", Text = "Ready", FontSize = 20 };
        run = new Button() { Name = "ComputeButton", Content = "Calculate 10,000 values" };
        run.Click += Calculate;
        panel.Children.Add(status); panel.Children.Add(run);
        new Window() { Title = "SharpForge numerical worker monitor", Content = panel }.Activate();
    }
}
