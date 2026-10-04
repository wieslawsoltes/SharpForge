using RefSurface;

public class Consumer : Contract
{
    public int Use(Payload value, Callback callback)
    {
        Payload copy = value;
        protectedField = Contract.Answer;
        Changed += OnChanged;
        return copy.Value + callback(Read()) + (int)Choice.Second;
    }

    private void OnChanged() { }

    public static int Create<T>() where T : IFactory { return T.Create() + T.Value; }
}
