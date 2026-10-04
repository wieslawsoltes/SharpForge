import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProjectPlan, createItemPlan } from '@sharpforge/templates';
import { command } from './a24-native.js';

export const windowsBuildProperties = Object.freeze({
  Platform: 'x64', RuntimeIdentifier: 'win-x64', WindowsAppSDKSelfContained: 'true'
});

export const runtimeTemplateItems = Object.freeze([
  ['winui-templated-control', 'Badge.cs'], ['winui-templated-control', 'AlertBadge.cs'],
  ['winui-xaml-page', 'GeneratedPage.xaml'], ['winui-xaml-window', 'GeneratedWindow.xaml'],
  ['winui-xaml-user-control', 'GeneratedUserControl.xaml'], ['winui-xaml-content-dialog', 'GeneratedDialog.xaml'],
  ['winui-resource-dictionary', 'Palette.xaml'], ['winui-style', 'ButtonStyle.xaml'],
  ['winui-control-template', 'ButtonTemplate.xaml'], ['winui-data-template', 'RowTemplate.xaml'],
  ['winui-storyboard-code', 'Fade.cs'], ['winui-storyboard-xaml', 'FadeResources.xaml'],
  ['winui-theme-transition', 'TransitionPage.xaml'], ['winui-visual-states', 'StatePage.xaml'],
  ['winui-mvvm-shell', 'Shell.xaml']
]);

const application = `using System;
using System.IO;
using System.Text.Json;
using Microsoft.UI.Xaml;

namespace RuntimeHost;

public partial class App : Application
{
    private Window? window;
    public App() { InitializeComponent(); }
    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            window = new Window { Title = "SharpForge generated template qualification" };
            window.Activate();
            var result = await TemplateRuntimeChecks.Run(window);
            string output = Environment.GetEnvironmentVariable("SHARPFORGE_TEMPLATE_RESULTS")
                ?? throw new InvalidOperationException("A qualification output path is required.");
            File.WriteAllText(output, JsonSerializer.Serialize(result));
            Environment.ExitCode = 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error);
            Environment.ExitCode = 1;
        }
        finally
        {
            window?.Close();
            Exit();
        }
    }
}
`;

/** Compose actual generated item plans and their optimistic project/dictionary edits into one Windows application. */
export async function windowsRuntimePlan() {
  const plan = createProjectPlan('winui-native-unpackaged', {
    projectName: 'RuntimeHost', namespace: 'RuntimeHost', sameDirectory: true, solutionMode: 'none', nullable: true
  });
  const project = plan.records.find(record => record.path === plan.entry);
  for (const [id, name] of runtimeTemplateItems) {
    const item = createItemPlan(id, { name, namespace: 'RuntimeHost', existing: plan.records,
      projectPath: project.path, projectText: project.text, nullable: true });
    for (const modification of item.modifications) {
      const record = plan.records.find(entry => entry.path === modification.path);
      assert(record, 'Modification targets an existing record: ' + modification.path);
      assert.equal(record.text, modification.expectedText);
      record.text = modification.text;
    }
    plan.records.push(...item.records);
  }
  plan.records.find(record => record.path === 'App.xaml.cs').text = application;
  const checks = await readFile(new URL('../fixtures/templates/windows/TemplateRuntimeChecks.cs', import.meta.url), 'utf8');
  plan.records.push({ path: 'TemplateRuntimeChecks.cs', text: checks });
  const storyboard = plan.records.find(record => record.path === 'FadeResources.xaml').text;
  const body = storyboard.slice(storyboard.indexOf('>') + 1, storyboard.lastIndexOf('</ResourceDictionary>'));
  const markup = '<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" '
    + 'xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Grid.Resources>' + body + '</Grid.Resources>'
    + '<Border x:Name="AnimatedElement" Width="40" Height="40" Opacity="0.25" /></Grid>';
  plan.records.push({ path: 'GeneratedMarkup.cs', text: 'namespace RuntimeHost;\ninternal static class GeneratedMarkup\n{\n'
    + '    internal const string Storyboard = @"' + markup.replaceAll('"', '""') + '";\n}\n' });
  return plan;
}

/** Ask the actual SDK for its output location instead of assuming a bin/platform/framework layout. */
export async function windowsExecutable(directory, project) {
  const result = await command(['msbuild', project, '-nologo', '-getProperty:TargetPath',
    '-p:Platform=x64', '-p:RuntimeIdentifier=win-x64'], directory);
  const target = result.stdout.trim();
  assert.match(target, /\.(dll|exe)$/i, 'Native MSBuild must return one TargetPath');
  return target.replace(/\.dll$/i, '.exe');
}
