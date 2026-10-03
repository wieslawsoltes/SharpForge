const vscode = require('vscode');
const path = require('node:path');
const {LanguageClient} = require('vscode-languageclient/node');
let languageClient;
function recorder(protocol) {
  const config = vscode.workspace.getConfiguration('sharpforgeConformance');
  const root = config.get('root'), node = config.get('node'), output = config.get('output');
  if (![root, node, output].every(value => typeof value === 'string' && path.isAbsolute(value))) throw new Error('Set absolute root, Node executable and output paths in sharpforgeConformance settings.');
  const args = [path.join(root, 'scripts/conformance/protocol/record.js'), '--protocol', protocol,
    '--output', path.join(output, protocol + '-' + Date.now() + '.json'), '--client-version', vscode.version];
  return {command: node, args};
}
exports.activate = context => {
  context.subscriptions.push(vscode.commands.registerCommand('sharpforge.conformance.startLsp', async () => {
    if (languageClient) await languageClient.stop();
    languageClient = new LanguageClient('sharpforge-recording', 'SharpForge recorded LSP', recorder('lsp'), {
      documentSelector: [{scheme: 'file', language: 'csharp'}], workspaceFolder: vscode.workspace.workspaceFolders?.[0],
    });
    await languageClient.start();
  }));
  context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('sharpforge-conformance', {
    createDebugAdapterDescriptor() { const options = recorder('dap'); return new vscode.DebugAdapterExecutable(options.command, options.args); },
  }));
};
exports.deactivate = () => languageClient?.stop();
