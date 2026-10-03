import { AssemblyProvider, AssemblyResolver } from '../src/index.js';

const resolver = new AssemblyResolver({
  providers: [new AssemblyProvider('app-local', [
    { identity: 'Example, Version=1.2.0.0, Culture=neutral, PublicKeyToken=null', path: 'Example.dll' },
  ])],
  versionPolicy: 'higher',
});
console.log(resolver.resolve('Example, Version=1.0.0.0', { requester: 'Application' }).path);
resolver.dispose();
