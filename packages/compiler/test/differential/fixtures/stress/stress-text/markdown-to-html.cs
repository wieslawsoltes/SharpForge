using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

public enum BlockKind { Paragraph, Heading, ListItem, Code, Quote, Rule }

public sealed class Block
{
    public Block(BlockKind kind, string text, int level = 0) { Kind = kind; Text = text; Level = level; }
    public BlockKind Kind { get; }
    public string Text { get; set; }
    public int Level { get; }
}

public static class Markdown
{
    public static List<Block> Parse(string source)
    {
        var blocks = new List<Block>();
        bool inCode = false;
        var code = new StringBuilder();
        foreach (string raw in source.Split('\n'))
        {
            string line = raw.TrimEnd();
            if (line.StartsWith("```"))
            {
                if (inCode) { blocks.Add(new Block(BlockKind.Code, code.ToString().TrimEnd('\n'))); code.Clear(); }
                inCode = !inCode;
                continue;
            }
            if (inCode) { code.Append(line).Append('\n'); continue; }
            if (line.Length == 0) { blocks.Add(null); continue; }
            int hashes = line.TakeWhile(c => c == '#').Count();
            Block last = blocks.Count > 0 ? blocks[blocks.Count - 1] : null;
            if (hashes is > 0 and <= 6 && line.Length > hashes && line[hashes] == ' ') blocks.Add(new Block(BlockKind.Heading, line.Substring(hashes + 1), hashes));
            else if (line == "---" || line == "***") blocks.Add(new Block(BlockKind.Rule, ""));
            else if (line.StartsWith("- ") || line.StartsWith("* ")) blocks.Add(new Block(BlockKind.ListItem, line.Substring(2)));
            else if (line.StartsWith("> ")) blocks.Add(new Block(BlockKind.Quote, line.Substring(2)));
            else if (last is { Kind: BlockKind.Paragraph or BlockKind.Quote or BlockKind.ListItem }) last.Text += " " + line.TrimStart();
            else blocks.Add(new Block(BlockKind.Paragraph, line));
        }
        if (inCode) blocks.Add(new Block(BlockKind.Code, code.ToString().TrimEnd('\n')));
        blocks.RemoveAll(block => block == null);
        return blocks;
    }

    public static string Escape(string text) => text.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

    public static string Inline(string text)
    {
        var output = new StringBuilder();
        var open = new Stack<string>();
        for (int i = 0; i < text.Length; i++)
        {
            char c = text[i];
            if (c == '\\' && i + 1 < text.Length) { output.Append(text[++i]); continue; }
            if (c == '`')
            {
                int end = text.IndexOf('`', i + 1);
                if (end > i) { output.Append("<code>").Append(Escape(text.Substring(i + 1, end - i - 1))).Append("</code>"); i = end; continue; }
            }
            if (c == '[')
            {
                int close = text.IndexOf("](", i, StringComparison.Ordinal), end = close < 0 ? -1 : text.IndexOf(')', close);
                if (end > 0)
                {
                    output.Append("<a href=\"").Append(text, close + 2, end - close - 2).Append("\">").Append(Inline(text.Substring(i + 1, close - i - 1))).Append("</a>");
                    i = end;
                    continue;
                }
            }
            if (c == '*' || c == '_')
            {
                bool strong = i + 1 < text.Length && text[i + 1] == c;
                string tag = strong ? "strong" : "em";
                if (strong) i++;
                if (open.Count > 0 && open.Peek() == tag) { open.Pop(); output.Append("</").Append(tag).Append('>'); }
                else { open.Push(tag); output.Append('<').Append(tag).Append('>'); }
                continue;
            }
            output.Append(c switch { '&' => "&amp;", '<' => "&lt;", '>' => "&gt;", _ => c.ToString() });
        }
        while (open.Count > 0) output.Append("</").Append(open.Pop()).Append('>');
        return output.ToString();
    }

    public static string ToHtml(IReadOnlyList<Block> blocks)
    {
        var html = new StringBuilder();
        for (int i = 0; i < blocks.Count; i++)
        {
            var block = blocks[i];
            bool previousIsItem = i > 0 && blocks[i - 1].Kind == BlockKind.ListItem, nextIsItem = i + 1 < blocks.Count && blocks[i + 1].Kind == BlockKind.ListItem;
            switch (block.Kind)
            {
                case BlockKind.Heading:
                    html.AppendFormat("<h{0} id=\"{1}\">{2}</h{0}>\n", block.Level, Slug(block.Text), Inline(block.Text));
                    break;
                case BlockKind.ListItem:
                    if (!previousIsItem) html.Append("<ul>\n");
                    html.Append("  <li>").Append(Inline(block.Text)).Append("</li>\n");
                    if (!nextIsItem) html.Append("</ul>\n");
                    break;
                case BlockKind.Code: html.Append("<pre>").Append(Escape(block.Text)).Append("</pre>\n"); break;
                case BlockKind.Quote: html.Append("<blockquote>").Append(Inline(block.Text)).Append("</blockquote>\n"); break;
                case BlockKind.Rule: html.Append("<hr/>\n"); break;
                default: html.Append("<p>").Append(Inline(block.Text)).Append("</p>\n"); break;
            }
        }
        return html.ToString();
    }

    public static string Slug(string heading)
    {
        var slug = new StringBuilder();
        foreach (char c in heading.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c)) slug.Append(c);
            else if (slug.Length > 0 && slug[slug.Length - 1] != '-') slug.Append('-');
        }
        return slug.ToString().Trim('-');
    }

    public static IEnumerable<string> Wrap(string text, int width)
    {
        var line = new StringBuilder();
        foreach (string word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (line.Length > 0 && line.Length + 1 + word.Length > width) { yield return line.ToString(); line.Clear(); }
            if (line.Length > 0) line.Append(' ');
            line.Append(word);
        }
        if (line.Length > 0) yield return line.ToString();
    }
}

public static class Program
{
    public static void Main()
    {
        string source = "# Sharp *Forge* & Friends\n\nA **bold** claim with _emphasis_, `a < b` code and a [link *text*](http://x.y/?a=1&b=2).\ncontinued on the next line with an unclosed *star\n\n"
            + "## Features: fast, <small>\n- first item\n- second **item**\n  wrapped\n* third \\*escaped\\*\n\n> quoted\n> text\n\n---\n```\nif (a < b && c > d) { }\n  indented\n```\n####### not a heading\n#also not\n```\nunterminated";
        var blocks = Markdown.Parse(source);
        Console.WriteLine(string.Join(" ", blocks.GroupBy(b => b.Kind).Select(g => g.Key + "=" + g.Count())));
        Console.Write(Markdown.ToHtml(blocks));
        Console.WriteLine(Markdown.Slug("  Hello, World! 2024 -- (C#) ") + " " + Markdown.Slug("***") .Length + " " + Markdown.Inline("**a*b**c*") + " " + Markdown.Inline("[x](y") + " " + Markdown.Inline("``"));
        string paragraph = "The quick brown fox jumps over the lazy dog while a supercalifragilistic word overflows the width";
        foreach (var line in Markdown.Wrap(paragraph, 24)) Console.WriteLine("|" + line.PadRight(24) + "|" + line.Length.ToString().PadLeft(3));
        Console.WriteLine(Markdown.Wrap("", 10).Count() + " " + Markdown.Wrap("one", 1).Single() + " " + Markdown.ToHtml(new List<Block>()).Length);
    }
}
