import {ProjectSystem, buildSolutionTree} from '@sharpforge/project-system';
import {ExplorerCommands} from '../apps/studio/explorer-commands.js';

const records = [
  {path: 'Demo.slnx', text: '<Solution><Folder Name="/Apps/"><Project Path="App/App.csproj" /></Folder>' +
    '<Project Path="Library/Library.csproj" /></Solution>'},
  {path: 'App/App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>' +
    '<TargetFrameworks>net10.0;net9.0</TargetFrameworks></PropertyGroup><ItemGroup>' +
    '<ProjectReference Include="../Library/Library.csproj" /><Compile Include="../Shared/Shared.cs" Link="Links/Shared.cs" />' +
    '<Compile Update="View.xaml.cs"><DependentUpon>View.xaml</DependentUpon></Compile></ItemGroup></Project>'},
  {path: 'Library/Library.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>' +
    '<TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>'},
  {path: 'App/View.xaml', text: '<Page />'},
  {path: 'App/View.xaml.cs', text: 'partial class View {}'},
  {path: 'Library/Service.cs', text: 'public class Service {}'},
  {path: 'Shared/Shared.cs', text: 'class Shared {}'}
];
const entry = 'Demo.slnx';
let context = {identity: 'explorer-example', name: 'Explorer example', records, folders: ['App/Empty'],
  solutionPath: entry, entry, tabs: ['Library/Service.cs'], active: 'Library/Service.cs', breakpoints: {}, dirty: []};
const generated = [{path: 'App/Generated/Settings.g.cs', project: 'App/App.csproj', text: 'class Settings {}'}];
const snapshot = new ProjectSystem(records).load(entry);
const roots = buildSolutionTree({...context, files: records, snapshot, generated});
const summarize = node => ({kind: node.kind, label: node.label, path: node.path,
  ...(node.linked ? {linked: true} : {}), ...(node.nested ? {nested: true} : {}),
  ...(node.children?.length ? {children: node.children.map(summarize)} : {})});
const commands = new ExplorerCommands({context: () => context, commit: next => { context = {...context, ...next}; },
  render() {}, notice() {}, error: error => { throw error; }});
try {
  await commands.move([{from: 'Library/Library.csproj', to: 'Library/Renamed.csproj'}], false, null, {allowProjectRename: true});
  const renamed = context.records.find(record => record.path === 'App/App.csproj').text;
  await commands.undo();
  console.log(JSON.stringify({projects: snapshot.projects.length, hierarchy: roots.map(summarize),
    projectReferenceRenamed: renamed.includes('../Library/Renamed.csproj'),
    undoRestoredOriginalXml: context.records.find(record => record.path === 'App/App.csproj').text === records[1].text}, null, 2));
} finally { commands.dispose(); }
