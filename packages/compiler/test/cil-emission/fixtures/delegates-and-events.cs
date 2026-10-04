using System;

delegate void Notify(string message);

class Button
{
    public event Action Clicked;
    public static event Notify Logged;
    Notify handlers;
    int subscriptions;

    public event Notify Changed
    {
        add
        {
            handlers += value;
            subscriptions++;
        }
        remove
        {
            handlers -= value;
            subscriptions--;
        }
    }

    public int Subscriptions => subscriptions;

    public void Click()
    {
        Clicked?.Invoke();
        if (handlers != null) handlers("clicked");
        Logged?.Invoke("log");
    }
}

class Scaler
{
    public virtual int Offset(int value)
    {
        return value + 1;
    }
}

class LoudScaler : Scaler
{
    public override int Offset(int value)
    {
        return value + 1000;
    }
}

class Program
{
    static void First(string message)
    {
        Console.WriteLine("first " + message);
    }

    static void Second(string message)
    {
        Console.WriteLine("second " + message);
    }

    static void Main()
    {
        Notify chain = First;
        chain += Second;
        chain("both");
        chain -= First;
        chain("one");
        chain -= Second;
        Console.WriteLine(chain == null);

        Notify combined = (Notify)First + Second + First;
        combined("three");

        var button = new Button();
        button.Click();
        int clicks = 0;
        Action onClick = () => clicks++;
        button.Clicked += onClick;
        button.Clicked += () => Console.WriteLine("clicked");
        button.Changed += First;
        button.Changed += Second;
        Button.Logged += Second;
        button.Click();
        Console.WriteLine(button.Subscriptions);
        button.Clicked -= onClick;
        button.Changed -= First;
        Button.Logged -= Second;
        button.Click();
        Console.WriteLine(clicks);
        Console.WriteLine(button.Subscriptions);

        // A delegate over a virtual method binds the override of the target's class.
        Scaler loud = new LoudScaler();
        Func<int, int> offset = loud.Offset;
        Console.WriteLine(offset(1));
    }
}
