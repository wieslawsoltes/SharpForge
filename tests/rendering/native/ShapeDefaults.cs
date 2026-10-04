using System;
using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Shapes = Microsoft.UI.Xaml.Shapes;

internal static class ShapeDefaults
{
    internal static List<object> Observe()
    {
        var result = new List<object>();
        foreach (var shape in new Shapes.Shape[] { new Shapes.Rectangle(), new Shapes.Ellipse(), new Shapes.Line(),
            new Shapes.Path(), new Shapes.Polygon(), new Shapes.Polyline() })
        {
            result.Add(new
            {
                type = shape.GetType().FullName,
                strokeThickness = shape.StrokeThickness,
                stretch = shape.Stretch.ToString(),
                strokeHasLocalValue = !ReferenceEquals(shape.ReadLocalValue(Shapes.Shape.StrokeThicknessProperty), DependencyProperty.UnsetValue),
                stretchHasLocalValue = !ReferenceEquals(shape.ReadLocalValue(Shapes.Shape.StretchProperty), DependencyProperty.UnsetValue)
            });
        }
        return result;
    }
}
