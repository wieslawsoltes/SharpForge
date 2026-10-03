class C { void M(){var actions=new System.Collections.Generic.List<System.Action>();foreach(var n in new int[]{1,2}) actions.Add(()=>System.Console.WriteLine(n));} }
