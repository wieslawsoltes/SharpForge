using System;

// A real C# program. Compiled and executed entirely in JavaScript.
class Program
{
    static int Integrate(Particle particle, int step)
    {
        particle.Position += particle.Velocity * step;
        return particle.Position;
    }

    static void Main()
    {
        Console.WriteLine("SharpForge • particle simulation");

        Particle[] particles = new Particle[] {
            new Particle("Aurora", 12, 3),
            new Particle("Orion", 24, 5),
            new Particle("Vega", 8, 2)
        };

        int total = 0;
        for (int tick = 0; tick < 4; tick++)
        {
            foreach (Particle particle in particles)
            {
                total += Integrate(particle, tick);
            }
            Console.WriteLine("Tick " + tick + " → energy: " + total);
        }

        Console.WriteLine("Managed memory: " + GC.GetTotalMemory(false) + " bytes");
        GC.Collect();
        Console.WriteLine("Simulation complete.");
    }
}
