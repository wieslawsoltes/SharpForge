class C { async System.Threading.Tasks.Task M(){try{}catch(System.Exception){await System.Threading.Tasks.Task.Delay(1);}finally{await System.Threading.Tasks.Task.Delay(1);}} }
