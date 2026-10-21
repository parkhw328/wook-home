import * as T from './vendor/three/three.module.js';
import { ROOMS, FLOOR_HEIGHT, CORRIDOR_Z, LIFT_X, roomById, worldPoint, occupantRoom, occupantPosition, routeBetween } from './rooms.mjs';

const colors = { plaster: 0xf2e9df, trim: 0xd8c9b7, oak: 0xc9a478, walnut: 0x735044, cream: 0xe6d6bf, red: 0xb84c4c, charcoal: 0x333d42, green: 0x6d8064, brass: 0xbea16c };
const boxGeometry = new T.BoxGeometry(1, 1, 1);
const sphereGeometry = new T.SphereGeometry(1, 16, 12);
const cylinderGeometry = new T.CylinderGeometry(1, 1, 1, 16);
const materials = new Map();
function material(color, options = {}) {
  const key = JSON.stringify([color, options]);
  if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness: .72, ...options }));
  return materials.get(key);
}
function mesh(parent, geometry, color, size, position, options = {}) {
  const node = new T.Mesh(geometry, material(color, options));
  node.scale.set(...size); node.position.set(...position);
  node.castShadow = !options.transparent; node.receiveShadow = true;
  parent.add(node); return node;
}
const box = (parent, color, size, position, options) => mesh(parent, boxGeometry, color, size, position, options);
const sphere = (parent, color, size, position, options) => mesh(parent, sphereGeometry, color, size, position, options);
const cylinder = (parent, color, radius, height, position, options) => mesh(parent, cylinderGeometry, color, [radius, height, radius], position, options);
function group(parent, x = 0, y = 0, z = 0) { const node = new T.Group(); node.position.set(x, y, z); parent.add(node); return node; }
function rounded(parent, color, width, height, depth, x, y, z, radius = .12) {
  const shape = new T.Shape(); const w = width / 2; const d = depth / 2; const r = Math.min(radius, w, d);
  shape.moveTo(-w + r, -d); shape.lineTo(w - r, -d); shape.quadraticCurveTo(w, -d, w, -d + r);
  shape.lineTo(w, d - r); shape.quadraticCurveTo(w, d, w - r, d); shape.lineTo(-w + r, d);
  shape.quadraticCurveTo(-w, d, -w, d - r); shape.lineTo(-w, -d + r); shape.quadraticCurveTo(-w, -d, -w + r, -d);
  const geometry = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -height / 2, 0);
  return mesh(parent, geometry, color, [1, 1, 1], [x, y, z]);
}
function plant(parent, x, z, scale = 1) {
  const pot = group(parent, x, 0, z); pot.scale.setScalar(scale);
  cylinder(pot, colors.cream, .22, .38, [0, .2, 0]); cylinder(pot, 0x564735, .18, .025, [0, .4, 0]);
  cylinder(pot, 0x7c7760, .025, .48, [0, .6, 0]);
  for (let i = 0; i < 6; i += 1) {
    const angle = i * Math.PI / 3;
    const leaf = sphere(pot, i % 2 ? 0x758d69 : 0x556e50, [.11, .34, .15], [Math.cos(angle) * .17, .75 + i % 2 * .13, Math.sin(angle) * .17]);
    leaf.rotation.z = -.65 * Math.cos(angle); leaf.rotation.x = .65 * Math.sin(angle);
  }
}
function chair(parent, x, z, angle = 0, color = colors.charcoal) {
  const seat = group(parent, x, 0, z); seat.rotation.y = angle;
  cylinder(seat, 0x687076, .055, .42, [0, .25, 0]);
  box(seat, 0x737b80, [.7, .035, .06], [0, .055, 0]); box(seat, 0x737b80, [.06, .035, .7], [0, .055, 0]);
  rounded(seat, color, .62, .12, .6, 0, .48, 0);
  rounded(seat, color, .6, .58, .1, 0, .78, -.25);
  return seat;
}
function monitor(parent, x, z, size = .75) {
  box(parent, 0x536368, [.31, .025, .23], [x, .84, z]); box(parent, 0x59686a, [.045, .25, .045], [x, .95, z]);
  const screen = box(parent, 0x37494e, [size, .48, .055], [x, 1.23, z]);
  box(screen, 0x92bbc1, [.91, .82, .08], [0, 0, .53], { emissive: 0x426e76, emissiveIntensity: .22 });
  box(parent, 0xcccac3, [.5, .022, .17], [x, .84, z + .44]);
  for (let line = 0; line < 3; line += 1) box(parent, 0xb5d4d4, [size * (.6 - line * .12), .018, .005], [x - .05, 1.35 - line * .065, z + .032]);
}
function desk(parent, x, z) {
  const node = group(parent, x, 0, z);
  rounded(node, colors.oak, 2.15, .11, 1.05, 0, .78, 0, .06);
  for (const dx of [-.9, .9]) box(node, 0xe8dfd3, [.055, .72, .72], [dx, .37, 0]);
  box(node, 0xf5eadb, [.38, .6, .65], [.6, .34, .05]);
  monitor(node, -.3, -.18);
  cylinder(node, 0xf4ede3, .07, .15, [.56, .91, .2]);
  box(node, 0x7d9686, [.2, .045, .3], [.6, .86, -.2]);
  chair(parent, x - .3, z + .78, Math.PI);
}
function sofa(parent, x, z, width = 2.2, angle = 0, color = 0xbfb2a0) {
  const node = group(parent, x, 0, z); node.rotation.y = angle;
  rounded(node, color, width, .36, .85, 0, .3, 0);
  rounded(node, color, width, .61, .2, 0, .64, -.38);
  for (const dx of [-width / 2 + .08, width / 2 - .08]) rounded(node, color, .18, .56, .9, dx, .51, 0);
  for (let i = 0; i < 3; i += 1) rounded(node, 0xd8cbb9, width / 3 - .09, .12, .6, (i - 1) * (width / 3 - .05), .54, .045);
}
function bookshelf(parent, x, z, width = 2.5) {
  box(parent, colors.walnut, [width, 1.9, .12], [x, .95, z - .22]);
  for (const dx of [-width / 2, width / 2]) box(parent, colors.oak, [.08, 1.95, .5], [x + dx, .97, z]);
  for (let shelf = 0; shelf < 4; shelf += 1) {
    const y = .13 + shelf * .55; box(parent, colors.oak, [width, .065, .5], [x, y, z]);
    if (shelf < 3) for (let i = 0; i < 8; i += 1) box(parent, [0xe4c39c, 0x859c92, 0x66727b, 0xaa645b][(i + shelf) % 4], [.11, .28 + i % 3 * .04, .27], [x - width / 2 + .23 + i * .2, y + .18, z + .05]);
  }
}
function floorArchitecture(scene, floor) {
  const node = group(scene, 0, (floor - 1) * FLOOR_HEIGHT, 0);
  // Two slab pieces leave the lift shaft open; vertical travel crosses no floor.
  box(node, colors.plaster, [11.7, .28, 7], [.95, -.17, 0]);
  box(node, colors.plaster, [2.1, .28, 4.85], [-5.95, -.17, -1.075]);
  box(node, colors.trim, [11.7, .08, .12], [.95, -.16, 3.5]);
  box(node, 0xe4d8c8, [11.6, .025, 2.05], [.95, .005, 2.4]);
  for (let x = -4.8; x < 6.7; x += .8) box(node, 0xd7cbbd, [.012, .008, 1.97], [x, .025, 2.4]);
  box(node, colors.plaster, [13.8, 2.55, .15], [-.1, 1.25, -3.5]);
  box(node, colors.plaster, [.15, 2.5, 4.9], [-6.9, 1.25, -1]);
  box(node, colors.plaster, [.15, .65, 7], [6.8, .325, 0]);
  box(node, colors.trim, [13.6, .09, .2], [-.1, 2.52, -3.48]);
  // Windows and mullions are actual geometry, with daylight visible behind desks.
  for (let x = -4.2; x < 6.3; x += 1.75) {
    box(node, 0xb6d6dc, [1.55, 1.5, .04], [x, 1.48, -3.39], { roughness: .2, metalness: .14 });
    box(node, 0xf5f1e7, [.045, 1.58, .07], [x, 1.48, -3.33]);
    box(node, 0xf5f1e7, [1.6, .045, .08], [x, .73, -3.33]);
  }
  // Lift bank and visible guide rails along the open shaft.
  box(node, 0xd6d1c8, [1.65, 2.38, .18], [LIFT_X, 1.18, 1.27]);
  for (const dx of [-.36, .36]) box(node, 0x939f9f, [.7, 1.9, .055], [LIFT_X + dx, .97, 1.38], { metalness: .55, roughness: .3 });
  box(node, 0x535c5b, [.34, .14, .055], [LIFT_X, 2.12, 1.4]);
  box(node, 0xd8b978, [.055, .09, .02], [LIFT_X, 2.12, 1.44], { emissive: 0xd8b978, emissiveIntensity: .4 });
  for (const x of [-6.79, -5.02]) box(node, colors.brass, [.05, FLOOR_HEIGHT, .05], [x, 1.6, 2.8], { metalness: .55 });
  box(node, 0xb8c3bc, [1.45, 2, .1], [LIFT_X, 1.1, -2.6]);
  plant(node, -5.85, -.6, 1.25);
  for (const room of ROOMS.filter((item) => item.floor === floor)) {
    const width = room.right - room.left;
    const center = (room.left + room.right) / 2;
    box(node, floor === 2 ? 0xe0ccb0 : floor === 3 ? 0xd2b99c : 0xe4d6c2, [width - .08, .025, 4.63], [center, .018, -1.1]);
    for (let x = room.left + .45; x < room.right; x += .55) box(node, 0xc7b496, [.009, .004, 4.5], [x, .034, -1.1]);
    for (const [left, right] of [[room.left, room.x - .6], [room.x + .6, room.right]]) {
      const panelWidth = right - left;
      box(node, 0xbcd4d0, [panelWidth, 1.65, .045], [(left + right) / 2, .84, room.doorZ], { transparent: true, opacity: .16, depthWrite: false, roughness: .18, metalness: .08 });
      box(node, colors.brass, [panelWidth, .045, .06], [(left + right) / 2, 1.68, room.doorZ]);
      box(node, colors.trim, [panelWidth, .08, .1], [(left + right) / 2, .07, room.doorZ]);
    }
    for (const x of [room.left, room.right, room.x - .6, room.x + .6]) box(node, colors.brass, [.045, 1.9, .06], [x, .95, room.doorZ]);
    box(node, colors.brass, [1.24, .06, .08], [room.x, 1.9, room.doorZ]);
    // An open door leaf makes the entrance visible without covering the walk path.
    const door = group(node, room.x - .6, 0, room.doorZ); door.rotation.y = -.95;
    box(door, 0xd7e6dd, [1.04, 1.8, .035], [.52, .94, 0], { transparent: true, opacity: .16, depthWrite: false });
    box(door, colors.brass, [.045, 1.85, .05], [1.02, .94, 0]);
    box(door, colors.brass, [.035, .32, .06], [.92, .95, .06]);
  }
  if (floor !== 2) {
    box(node, colors.plaster, [.16, 2.25, 4.65], [.25, 1.12, -1.1]);
    box(node, colors.trim, [.19, .08, 4.65], [.25, 2.27, -1.1]);
  }
  plant(node, 6.35, 2.7); plant(node, -4.5, 2.85, .85);
  return node;
}
function furnish(node, floor) {
  if (floor === 1) {
    rounded(node, 0xd2c3b1, 3.5, .018, 2.65, -2.45, .048, -1.1);
    sofa(node, -2.3, -2, 2.5); sofa(node, -4.1, -.8, 1.7, Math.PI / 2, 0x9eac98);
    cylinder(node, colors.walnut, .6, .09, [-2.3, .48, -.7]); cylinder(node, colors.brass, .1, .4, [-2.3, .23, -.7]);
    cylinder(node, 0xf4ebd8, .13, .17, [-2.3, .61, -.7]);
    bookshelf(node, -1.7, -3.08, 2.2); plant(node, -4.4, -2.8);
    box(node, 0x899c88, [5.4, .82, .64], [3.45, .44, -2.85]);
    box(node, 0xf2e7d4, [5.55, .1, .77], [3.45, .9, -2.85]);
    for (let x = 1.1; x < 6; x += .86) box(node, colors.brass, [.34, .025, .025], [x, .7, -2.51]);
    box(node, 0x465554, [.55, .65, .45], [1.4, 1.25, -2.82]); box(node, 0xb5c6be, [.4, .14, .03], [1.4, 1.43, -2.58]);
    cylinder(node, colors.walnut, .85, .1, [3.35, .8, -.35]); cylinder(node, colors.brass, .12, .75, [3.35, .4, -.35]);
    for (let i = 0; i < 3; i += 1) { const a = i * Math.PI * 2 / 3; chair(node, 3.35 + Math.cos(a) * 1.2, -.35 + Math.sin(a) * 1.2, -a - Math.PI / 2, 0xa7b69c); }
    plant(node, 6.1, -1.5, 1.3);
  } else if (floor === 2) {
    for (const x of [-3.05, -.35, 2.35, 5.05]) for (const z of [-1.85, -.05]) desk(node, x, z);
    plant(node, -4.45, -2.9, 1.3); plant(node, 6.25, -2.9);
  } else {
    rounded(node, 0xa4afa5, 4.25, .02, 3.6, -2.4, .045, -1.05);
    rounded(node, colors.oak, 2.95, .13, 1.25, -2.35, .82, -1.05, .5);
    for (const x of [-3.25, -1.45]) for (const z of [-2.15, .05]) chair(node, x, z, z < 0 ? 0 : Math.PI, 0x697d7a);
    cylinder(node, colors.brass, .1, .74, [-3.2, .4, -1.05]); cylinder(node, colors.brass, .1, .74, [-1.5, .4, -1.05]);
    box(node, 0xf2ede1, [.5, .025, .35], [-3, .91, -1.05]); box(node, 0x606f70, [.42, .035, .28], [-1.7, .91, -1.05]);
    plant(node, -4.5, -2.8, 1.2);
    rounded(node, colors.walnut, 2.5, .14, 1.1, 3.6, .8, -1.8);
    box(node, colors.walnut, [2.25, .7, .12], [3.6, .4, -1.95]); monitor(node, 3.6, -2.05, .9);
    chair(node, 3.6, -2.7, 0, 0x544d47); sofa(node, 2.15, -.2, 1.5, 0, 0xb78773); sofa(node, 4.8, -.2, 1.5, 0, 0xb78773);
    cylinder(node, colors.oak, .45, .09, [3.5, .49, .15]); cylinder(node, colors.brass, .08, .43, [3.5, .25, .15]);
    plant(node, 6.15, -2.8, 1.55); bookshelf(node, 1.6, -3.1, 1.65);
  }
}
function person(parent, index, commander = false) {
  const root = group(parent); const skin = [0xe9c09d, 0xce9874, 0xf0cdb2, 0xb87b59][index % 4];
  const shirt = commander ? colors.red : [0x718b92, 0xc6a16d, 0x986c65, 0x6e8970, 0x596675][index % 5];
  const body = group(root); root.userData.body = body;
  sphere(body, shirt, [.24, .32, .17], [0, .63, 0]);
  sphere(body, skin, [.24, .27, .23], [0, 1.01, 0]);
  sphere(body, [0x4e3930, 0x322c29, 0x805744][index % 3], [.245, .17, .235], [0, 1.17, -.025]);
  for (const x of [-.085, .085]) sphere(body, 0x322d2d, [.023, .031, .015], [x, 1.035, .215]);
  sphere(body, skin, [.045, .048, .047], [0, .98, .235]);
  box(body, 0xf1e7db, [.12, .11, .025], [0, .82, .16]);
  const limbs = [];
  for (const sign of [-1, 1]) {
    const arm = group(body, sign * .25, .77, 0); sphere(arm, shirt, [.075, .2, .08], [0, -.14, 0]); sphere(arm, skin, [.075, .07, .075], [0, -.33, 0]);
    const leg = group(body, sign * .11, .4, 0); box(leg, 0x41494d, [.14, .3, .14], [0, -.12, 0]); rounded(leg, 0x333a3e, .15, .09, .25, 0, -.31, .04, .05);
    limbs.push({ arm, leg, sign });
  }
  const shadow = new T.Mesh(new T.CircleGeometry(.31, 24), new T.MeshBasicMaterial({ color: 0x6f5845, transparent: true, opacity: .15, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .028; root.add(shadow);
  root.userData.limbs = limbs; return root;
}
const vec = (point) => new T.Vector3(point.x, point.y, point.z);

export class OfficeScene {
  constructor(root) {
    this.root = root; this.motion = true; this.view = 0; this.people = new Map(); this.lastTime = 0; this.elapsed = 0;
    this.labels = root.querySelector('#room-hotspots');
    try {
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFShadowMap;
      this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
      this.renderer.domElement.setAttribute('aria-label', '층별 방과 복도, 움직이는 동료가 있는 입체 사무실');
      this.renderer.domElement.setAttribute('role', 'img');
      root.querySelector('#office-canvas').append(this.renderer.domElement);
      this.scene = new T.Scene();
      this.scene.add(new T.HemisphereLight(0xfff5df, 0xa5a6a6, 1.8));
      const light = new T.DirectionalLight(0xfff0d7, 3.1); light.position.set(-8, 20, 12); light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048); Object.assign(light.shadow.camera, { left: -15, right: 15, top: 17, bottom: -12, far: 70 });
      light.shadow.normalBias = .045; light.shadow.bias = -.0001; this.scene.add(light);
      const fill = new T.DirectionalLight(0xd5e8f4, .9); fill.position.set(8, 9, -7); this.scene.add(fill);
      this.floors = [1, 2, 3].map((floor) => { const node = floorArchitecture(this.scene, floor); furnish(node, floor); return node; });
      this.actorRoot = group(this.scene);
      this.commander = person(this.actorRoot, 0, true); this.commander.position.copy(vec(worldPoint(roomById('corridor'))));
      this.cabin = group(this.scene); box(this.cabin, 0xbba98b, [1.5, .09, 1.55], [0, -.04, 0]); this.cabin.visible = false;
      this.routeMaterial = new T.LineDashedMaterial({ color: colors.red, dashSize: .16, gapSize: .1, transparent: true, opacity: .7 });
      this.camera = new T.OrthographicCamera(-10, 10, 8, -8, .1, 150);
      this.target = new T.Vector3(0, 5.25, 0); this.eye = new T.Vector3(14, 15.25, 23); this.size = 16;
      this.camera.position.copy(this.eye); this.camera.lookAt(this.target);
      this.resize = new ResizeObserver(() => this.resizeScene()); this.resize.observe(root); this.resizeScene();
      this.renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.fail(); });
      root.dataset.rendering = 'ready'; root.querySelector('#scene-fallback').hidden = true;
      this.renderer.setAnimationLoop((time) => this.frame(time));
    } catch { this.fail(); }
  }
  fail() {
    this.finishWalk(); this.renderer?.setAnimationLoop(null); this.root.dataset.rendering = 'unavailable';
    this.root.querySelector('#scene-fallback').hidden = false;
  }
  resizeScene() {
    if (!this.camera) return;
    const width = this.root.clientWidth; const height = this.root.clientHeight;
    if (!width || !height) return;
    this.width = width; this.height = height; this.renderer.setSize(width, height, false);
    this.updateCamera();
  }
  updateCamera() {
    const aspect = this.width / this.height; const span = Math.max(this.size, 17.8 / aspect);
    Object.assign(this.camera, { left: -span * aspect / 2, right: span * aspect / 2, top: span / 2, bottom: -span / 2 });
    this.camera.position.copy(this.eye); this.camera.lookAt(this.target); this.camera.updateProjectionMatrix();
  }
  focusFloor(floor = 0) {
    this.view = Number(floor); this.root.dataset.floor = String(this.view);
    for (let i = 0; i < (this.floors?.length || 0); i += 1) this.floors[i].visible = !this.view || i < this.view;
    if (!this.camera) return;
    const y = this.view ? (this.view - 1) * FLOOR_HEIGHT + 1.2 : 5.25;
    this.cameraGoal = { target: new T.Vector3(0, y, 0), eye: new T.Vector3(14, y + (this.view ? 15 : 10), 23), size: this.view ? 10 : 16 };
    if (!this.motion) this.snapCamera();
  }
  snapCamera() {
    if (!this.cameraGoal || !this.camera) return;
    this.target.copy(this.cameraGoal.target); this.eye.copy(this.cameraGoal.eye); this.size = this.cameraGoal.size; this.updateCamera();
  }
  setMotion(enabled) { this.motion = enabled; if (!enabled) { this.finishWalk(); this.snapCamera(); } }
  finishWalk() {
    if (!this.walk) return;
    clearTimeout(this.walk.timer);
    this.commander?.position.copy(this.walk.points.at(-1)); this.walk.resolve(); this.walk = null;
    if (this.cabin) this.cabin.visible = false;
    if (this.route) { this.scene.remove(this.route); this.route.geometry.dispose(); this.route = null; }
  }
  moveCommander(points) {
    if (!points.length || !this.commander) return Promise.resolve();
    this.finishWalk();
    const path = points.map(vec);
    if (path.length < 2 || !this.motion || this.root.dataset.rendering !== 'ready' || (typeof document !== 'undefined' && document.hidden)) { this.commander.position.copy(path.at(-1)); return Promise.resolve(); }
    const lengths = path.slice(1).map((point, i) => point.distanceTo(path[i]));
    this.route = new T.Line(new T.BufferGeometry().setFromPoints(path.map((point) => point.clone().add(new T.Vector3(0, .07, 0)))), this.routeMaterial);
    this.route.computeLineDistances(); this.scene.add(this.route);
    const distance = lengths.reduce((a, b) => a + b, 0);
    const duration = Math.min(3.8, .5 + distance * .1);
    return new Promise((resolve) => {
      this.walk = { points: path, lengths, distance, duration, startedAt: performance.now(), resolve };
      // Tab suspension or a slow GPU must never leave room workflows waiting.
      this.walk.timer = setTimeout(() => this.finishWalk(), duration * 1000 + 100);
    });
  }
  syncPeople(occupants) {
    if (!this.actorRoot) return;
    const used = {}; const keep = new Set();
    for (const [index, occupant] of occupants.slice(0, 16).entries()) {
      const key = `${occupant.source}:${occupant.id}`; keep.add(key);
      const room = occupantRoom(occupant); const seat = used[room] || 0; used[room] = seat + 1;
      const home = occupantPosition(room, seat);
      let item = this.people.get(key);
      if (!item) { const model = person(this.actorRoot, index + 1); model.position.copy(vec(home)); item = { model, room, index, home, seat }; this.people.set(key, item); }
      if (item.room !== room) {
        const path = [item.model.position.clone(), vec(worldPoint(roomById(item.room))), ...routeBetween(item.room, room).slice(1).map(vec), vec(home)];
        item.transfer = { path, at: 0 }; item.room = room;
      }
      Object.assign(item, { home, seat, status: occupant.status, source: occupant.source, id: occupant.id });
    }
    for (const [key, item] of this.people) if (!keep.has(key)) { this.actorRoot.remove(item.model); this.people.delete(key); }
  }
  placeLabel(element, position, visible = true) {
    if (!element) return;
    const point = position.clone().project(this.camera);
    element.hidden = !visible || point.z < -1 || point.z > 1;
    element.style.left = `${(point.x + 1) * 50}%`; element.style.top = `${(1 - point.y) * 50}%`;
  }
  animatePerson(model, walking, time, working) {
    for (const { arm, leg, sign } of model.userData.limbs) {
      leg.rotation.x = walking && this.motion ? Math.sin(time * 9) * .45 * sign : 0;
      arm.rotation.x = walking && this.motion ? Math.sin(time * 9) * -.4 * sign : working && this.motion ? -.25 + Math.sin(time * 4) * .06 : 0;
    }
    model.userData.body.position.y = walking && this.motion ? Math.abs(Math.sin(time * 9)) * .035 : 0;
  }
  frame(time) {
    if (this.lastTime && time - this.lastTime < 30) return;
    const delta = Math.min((time - (this.lastTime || time)) / 1000, .06); this.lastTime = time;
    if (document.hidden || !this.width || !this.root.getClientRects().length) return;
    if (this.motion) this.elapsed += delta;
    if (this.cameraGoal) { const mix = this.motion ? 1 - Math.exp(-delta * 6) : 1; this.target.lerp(this.cameraGoal.target, mix); this.eye.lerp(this.cameraGoal.eye, mix); this.size += (this.cameraGoal.size - this.size) * mix; }
    this.updateCamera();
    if (this.walk) {
      const walk = this.walk; const elapsed = (time - walk.startedAt) / 1000; let distance = Math.min(1, elapsed / walk.duration) * walk.distance;
      let index = 0; while (index < walk.lengths.length - 1 && distance > walk.lengths[index]) distance -= walk.lengths[index++];
      const a = walk.points[index]; const b = walk.points[index + 1]; this.commander.position.lerpVectors(a, b, Math.min(1, distance / walk.lengths[index]));
      if (a.y === b.y) this.commander.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      this.cabin.visible = a.y !== b.y; this.cabin.position.copy(this.commander.position);
      if (elapsed >= walk.duration) this.finishWalk();
    }
    this.commander.visible = !this.view || this.commander.position.y < this.view * FLOOR_HEIGHT;
    this.cabin.visible = Math.abs(this.commander.position.x - LIFT_X) < .03 && Math.abs(this.commander.position.z - CORRIDOR_Z) < .03;
    this.cabin.position.copy(this.commander.position);
    this.animatePerson(this.commander, Boolean(this.walk), this.elapsed, false);
    for (const item of this.people.values()) {
      const { model, home } = item; let walking = false;
      if (!this.motion) { model.position.copy(vec(home)); item.transfer = null; }
      else if (item.transfer) {
        const transfer = item.transfer; const next = transfer.path[transfer.at + 1];
        if (!next) item.transfer = null;
        else { const direction = next.clone().sub(model.position); const distance = direction.length(); const speed = delta * 3;
          if (distance <= speed) { model.position.copy(next); transfer.at += 1; } else model.position.addScaledVector(direction.normalize(), speed);
          if (direction.x || direction.z) model.rotation.y = Math.atan2(direction.x, direction.z); walking = true;
        }
      } else if (['working', 'idle'].includes(item.status) && item.seat < 4 && item.room === 'office') {
        // A short corridor walk is a spatial animation, never a fabricated work event.
        const phase = (this.elapsed + item.index * 8) % 48;
        if (phase < 18) {
          const room = roomById(item.room); const door = vec(worldPoint(room));
          const hall = vec(worldPoint(room, room.x, CORRIDOR_Z)); const end = hall.clone(); end.x += item.index % 2 ? 2 : -2;
          const path = [vec(home), door, hall, end, hall, door, vec(home)];
          const step = phase / 3; const at = Math.min(5, Math.floor(step)); const a = path[at]; const b = path[at + 1];
          model.position.lerpVectors(a, b, step - at); model.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); walking = true;
        } else { model.position.copy(vec(home)); model.rotation.y = Math.PI; }
      }
      model.visible = !this.view || model.position.y < this.view * FLOOR_HEIGHT;
      this.animatePerson(model, walking, this.elapsed + item.index, !walking && item.status === 'working');
      const label = this.root.querySelector(`[data-person-id="${item.id}"]`);
      this.placeLabel(label, model.position.clone().add(new T.Vector3(0, 1.48, 0)), model.visible);
    }
    for (const room of ROOMS) this.placeLabel(this.root.querySelector(`.room-hotspot[data-room="${room.id}"]`), new T.Vector3((room.left + room.right) / 2, (room.floor - 1) * FLOOR_HEIGHT + 2.5, -.25), !this.view || room.floor <= this.view);
    for (let floor = 1; floor <= 3; floor += 1) this.placeLabel(this.root.querySelector(`[data-floor-label="${floor}"]`), new T.Vector3(-6.8, (floor - 1) * FLOOR_HEIGHT + .55, 3.35), !this.view || floor <= this.view);
    this.placeLabel(this.root.querySelector('#commander-marker'), this.commander.position.clone().add(new T.Vector3(0, 1.52, 0)), this.commander.visible);
    this.renderer.render(this.scene, this.camera);
  }
}
