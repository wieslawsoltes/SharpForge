import { component, winuiUsings as X } from '../common.js';

export const legacyWinuiItems = {
'winui-page': n => (component(n,
'Page',
`        StackPanel panel = new StackPanel();
        panel.Padding = new Thickness(24);
        panel.Spacing = 16;
        TextBlock title = new TextBlock();
        title.Text = "${n}";
        title.FontSize = 28;
        panel.Children.Add(title);
        View.Content = panel;`)),
'winui-counter-page': n => (component(n,
'Page',
`        StackPanel panel = new StackPanel();
        panel.Padding = new Thickness(24);
        panel.Spacing = 16;
        TextBlock title = new TextBlock();
        title.Text = "Welcome to your WinUI app";
        title.FontSize = 28;
        display = new TextBlock();
        display.Name = "CounterDisplay";
        display.Text = "Count: 0";
        display.FontSize = 36;
        Button button = new Button();
        button.Content = "Increment";
        button.Click += Increment;
        panel.Children.Add(title);
        panel.Children.Add(display);
        panel.Children.Add(button);
        View.Content = panel;`,
`    private TextBlock display;
    private int count;
    private void Increment(object sender, RoutedEventArgs args)
    {
        count++;
        display.Text = "Count: " + count;
    }
`)),
'winui-grid-page': n => (component(n,
'Page',
`        Grid grid = new Grid();
        grid.RowSpacing = 12;
        grid.ColumnSpacing = 12;
        RowDefinition header = new RowDefinition();
        header.Height = GridLength.Auto;
        grid.RowDefinitions.Add(header);
        grid.RowDefinitions.Add(new RowDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        TextBlock title = new TextBlock();
        title.Text = "${n}";
        title.FontSize = 28;
        Grid.SetColumnSpan(title, 2);
        grid.Children.Add(title);
        Button content = new Button();
        content.Content = "Content";
        Grid.SetRow(content, 1);
        Grid.SetColumn(content, 1);
        grid.Children.Add(content);
        View.Content = grid;`)),
'winui-settings-page': n => (component(n,
'Page',
`        StackPanel panel = new StackPanel();
        panel.Padding = new Thickness(24);
        panel.Spacing = 12;
        TextBlock title = new TextBlock();
        title.Text = "Settings";
        title.FontSize = 28;
        input = new TextBox();
        input.PlaceholderText = "Display name";
        enabled = new CheckBox();
        enabled.Content = "Enable feature";
        result = new TextBlock();
        Button apply = new Button();
        apply.Content = "Apply settings";
        apply.Click += Apply;
        panel.Children.Add(title);
        panel.Children.Add(input);
        panel.Children.Add(enabled);
        panel.Children.Add(apply);
        panel.Children.Add(result);
        View.Content = panel;`,
`    private TextBox input;
    private CheckBox enabled;
    private TextBlock result;
    private void Apply(object sender, RoutedEventArgs args)
    {
        result.Text = "Saved: " + input.Text;
    }
`)),
'winui-user-control': n => (component(n,
'UserControl',
`        Border border = new Border();
        border.Padding = new Thickness(16);
        border.CornerRadius = new CornerRadius(8);
        border.Background = new SolidColorBrush(Colors.DodgerBlue);
        caption = new TextBlock();
        caption.Text = "Reusable control";
        caption.Foreground = new SolidColorBrush(Colors.White);
        border.Child = caption;
        View.Content = border;`,
`    private TextBlock caption;
    public void SetCaption(string value)
    {
        caption.Text = value;
    }
`)),
'winui-custom-control': n => (component(n,
'Border',
`        View.Padding = new Thickness(16);
        View.CornerRadius = new CornerRadius(6);
        View.Background = new SolidColorBrush(Colors.DodgerBlue);
        TextBlock label = new TextBlock();
        label.Text = "Ready";
        label.Foreground = new SolidColorBrush(Colors.White);
        View.Child = label;`)),
'winui-window': n => (component(n,
'Window',
`        View.Title = "${n}";
        View.Content = new TextBlock() { Text = "Tool window", FontSize = 24 };`,
`    public void Activate()
    {
        View.Activate();
    }
`)),
'winui-flyout': n => (component(n,
'MenuFlyout',
`        MenuFlyoutItem action = new MenuFlyoutItem();
        action.Text = "Run action";
        action.Click += Run;
        View.Items.Add(action);`,
`    private void Run(object sender, RoutedEventArgs args)
    {
        Console.WriteLine("Action selected");
    }
`,
X+'using System;\n')),
'winui-resources': n => ({
  usings:X,
  body:`public static class ${n}
{
    public static SolidColorBrush Accent()
    {
        return new SolidColorBrush(Colors.DodgerBlue);
    }
}`
}
),
};
