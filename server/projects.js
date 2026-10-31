import { createHash } from 'node:crypto';
export const projectKey = (kind, name) => createHash('sha256').update(`${kind}:${name}`).digest('hex');

export function readWorkspaceIdentity(value) {
  return typeof value?.workspace === 'string' && value.workspace.trim() && value.workspace.length <= 80
    && !/[\x00-\x1f\x7f/\\]/.test(value.workspace) && typeof value.workspaceKey === 'string' && /^[a-f0-9]{64}$/.test(value.workspaceKey)
    ? { workspace: value.workspace, workspaceKey: value.workspaceKey } : {};
}

// Only opaque workspace keys and display names are stored; never absolute paths.
export function ensureProject(state, key, name, source) {
  state.projects ??= [];
  let project = state.projects.find((item) => item.id === key);
  if (!project) {
    project = { id: key, name, source, floor: state.projects.length + 2 };
    state.projects.push(project);
  }
  return project;
}
export function assignedProject(state, name) {
  return name ? ensureProject(state, projectKey('manual', name.normalize('NFC')), name, 'manual').id : null;
}
