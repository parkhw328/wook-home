import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';

export function workspaceIdentity(directory) {
  const path = resolve(directory);
  const key = process.platform === 'win32' ? path.toLowerCase() : path;
  return {
    workspace: basename(path).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80) || '작업 폴더',
    workspaceKey: createHash('sha256').update(key).digest('hex'),
  };
}
