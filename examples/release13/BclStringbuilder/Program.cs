using System.Text;
var words = " alpha,beta,gamma ".Trim().ToUpperInvariant().Split(",");
var builder = new StringBuilder();
builder.Append(string.Join(" | ", words)).AppendLine();
builder.AppendFormat("Answer: {0:D4}", 42);
Console.WriteLine(builder.ToString());
