class Queries
{
    void M()
    {
        var a = from c in customers select c;
        var b = from Customer c in customers where c.Age > 18 select c.Name;
        var c = from c in customers from o in c.Orders select new { c.Name, o.Total };
        var d = from c in customers let n = c.Name.Length where n > 3 orderby n, c.Name descending, c.Age ascending select c;
        var e = from c in customers join o in orders on c.Id equals o.CustomerId select o;
        var f = from c in customers join Order o in orders on c.Id equals o.CustomerId into g select g.Count();
        var g = from c in customers group c by c.City;
        var h = from c in customers group c.Name by c.City into cities where cities.Count() > 1 select cities.Key;
        var i = from x in (from y in ys select y) select x into z select z;
        var j = from x in xs select from y in x select y;
        var k = F(from x in xs select x, 1);
        int from = 1; from = from + 1; var into = from; var select = into;
        var l = from.ToString();
        var m = from x in xs where x is { Length: > 1 } select x switch { _ => 1 };
    }
}
