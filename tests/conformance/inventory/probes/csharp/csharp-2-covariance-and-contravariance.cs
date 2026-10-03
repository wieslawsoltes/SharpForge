class A {} class B:A {} class C { delegate A D(); static B F(){return new B();} D d=F; }
