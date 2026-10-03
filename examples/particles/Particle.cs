// Managed objects live on SharpForge's own tracing heap.
class Particle
{
    public string Name;
    public int Position;
    public int Velocity;

    public Particle(string name, int position, int velocity)
    {
        Name = name;
        Position = position;
        Velocity = velocity;
    }

    public string Describe()
    {
        return Name + " at " + Position;
    }
}
