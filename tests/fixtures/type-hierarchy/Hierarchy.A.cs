namespace NativeHierarchy;
public interface IRoot { }
public interface IChild : IRoot { }
public class Base { }
public class Outer { public class Inner { } }
