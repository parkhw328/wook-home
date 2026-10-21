# Three.js

Pinned upstream: [Three.js 0.186.1](https://github.com/mrdoob/three.js), MIT license.

The two unmodified ES modules are served from this directory, without a CDN or runtime network dependency. `LICENSE.txt` preserves the upstream license. Run `npm ci` and `npm run vendor:three` to reproduce these files from the version and integrity pinned in `package-lock.json`.

The library provides the WebGL 2 renderer, cameras, geometry, lighting and materials for the office. Application geometry and animation are authored in `public/office-3d.mjs`. Unsupported or lost WebGL contexts retain the accessible room list and work panels.
