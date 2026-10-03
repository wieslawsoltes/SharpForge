using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

class Program
{
    static void Main(string[] args)
    {
        var window = new Window();
        window.Title = "APP_NAME";
        var text = new TextBlock();
        text.Text = "APP_NAME window";
        window.Content = text;
        window.Activate();
        Console.WriteLine("APP_OUTPUT");
        Console.WriteLine(args[0]);
        Console.WriteLine(Environment.GetEnvironmentVariable("APP_ENV"));
    }
}
