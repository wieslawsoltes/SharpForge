using Microsoft.UI.Xaml.Controls;
public partial class View {
    static ControlTemplate BuildFrame() {
        ControlTemplate template = new ControlTemplate();
        Border frame = new Border();
        TextBlock label = new TextBlock();
        label.Text = "Template";
        frame.Child = label;
        template.VisualTree = frame;
        return template;
    }
}
