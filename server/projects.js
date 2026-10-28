import { createHash } from 'node:crypto';
export const projectKey = (kind, name) => createHash('sha256').update(`${kind}:${name}`).digest('hex');

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
