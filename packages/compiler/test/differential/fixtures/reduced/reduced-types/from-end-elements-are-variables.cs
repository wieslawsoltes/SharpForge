using System;

// Reduced from stress-arrays/jagged-array-methods: an array (or span) element reached with an index from the end is a
// variable - a mutating method, a field assignment and `ref` act on the element, not on a copy.
public struct Account
{
    public string Owner;
    public int Balance;
    public void Deposit(int amount) => Balance += amount;
}

public static class Program
{
    private static void Add(ref Account account, int amount) => account.Balance += amount;

    public static void Main()
    {
        Account[] accounts = { new Account { Owner = "a", Balance = 10 }, new Account { Owner = "b", Balance = 20 }, new Account { Owner = "c", Balance = 30 } };
        accounts[^1].Deposit(70);
        accounts[^2].Balance += 5;
        accounts[^3].Owner = "first";
        Add(ref accounts[^1], 1);
        ref Account middle = ref accounts[^2];
        middle.Deposit(100);
        Index last = ^1;
        accounts[last].Deposit(1000);
        Span<Account> span = accounts;
        span[^1].Deposit(10000);
        span[^3].Balance++;
        int[] numbers = { 1, 2, 3 };
        numbers[^1] += 10;
        numbers[^2]++;
        ref int head = ref numbers[^3];
        head = -1;
        foreach (Account account in accounts) Console.WriteLine(account.Owner + "=" + account.Balance);
        Console.WriteLine(string.Join(",", numbers));
    }
}
