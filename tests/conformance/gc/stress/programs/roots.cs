using System;
class Node { public string Text; public Node Next; public Node(string text, Node next) { Text=text; Next=next; } }
class Program { static void Main() { Node root=new Node("root",new Node("leaf",null)); for(int i=0;i<20;i++){ var garbage=new Node("garbage"+i,null); } Console.WriteLine(root.Text); Console.WriteLine(root.Next.Text); } }
