using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class Program
{
    static NumberBox amount; static TextBlock status; static TabView tabs; static TabViewItem second;
    static void Changed(object sender, RoutedEventArgs args) { status.Text = "Amount: " + amount.Value; }
    static void CloseTab(object sender, RoutedEventArgs args) { tabs.TabItems.Remove(second); }
    static void Main()
    {
        StackPanel panel = new StackPanel(); panel.Spacing = 10; panel.Padding = new Thickness(24);
        status = new TextBlock(); status.Text = "Interactive control gallery"; status.FontSize = 24;
        amount = new NumberBox(); amount.Name = "Amount"; amount.Header = "Amount"; amount.Value = 42; amount.Minimum = 0; amount.Maximum = 100; amount.ValueChanged += Changed;
        AutoSuggestBox search = new AutoSuggestBox(); search.PlaceholderText = "Search (text input)";
        ToggleButton toggle = new ToggleButton(); toggle.Content = "Toggle selection";
        RadioButton radio1 = new RadioButton(); radio1.Content = "First"; radio1.GroupName = "Demo";
        RadioButton radio2 = new RadioButton(); radio2.Content = "Second"; radio2.GroupName = "Demo";
        CalendarDatePicker date = new CalendarDatePicker(); date.Date = "2026-10-03";
        TimePicker time = new TimePicker(); time.Time = "14:30";
        InfoBar info = new InfoBar(); info.Title = "Managed controls"; info.Message = "Inputs update managed state. Close the second tab.";
        tabs = new TabView(); TabViewItem first = new TabViewItem(); first.Header = "Home"; first.Content = "First tab content"; first.IsClosable = false;
        second = new TabViewItem(); second.Header = "Details"; second.Content = "Closable tab content"; second.CloseRequested += CloseTab;
        tabs.TabItems.Add(first); tabs.TabItems.Add(second);
        panel.Children.Add(status); panel.Children.Add(amount); panel.Children.Add(search); panel.Children.Add(toggle); panel.Children.Add(radio1); panel.Children.Add(radio2); panel.Children.Add(date); panel.Children.Add(time); panel.Children.Add(info); panel.Children.Add(tabs);
        ScrollViewer scroll = new ScrollViewer(); scroll.Content = panel;
        Window window = new Window(); window.Title = "Expanded WinUI controls"; window.Content = scroll; window.Activate();
    }
}
