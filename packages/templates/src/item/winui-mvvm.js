import { joinPath } from '../common.js';
import { xamlNamespace } from './winui-xaml.js';

export function viewModelSource(name, namespace) {
  return `using System.ComponentModel;\nusing System.Runtime.CompilerServices;\n\nnamespace ${namespace};\n\n` +
    `public sealed class ${name} : INotifyPropertyChanged\n{\n    private string displayName = "User";\n` +
    '    public event PropertyChangedEventHandler? PropertyChanged;\n' +
    '    public string DisplayName\n    {\n        get => displayName;\n        set\n        {\n' +
    '            if (displayName == value) return;\n            displayName = value;\n            OnPropertyChanged();\n        }\n    }\n' +
    '    public RelayCommand ResetCommand { get; }\n' +
    `    public ${name}() { ResetCommand = new RelayCommand(() => DisplayName = "User"); }\n` +
    '    private void OnPropertyChanged([CallerMemberName] string? propertyName = null)\n    {\n' +
    '        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));\n    }\n}\n';
}

export function relayCommandSource(namespace) {
  return `using System;\nusing System.Windows.Input;\n\nnamespace ${namespace};\n\npublic sealed class RelayCommand : ICommand\n{\n` +
    '    private readonly Action execute;\n    private readonly Func<bool>? canExecute;\n' +
    '    public RelayCommand(Action execute, Func<bool>? canExecute = null)\n    {\n' +
    '        this.execute = execute ?? throw new ArgumentNullException(nameof(execute));\n        this.canExecute = canExecute;\n    }\n' +
    '    public event EventHandler? CanExecuteChanged;\n    public bool CanExecute(object? parameter) => canExecute?.Invoke() ?? true;\n' +
    '    public void Execute(object? parameter) { if (CanExecute(parameter)) execute(); }\n' +
    '    public void NotifyCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);\n}\n';
}

export function generateMvvmItem(template, options) {
  const { namespace, folder, identifier } = options;
  const records = [];
  const put = (path, text) => records.push({ path: joinPath(folder, path), text });
  const model = template.id === 'winui-mvvm-shell' ? identifier + 'ViewModel' : identifier;
  put(model + '.cs', viewModelSource(model, namespace));
  if (!options.existing.some(file => file.path === joinPath(folder, 'RelayCommand.cs'))) put('RelayCommand.cs', relayCommandSource(namespace));
  if (template.id === 'winui-mvvm-shell') {
    const home = identifier + 'Home';
    const settings = identifier + 'Settings';
    put(identifier + '.xaml', `<Page x:Class="${namespace}.${identifier}" ${xamlNamespace}>\n` +
      '  <NavigationView x:Name="Navigation" IsSettingsVisible="false" ItemInvoked="Navigate">\n' +
      '    <NavigationView.MenuItems><NavigationViewItem Content="Home" Tag="home" />' +
      '<NavigationViewItem Content="Settings" Tag="settings" /></NavigationView.MenuItems>\n' +
      '    <Frame x:Name="ContentFrame" />\n  </NavigationView>\n</Page>\n');
    put(identifier + '.xaml.cs', `using System;\nusing Microsoft.UI.Xaml.Controls;\n\nnamespace ${namespace};\n\n` +
      `public sealed partial class ${identifier} : Page\n{\n    public ${identifier}()\n    {\n        InitializeComponent();\n` +
      '        NavigateTo("home");\n    }\n' +
      '    public bool NavigateTo(string destination)\n    {\n' +
      `        if (destination == "home") return ContentFrame.Navigate(typeof(${home}));\n` +
      `        if (destination == "settings") return ContentFrame.Navigate(typeof(${settings}));\n` +
      '        throw new ArgumentException("Unknown navigation destination.", nameof(destination));\n    }\n' +
      '    private void Navigate(NavigationView sender, NavigationViewItemInvokedEventArgs args)\n    {\n' +
      '        NavigateTo(args.InvokedItemContainer?.Tag?.ToString() == "settings" ? "settings" : "home");\n    }\n}\n');
    put(home + '.xaml', `<Page x:Class="${namespace}.${home}" ${xamlNamespace}>\n` +
      '  <Grid><TextBlock Text="Home" FontSize="28" /></Grid>\n</Page>\n');
    put(home + '.xaml.cs', `using Microsoft.UI.Xaml.Controls;\nnamespace ${namespace};\npublic sealed partial class ${home} : Page\n{\n` +
      `    public ${home}() { InitializeComponent(); }\n}\n`);
    put(settings + '.xaml', `<Page x:Class="${namespace}.${settings}" ${xamlNamespace}>\n  <StackPanel Spacing="12">\n` +
      '    <TextBox Header="Display name" Text="{x:Bind Model.DisplayName, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}" />\n' +
      '    <TextBlock Text="{x:Bind Model.DisplayName, Mode=OneWay}" />\n' +
      '    <Button Content="Reset" Command="{x:Bind Model.ResetCommand}" />\n  </StackPanel>\n</Page>\n');
    put(settings + '.xaml.cs', `using Microsoft.UI.Xaml.Controls;\nnamespace ${namespace};\npublic sealed partial class ${settings} : Page\n{\n` +
      `    public ${model} Model { get; } = new ${model}();\n    public ${settings}() { InitializeComponent(); }\n}\n`);
  }
  const membership = records.filter(record => record.path.endsWith('.xaml.cs')).map(record => ({
    path: record.path, itemType: 'Compile', metadata: { DependentUpon: record.path.split('/').at(-1).replace(/\.cs$/, '') }
  }));
  return { records, membership, warnings: template.id === 'winui-mvvm-shell' ?
    ['Native WinUI XAML, x:Bind and navigation qualification are required on Windows.'] : [] };
}
