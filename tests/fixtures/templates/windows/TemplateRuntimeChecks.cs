using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;

namespace RuntimeHost;

internal static class TemplateRuntimeChecks
{
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static Task Idle(Window window)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        Check(window.DispatcherQueue.TryEnqueue(() => completion.TrySetResult(true)), "Dispatcher enqueue failed.");
        return completion.Task.WaitAsync(TimeSpan.FromSeconds(10));
    }

    private static async Task Show(Window window, FrameworkElement view)
    {
        var loaded = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        RoutedEventHandler handler = (_, _) => loaded.TrySetResult(true);
        view.Loaded += handler;
        try
        {
            window.Content = view;
            await loaded.Task.WaitAsync(TimeSpan.FromSeconds(10));
            await Idle(window);
            view.UpdateLayout();
        }
        finally { view.Loaded -= handler; }
    }

    private static ResourceDictionary Dictionary(string name)
        => new ResourceDictionary { Source = new Uri("ms-appx:///" + name) };

    private static async Task Animate(Storyboard storyboard, Action? begin = null)
    {
        var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        EventHandler<object> handler = (_, _) => completed.TrySetResult(true);
        storyboard.Completed += handler;
        try
        {
            if (begin == null) storyboard.Begin();
            else begin();
            await completed.Task.WaitAsync(TimeSpan.FromSeconds(10));
        }
        finally { storyboard.Completed -= handler; }
    }

    private static async Task CheckPairs(Window window)
    {
        var page = new GeneratedPage();
        var userControl = new GeneratedUserControl();
        var dialog = new GeneratedDialog();
        await Show(window, page);
        Check(page.Content is Grid && userControl.Content is Grid && dialog.Title.ToString() == "Dialog", "Generated XAML pairs.");
        var secondary = new GeneratedWindow();
        try { secondary.Activate(); Check(secondary.Content is Grid, "Generated Window contents."); }
        finally { secondary.Close(); }
    }

    private static async Task CheckControls(Window window)
    {
        var panel = new StackPanel();
        var badge = new Badge { Width = 80, Height = 32, Background = new SolidColorBrush(Colors.CornflowerBlue) };
        var alert = new AlertBadge { Width = 80, Height = 32, Background = new SolidColorBrush(Colors.Orange) };
        panel.Children.Add(badge);
        panel.Children.Add(alert);
        await Show(window, panel);
        badge.ApplyTemplate();
        alert.ApplyTemplate();
        Check(VisualTreeHelper.GetChildrenCount(badge) > 0 && VisualTreeHelper.GetChildrenCount(alert) > 0, "Default styles must render.");
        Check(VisualTreeHelper.GetChild(badge, 0) is Border border && border.Background is SolidColorBrush rendered
            && rendered.Color.Equals(((SolidColorBrush)badge.Background).Color),
            "Generic.xaml TemplateBinding must supply the rendered background.");
        Check(badge.ActualWidth == 80 && badge.ActualHeight == 32, "Templated control layout.");
        var defaults = Dictionary("Themes/Generic.xaml");
        Check(defaults.Count == 2 && defaults.ContainsKey(typeof(Badge)) && defaults.ContainsKey(typeof(AlertBadge)), "Unique default style keys.");
    }

    private static void CheckDictionaries()
    {
        var palette = Dictionary("Palette.xaml");
        var style = Dictionary("ButtonStyle.xaml");
        var controlTemplate = Dictionary("ButtonTemplate.xaml");
        var dataTemplate = Dictionary("RowTemplate.xaml");
        foreach (var dictionary in new[] { palette, style, controlTemplate, dataTemplate })
            Application.Current.Resources.MergedDictionaries.Add(dictionary);
        Check(Application.Current.Resources.ContainsKey("PaletteAccentBrush"), "Merged palette key.");
        Check(Application.Current.Resources["ButtonStyle"] is Style, "Merged style.");
        Check(Application.Current.Resources["ButtonTemplate"] is Style, "Merged control template style.");
        Check(Application.Current.Resources["RowTemplate"] is DataTemplate, "Merged data template.");
    }

    private static async Task CheckStoryboards(Window window)
    {
        var target = new Border { Width = 40, Height = 40, Opacity = 0.25 };
        await Show(window, target);
        var fade = Fade.Create(target);
        await Animate(fade);
        Check(Math.Abs(target.Opacity - 1) < 0.01, "Generated code storyboard completion.");
        fade.Stop();
        Check(Math.Abs(target.Opacity - 0.25) < 0.01, "Storyboard Stop restores its base value.");
        var markup = (Grid)XamlReader.Load(GeneratedMarkup.Storyboard);
        await Show(window, markup);
        var xamlFade = (Storyboard)markup.Resources["FadeResources"];
        await Animate(xamlFade);
        Check(Math.Abs(((Border)markup.FindName("AnimatedElement")).Opacity - 1) < 0.01, "Generated XAML storyboard namescope.");
        xamlFade.Stop();
    }

    private static async Task CheckVisualStates(Window window)
    {
        var transition = new TransitionPage();
        await Show(window, transition);
        Check(((Grid)transition.Content).ChildrenTransitions.Count == 1, "Generated entrance transition.");
        var states = new StatePage();
        await Show(window, states);
        Check(VisualStateManager.GoToState(states, "Hidden", false), "Hidden visual state exists.");
        Check(((TextBlock)states.FindName("AnimatedElement")).Opacity == 0, "Hidden state setter applies.");
        var group = (VisualStateGroup)VisualStateManager.GetVisualStateGroups((Grid)states.Content)[0];
        var visible = (VisualState)group.States[1];
        await Animate(visible.Storyboard, () => Check(VisualStateManager.GoToState(states, "Visible", false), "Visible visual state exists."));
        Check(Math.Abs(((TextBlock)states.FindName("AnimatedElement")).Opacity - 1) < 0.01, "Visible state animation.");
    }

    private static async Task CheckMvvm(Window window)
    {
        var shell = new Shell();
        await Show(window, shell);
        var frame = (Frame)shell.FindName("ContentFrame");
        Check(frame.Content is ShellHome, "Initial generated Home page.");
        Check(shell.NavigateTo("settings"), "Navigate to generated Settings page.");
        await Idle(window);
        var settings = (ShellSettings)frame.Content;
        var settingsPanel = (StackPanel)settings.Content;
        var editor = (TextBox)settingsPanel.Children[0];
        var label = (TextBlock)settingsPanel.Children[1];
        var reset = (Button)settingsPanel.Children[2];
        settings.Model.DisplayName = "Ada";
        await Idle(window);
        Check(editor.Text == "Ada" && label.Text == "Ada", "Model notifications update the UI.");
        editor.Text = "Grace";
        await Idle(window);
        Check(settings.Model.DisplayName == "Grace" && label.Text == "Grace", "Two-way x:Bind updates the model and label.");
        reset.Command.Execute(null);
        await Idle(window);
        Check(editor.Text == "User" && label.Text == "User", "Generated reset command updates the UI.");
        Check(shell.NavigateTo("home") && frame.Content is ShellHome, "Navigate back to generated Home page.");
        bool rejected = false;
        try { shell.NavigateTo("unknown"); } catch (ArgumentException) { rejected = true; }
        Check(rejected && frame.Content is ShellHome, "Unknown destination cannot change navigation.");
    }

    internal static async Task<object> Run(Window window)
    {
        Check(window.DispatcherQueue.HasThreadAccess, "Qualification must run on the XAML UI thread.");
        var checks = new List<string>();
        await CheckPairs(window);
        checks.Add("native XAML pairs instantiate");
        await CheckControls(window);
        checks.Add("default control styles render");
        CheckDictionaries();
        checks.Add("resource dictionaries merge unique keys");
        await CheckStoryboards(window);
        checks.Add("generated storyboards execute");
        await CheckVisualStates(window);
        checks.Add("generated transition and visual states execute");
        await CheckMvvm(window);
        checks.Add("generated MVVM bindings update UI");
        checks.Add("generated pages navigate and reject unknown routes");
        return new { engine = "native Windows App SDK", runtime = Environment.Version.ToString(),
            platform = System.Runtime.InteropServices.RuntimeInformation.OSDescription, checks };
    }
}
