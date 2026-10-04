using System;

class Account
{
    static int created = 0;
    readonly string owner;
    int balance;

    public Account(string owner) : this(owner, 0) { }

    public Account(string owner, int balance)
    {
        this.owner = owner;
        this.balance = balance;
        created++;
    }

    public int Balance { get { return balance; } }
    public string Owner => owner;
    public int Limit { get; set; } = 100;
    public static int Created => created;

    public void Deposit(int amount, int times = 1)
    {
        for (int i = 0; i < times; i++) balance += amount;
    }

    public bool Withdraw(int amount)
    {
        if (amount > balance + Limit) return false;
        balance -= amount;
        return true;
    }

    public static int Total(params int[] parts)
    {
        int total = 0;
        foreach (int part in parts) total += part;
        return total;
    }

    public static string Describe(string name, int age = 30, string city = "nowhere")
    {
        return name + " " + age + " " + city;
    }
}

class Program
{
    static void Main()
    {
        var account = new Account("ann");
        account.Deposit(50);
        account.Deposit(10, times: 3);
        Console.WriteLine(account.Balance);
        Console.WriteLine(account.Withdraw(500));
        account.Limit += 400;
        Console.WriteLine(account.Withdraw(500));
        Console.WriteLine(account.Balance);
        Console.WriteLine(account.Owner);
        var second = new Account("bob", 7);
        Console.WriteLine(second.Balance + Account.Created);
        Console.WriteLine(Account.Total());
        Console.WriteLine(Account.Total(1, 2, 3));
        Console.WriteLine(Account.Describe("eve"));
        Console.WriteLine(Account.Describe("eve", city: "paris"));
        Console.WriteLine(Account.Describe(city: "rome", name: "max", age: 4));
    }
}
