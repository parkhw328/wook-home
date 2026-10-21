import { stat } from 'node:fs/promises';
import { win32, posix } from 'node:path';

// Presence only. Never launch a discovered executable or inspect account files.
export async function collectCliTools({ env = process.env, platform = process.platform, statImpl = stat } = {}) {
  const paths = platform === 'win32' ? win32 : posix;
  const raw = typeof env.PATH === 'string' ? env.PATH : '';
  const all = [...new Set(raw.split(paths.delimiter).map((value) => value.replace(/^"|"$/g, '')).filter((value) => paths.isAbsolute(value)))];
  const directories = all.slice(0, 128);
  const names = ['codex', 'claude', 'gemini'];
  const tools = await Promise.all(names.map(async (id) => {
    let uncertain = all.length > directories.length;
    for (const directory of directories) {
      const names = platform === 'win32' ? [`${id}.exe`, `${id}.cmd`, `${id}.ps1`] : [id];
      for (const name of names) {
        try {
          if ((await statImpl(paths.join(directory, name))).isFile()) return { id, installed: true };
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes(error.code)) uncertain = true;
        }
      }
    }
    return { id, installed: uncertain ? null : false };
  }));
  // No supported Muse Code installation detector yet; absence is not inferred.
  return [...tools, { id: 'muse', installed: null }];
}
