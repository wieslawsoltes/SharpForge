class D:System.IDisposable {public void Dispose(){}} class C {void M(){using(D d=new D()) {}}}
