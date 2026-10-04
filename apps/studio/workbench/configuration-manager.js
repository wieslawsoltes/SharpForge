import {WorkbenchEvents} from './events.js';
import {element, field, select, checkbox} from './ui.js';

export class ConfigurationManager extends WorkbenchEvents {
  constructor({projects, settings, applyConfiguration}) {
    super();
    Object.assign(this, {projects, settings, applyConfiguration});
  }
  get configuration() { return this.settings.get('projects', 'configuration'); }
  get platform() { return this.settings.get('projects', 'platform'); }
  mappings(configuration = this.configuration, platform = this.platform) {
    const saved = this.settings.get('projects', 'configurationMappings')[configuration + '|' + platform] ?? {};
    return this.projects().map(project => ({projectId: project.id ?? project.path, projectName: project.name,
      configuration, platform, build: true, ...saved[project.id ?? project.path]}));
  }
  selectedProjects() { return this.mappings().filter(mapping => mapping.build); }
  async select(configuration, platform) {
    if (!['Debug', 'Release'].includes(configuration)) throw new TypeError('Unknown solution configuration');
    if (!['Any CPU', 'x64', 'x86', 'ARM64'].includes(platform)) throw new TypeError('Unknown solution platform');
    const mappings = this.mappings(configuration, platform);
    await this.applyConfiguration?.({configuration, platform, projects: mappings.filter(mapping => mapping.build)});
    this.settings.apply({projects: {configuration, platform}});
    this.emit({type: 'selected', configuration, platform, projects: mappings});
  }
  saveMappings(mappings) {
    const projects = new Set(this.projects().map(project => project.id ?? project.path));
    for (const mapping of mappings) {
      if (!projects.has(mapping.projectId) || typeof mapping.build !== 'boolean' ||
        !['Debug', 'Release'].includes(mapping.configuration)) throw new TypeError('Invalid project configuration mapping');
    }
    const values = this.settings.get('projects', 'configurationMappings');
    values[this.configuration + '|' + this.platform] = Object.fromEntries(mappings.map(mapping => [mapping.projectId, mapping]));
    this.settings.apply({projects: {configurationMappings: values}});
    this.emit({type: 'mappings'});
  }
  open(dialogs) {
    const mappings = this.mappings();
    return dialogs.open({title: 'Configuration Manager', render: host => {
      const document = host.ownerDocument;
      host.append(element(document, 'p', {text: `Active solution configuration: ${this.configuration} · ${this.platform}`}));
      for (const mapping of mappings) {
        const row = element(document, 'div', {className: 'wb-configuration-row'});
        row.append(element(document, 'strong', {text: mapping.projectName}),
          select(document, mapping.projectName + ' configuration', ['Debug', 'Release'], mapping.configuration,
            value => { mapping.configuration = value; }),
          select(document, mapping.projectName + ' platform', ['Any CPU', 'x64', 'x86', 'ARM64'], mapping.platform,
            value => { mapping.platform = value; }),
          checkbox(document, 'Build', mapping.build, value => { mapping.build = value; }));
        host.append(row);
      }
    }, actions: [{label: 'Save mappings', run: () => { this.saveMappings(mappings); return true; }}]});
  }
  mount(host, onError) {
    const document = host.ownerDocument;
    const configuration = select(document, 'Solution configuration', ['Debug', 'Release'], this.configuration,
      value => this.select(value, this.platform).catch(onError));
    const platform = select(document, 'Solution platform', ['Any CPU', 'x64', 'x86', 'ARM64'], this.platform,
      value => this.select(this.configuration, value).catch(onError));
    const group = element(document, 'div', {className: 'wb-configuration-controls'}, [configuration, platform]);
    host.append(group);
    const unsubscribe = this.subscribe(() => { configuration.value = this.configuration; platform.value = this.platform; });
    return () => { unsubscribe(); group.remove(); };
  }
}
