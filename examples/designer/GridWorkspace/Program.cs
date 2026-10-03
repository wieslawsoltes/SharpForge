using Microsoft.UI.Xaml;
class Program
{
    static void Main() { DesignedView.Create(); }
    public static void OnAction(object sender, RoutedEventArgs args)
    {
        Console.WriteLine("OnAction invoked");
    }
}
