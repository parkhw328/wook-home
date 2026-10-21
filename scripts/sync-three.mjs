import { mkdir, copyFile, readFile } from 'node:fs/promises';

const packageRoot = new URL('../node_modules/three/', import.meta.url);
const destination = new URL('../public/vendor/three/', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
if (version !== '0.186.1') throw new Error('Expected the pinned Three.js version. Run npm ci.');
await mkdir(destination, { recursive: true });
for (const name of ['three.module.js', 'three.core.js']) {
  await copyFile(new URL(`build/${name}`, packageRoot), new URL(name, destination));
}
await copyFile(new URL('LICENSE', packageRoot), new URL('LICENSE.txt', destination));
process.stdout.write(`Copied Three.js ${version} and its MIT license.\n`);
