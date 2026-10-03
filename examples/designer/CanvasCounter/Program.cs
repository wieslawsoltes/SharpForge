using Microsoft.UI.Xaml;
class Program
{
    static int count;
    static void Main() { DesignedView.Create(); }
    public static void OnAction(object sender, RoutedEventArgs args)
    {
        count++;
        DesignedView.v_title.Text = DesignedView.v_TextBox_1.Text + ": " + count;
    }
}
