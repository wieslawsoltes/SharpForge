using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Data;
using Microsoft.UI.Xaml.Markup;

class Program {
    // These ordinary accessors provide the same declared framework metadata used by the compiled XAML.
    static string Metadata(FrameworkElement source, TextBlock target) { target.Text = source.Name; return target.Text; }
    static void Main() {
        StackPanel page = (StackPanel)XamlReader.Load(@"<StackPanel xmlns=""http://schemas.microsoft.com/winfx/2006/xaml/presentation""
            xmlns:x=""http://schemas.microsoft.com/winfx/2006/xaml"" x:Name=""PhaseRoot"">
            <TextBlock x:Name=""phase3"" x:Phase=""3"" Text=""{x:Bind Name}"" />
            <TextBlock x:Name=""phase1"" x:Phase=""1"" Text=""{x:Bind Name}"" />
            <TextBlock x:Name=""phase2"" x:Phase=""2"" Text=""{x:Bind Name}"" />
            <TextBlock x:Name=""deferred"" x:Load=""False"" Text=""realized later"" />
            <Button x:Name=""realize"" Content=""Realize deferred element"" />
        </StackPanel>");
        TextBlock diagnostic = new TextBlock { Name = "diagnostic" };
        diagnostic.SetBinding(TextBlock.TextProperty, new Binding { Source = page,
            Path = new PropertyPath("MissingTitle"), FallbackValue = "binding fallback" });
        page.Children.Add(diagnostic);
        Button realize = (Button)page.FindName("realize");
        realize.Click += (sender, args) => Console.WriteLine(((FrameworkElement)page.FindName("deferred")).Name);
        new Window { Content = page }.Activate();
        Console.WriteLine("ready");
    }
}
