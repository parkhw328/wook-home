import { chmod, chown, mkdir, open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export function sharedGroup(value) {
  if (value === undefined) return null;
  if (!/^\d{1,10}$/.test(value) || Number(value) > 4294967294) throw new Error('Invalid shared group.');
  return Number(value);
}

// Share only redacted bridge exports with the explicitly selected server group.
// Original CLI logs and credentials keep their existing ownership and modes.
export async function prepareBridgeDirectory(directory, sharedGid = null) {
  await mkdir(directory, { recursive: true, mode: sharedGid === null ? 0o700 : 0o750 });
  if (sharedGid !== null && process.platform !== 'win32') {
    await chown(directory, -1, sharedGid);
    await chmod(directory, 0o750);
  }
}

export async function writeBridgeJson(destination, value, sharedGid = null) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    if (sharedGid !== null && process.platform !== 'win32') {
      await file.chown(-1, sharedGid);
      await file.chmod(0o640);
    }
    await file.writeFile(JSON.stringify(value));
    await file.close();
    await rename(temporary, destination);
  } finally {
    await file.close();
    await rm(temporary, { force: true });
  }
}
