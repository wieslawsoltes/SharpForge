#nullable enable
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;

public abstract class Observable : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }

    protected void Raise([CallerMemberName] string name = "") => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

public sealed class Account : Observable
{
    private string owner = "";
    private decimal balance;
    private readonly List<decimal> history = new();
    private EventHandler<decimal>? overdrawn;

    public required string Id { get; init; }
    public string Owner { get => owner; set => Set(ref owner, value.Trim()); }
    public decimal Balance
    {
        get => balance;
        private set
        {
            if (Set(ref balance, value)) Raise(nameof(IsEmpty));
        }
    }
    public bool IsEmpty => balance == 0;
    public int Limit { get; set; } = 100;
    public IReadOnlyList<decimal> History => history;
    public static int Opened { get; private set; }
    public string? Note { get; set; }
    public DateTime Created { get; } = new DateTime(2024, 1, 1);
    public int Version { get; private set; }

    public Account() { Opened++; }

    public event EventHandler<decimal> Overdrawn
    {
        add { overdrawn += value; Version++; }
        remove { overdrawn -= value; Version--; }
    }

    public void Deposit(decimal amount)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount));
        history.Add(amount);
        Balance += amount;
    }

    public bool Withdraw(decimal amount)
    {
        if (Balance - amount < -Limit)
        {
            overdrawn?.Invoke(this, amount - Balance);
            return false;
        }
        history.Add(-amount);
        Balance -= amount;
        return true;
    }
}

public class Temperature
{
    private double kelvin;
    public double Kelvin
    {
        get => kelvin;
        set => kelvin = value >= 0 ? value : throw new ArgumentOutOfRangeException(nameof(value), "below absolute zero");
    }
    public double Celsius { get => kelvin - 273.15; set => Kelvin = value + 273.15; }
    public double Fahrenheit { get => Celsius * 9 / 5 + 32; init => Celsius = (value - 32) * 5 / 9; }
    public static Temperature Boiling { get; } = new Temperature { Celsius = 100 };
    public virtual string Unit { get; protected set; } = "K";
    public int Reads { get; private set; }
    public double Checked { get { Reads++; return kelvin; } }
}

public sealed class Lab : Temperature
{
    public override string Unit { get => base.Unit + "(lab)"; protected set => base.Unit = value.ToLowerInvariant(); }
    public void Rename(string unit) => Unit = unit;
}

public static class Program
{
    public static void Main()
    {
        var changes = new List<string>();
        var account = new Account { Id = "ACC-1", Owner = "  Ada ", Limit = 50 };
        account.PropertyChanged += (sender, e) => changes.Add(e.PropertyName + "@" + ((Account)sender!).Balance);
        var alerts = new List<string>();
        EventHandler<decimal> alert = (sender, shortfall) => alerts.Add($"short by {shortfall}");
        account.Overdrawn += alert;
        account.Overdrawn += alert;
        account.Deposit(100);
        account.Owner = "Ada";
        account.Owner = "Grace";
        Console.WriteLine(account.Withdraw(120) + " " + account.Withdraw(40) + " " + account.Balance + " " + account.IsEmpty);
        account.Overdrawn -= alert;
        account.Withdraw(500);
        account.Deposit(20);
        Console.WriteLine(string.Join(" ", changes));
        Console.WriteLine(string.Join(" ", alerts) + " | " + account.Version + " " + string.Join(",", account.History) + " " + Account.Opened + " " + (account.Note ?? "no note") + " " + account.Note?.Length + " " + account.Created.Year + " " + account.Id + " " + account.Owner.Length);
        try { account.Deposit(0); }
        catch (ArgumentOutOfRangeException e) { Console.WriteLine(e.ParamName); }

        var t = new Temperature { Fahrenheit = 212 };
        Console.WriteLine(Math.Round(t.Kelvin, 2) + " " + Math.Round(t.Celsius, 2) + " " + Math.Round(Temperature.Boiling.Fahrenheit, 2) + " " + t.Unit);
        t.Celsius -= 100;
        t.Kelvin *= 2;
        _ = t.Checked + t.Checked;
        Console.WriteLine(Math.Round(t.Celsius, 2) + " " + t.Reads);
        try { t.Celsius = -300; }
        catch (ArgumentOutOfRangeException e) { Console.WriteLine(e.ParamName + ": " + e.Message.Split('(')[0].Trim()); }
        var lab = new Lab();
        Temperature asBase = lab;
        lab.Rename("DEG");
        Console.WriteLine(lab.Unit + " " + asBase.Unit);
    }
}
