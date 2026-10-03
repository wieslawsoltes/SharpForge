using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;

namespace ItemGallery
{
    // Code-first SharpForge component: use .View. User inheritance from WinUI classes
    // and XAML/ControlTemplate/DataTemplate loading are not part of this profile.
    public partial class WinuiGridPageExample
    {
        public Page View { get; private set; }

        public WinuiGridPageExample()
        {
            View = new Page();
            Grid grid = new Grid();
            grid.RowSpacing = 12;
            grid.ColumnSpacing = 12;
            RowDefinition header = new RowDefinition();
            header.Height = GridLength.Auto;
            grid.RowDefinitions.Add(header);
            grid.RowDefinitions.Add(new RowDefinition());
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            TextBlock title = new TextBlock();
            title.Text = "WinuiGridPageExample";
            title.FontSize = 28;
            Grid.SetColumnSpan(title, 2);
            grid.Children.Add(title);
            Button content = new Button();
            content.Content = "Content";
            Grid.SetRow(content, 1);
            Grid.SetColumn(content, 1);
            grid.Children.Add(content);
            View.Content = grid;
        }
    }
}
