import {readLaunchSettings, projectRunOptions} from '@sharpforge/project-system';

/** Profile discovery is file inspection only; starting native processes remains a separate user action. */
export class NativeProjectProfiles {
  constructor(host) { this.host = host; this.reset(); }

  reset() {
    this.project = '';
    this.launch = {profiles: [], activeProfile: null, diagnostics: []};
    this.publish = [];
    this.launchProfile = '';
    this.publishProfile = '';
    this.noBuild = true;
    this.diagnostics = [];
  }

  async refresh() {
    return this.host.operation('Read launch and publish profiles', async signal => {
      const project = this.host.contexts.project;
      if (!project) throw new Error('Select a native project first');
      const path = project.replace(/[^/\\]+$/, '') + 'Properties/launchSettings.json';
      const hasFile = this.host.workspace.files.some(file => file.path === path) || this.host.buffers.has(path);
      const launchRequest = hasFile ? this.host.client.read(path) : Promise.resolve(null);
      const publishRequest = this.host.client.publishProfiles
        ? this.host.client.publishProfiles({project}, {signal}) : Promise.resolve([]);
      const [launchResult, publishResult] = await Promise.allSettled([launchRequest, publishRequest]);
      signal.throwIfAborted();
      if (this.host.contexts.project !== project) throw new Error('Project changed while reading profiles');
      if (launchResult.status === 'rejected') throw launchResult.reason;
      if (publishResult.status === 'rejected') throw publishResult.reason;
      const record = launchResult.value;
      const launch = record ? readLaunchSettings(record.text, {path}) : {path, profiles: [], activeProfile: null, diagnostics: []};
      const publish = publishResult.value;
      if (!Array.isArray(publish) || publish.length > 1024) throw new Error('Invalid publish profile list');
      this.launchProfile = launch.profiles.some(profile => profile.name === this.launchProfile)
        ? this.launchProfile : launch.activeProfile?.name ?? '';
      this.publishProfile = publish.some(profile => profile.name === this.publishProfile) ? this.publishProfile : '';
      this.project = project;
      this.launch = launch;
      this.publish = publish;
      this.diagnostics = [...launch.diagnostics, ...publish.flatMap(profile => profile.diagnostics ?? [])];
      this.host.renderBuild(true);
      return this.snapshot();
    }, {trust: false, save: false});
  }

  selectLaunch(name) {
    if (name && !this.launch.profiles.some(profile => profile.name === name)) throw new Error('Select an existing launch profile');
    this.launchProfile = name;
    this.host.renderBuild(true);
  }

  selectPublish(name) {
    if (name && !this.publish.some(profile => profile.name === name)) throw new Error('Select an existing publish profile');
    this.publishProfile = name;
    this.host.renderBuild(true);
  }

  runRequest() {
    const project = this.host.contexts.project;
    if (this.project && this.project !== project) throw new Error('Refresh profiles for the selected project');
    if (this.launch.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
      throw new Error('Correct the launch settings diagnostics before running a profile');
    }
    const context = this.host.contexts.active;
    const selected = this.launch.profiles.find(profile => profile.name === this.launchProfile) ?? null;
    const runOptions = projectRunOptions({path: project, contextId: context?.id, targetFramework: context?.targetFramework,
      runtimeIdentifier: context?.runtimeIdentifier, launchSettings: {...this.launch, activeProfile: selected}},
    {profile: this.launchProfile || undefined});
    if (!['Project', 'Executable'].includes(runOptions.commandName)) throw new Error(
      "Native launch command '" + runOptions.commandName + "' requires a dedicated host adapter");
    return {...this.host.contexts.request(), project, profile: this.launchProfile || null,
      arguments: runOptions.args, environment: runOptions.environment, workingDirectory: runOptions.workingDirectory,
      noBuild: this.noBuild, runOptions};
  }

  publishRequest() {
    if (this.project !== this.host.contexts.project || !this.publish.some(profile => profile.name === this.publishProfile)) {
      throw new Error('Read profiles and select an existing publish profile');
    }
    return {...this.host.request('publish'), ...this.host.contexts.request(), action: 'publish', profile: this.publishProfile};
  }

  snapshot() {
    return {project: this.project, launchProfiles: this.launch.profiles, publishProfiles: this.publish,
      launchProfile: this.launchProfile, publishProfile: this.publishProfile, noBuild: this.noBuild, diagnostics: this.diagnostics};
  }
}
