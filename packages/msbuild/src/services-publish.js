import { discoverPublishProfiles, createPublishProfileRequest } from './publish-profiles.js';

/** Register data-only profile inspection and explicit native publishing. */
export function registerNativePublishServices(registry, { engine, workspace }) {
  registry.register('publish', 'profiles', request => discoverPublishProfiles(workspace, request.project));
  registry.register('publish', 'execute', async request => {
    const profiles = await discoverPublishProfiles(workspace, request.project), profile = profiles.find(item => item.name === request.profile);
    return engine.start(createPublishProfileRequest(request, profile));
  });
}
