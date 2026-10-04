using System;

class Animal
{
    public string Name;
    public int Legs;
}

class Dog : Animal
{
    public bool Barks = true;
}

class Bird : Animal
{
    public int Wingspan;

    public void Deconstruct(out string name, out int wingspan)
    {
        name = Name;
        wingspan = Wingspan;
    }
}

class Program
{
    static string Day(int number)
    {
        switch (number)
        {
            case 1:
                return "monday";
            case 2:
            case 3:
                return "midweek";
            case 6:
                goto case 7;
            case 7:
                return "weekend";
            default:
                return "other";
        }
    }

    static int Score(string word)
    {
        int score = 0;
        switch (word)
        {
            case "low":
                score = 1;
                break;
            case "high":
                score = 10;
                goto default;
            case null:
                score = -1;
                break;
            default:
                score += 100;
                break;
        }
        return score;
    }

    static string Describe(object value)
    {
        switch (value)
        {
            case int n when n > 100:
                return "big int " + n;
            case int n:
                return "int " + n;
            case string s:
                return "string " + s.Length;
            case Dog d:
                return "dog " + d.Name;
            case null:
                return "null";
            default:
                return "something";
        }
    }

    static string Size(int n) => n switch
    {
        < 0 => "negative",
        0 => "zero",
        > 0 and <= 9 => "digit",
        10 or 20 or 30 => "round",
        _ => "large",
    };

    static string Kind(Animal animal) => animal switch
    {
        Dog { Barks: true, Name: var name } => "barking " + name,
        Dog => "quiet dog",
        Bird(var name, > 50) => "large bird " + name,
        Bird { Legs: 2 } bird => "bird " + bird.Name,
        { Legs: 0 } => "legless",
        not null => "animal",
        _ => "nothing",
    };

    static void Main()
    {
        Console.WriteLine(Day(1) + " " + Day(3) + " " + Day(6) + " " + Day(9));
        Console.WriteLine(Score("low") + " " + Score("high") + " " + Score(null) + " " + Score("x"));
        Console.WriteLine(Describe(7));
        Console.WriteLine(Describe(700));
        Console.WriteLine(Describe("text"));
        Console.WriteLine(Describe(new Dog { Name = "rex" }));
        Console.WriteLine(Describe(null));
        Console.WriteLine(Describe(2.5));
        Console.WriteLine(Size(-3) + " " + Size(0) + " " + Size(7) + " " + Size(20) + " " + Size(21));
        Console.WriteLine(Kind(new Dog { Name = "rex" }));
        Console.WriteLine(Kind(new Dog { Name = "old", Barks = false }));
        Console.WriteLine(Kind(new Bird { Name = "eagle", Wingspan = 200, Legs = 2 }));
        Console.WriteLine(Kind(new Bird { Name = "wren", Wingspan = 15, Legs = 2 }));
        Console.WriteLine(Kind(new Animal { Name = "snake" }));
        Console.WriteLine(Kind(new Animal { Name = "cat", Legs = 4 }));
        Console.WriteLine(Kind(null));
        object boxed = 5;
        if (boxed is int five && five == 5) Console.WriteLine("five");
        if (boxed is not string) Console.WriteLine("not a string");
        if (!(boxed is long)) Console.WriteLine("not a long");
        char grade = 'B';
        switch (grade)
        {
            case 'A':
            case 'B':
                Console.WriteLine("good");
                break;
            default:
                Console.WriteLine("unknown");
                break;
        }
    }
}
