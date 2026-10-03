using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class Program
{
    static TextBox name;
    static Slider level;
    static ComboBox choice;
    static TextBlock result;
    static ProgressBar progress;
    static void Submit(object sender, RoutedEventArgs args)
    {
        result.Text = "Hello " + name.Text + ", item " + choice.SelectedIndex + ", level " + level.Value;
        progress.Value = level.Value;
    }
    static void Main()
    {
        Window window = new Window();
        window.Title = "Managed form";
        StackPanel form = new StackPanel();
        form.Padding = new Thickness(24);
        form.Spacing = 12;
        name = new TextBox(); name.Name = "Name";
        name.PlaceholderText = "Your name"; name.MaxLength = 80;
        level = new Slider(); level.Name = "Level";
        level.Minimum = 0; level.Maximum = 100; level.Value = 42;
        choice = new ComboBox(); choice.Name = "Choice";
        choice.Items.Add("First"); choice.Items.Add("Second"); choice.Items.Add("Third"); choice.SelectedIndex = 0;
        CheckBox remember = new CheckBox(); remember.Content = "Remember this form";
        ToggleSwitch enabled = new ToggleSwitch(); enabled.Header = "Enable notifications";
        Button submit = new Button(); submit.Content = "Submit"; submit.Click += Submit;
        result = new TextBlock(); result.Name = "Result"; result.Text = "Ready";
        progress = new ProgressBar(); progress.Value = 42;
        Expander details = new Expander(); details.Header = "About this form";
        details.Content = new TextBlock() { Text = "All handlers execute as managed C# in a worker." };
        form.Children.Add(name); form.Children.Add(choice); form.Children.Add(level);
        form.Children.Add(remember); form.Children.Add(enabled); form.Children.Add(submit);
        form.Children.Add(result); form.Children.Add(progress); form.Children.Add(details);
        window.Content = form; window.Activate();
    }
}
