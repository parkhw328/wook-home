import * as T from './vendor/three/three.module.js';
import { BUILDING, ROOMS, DESKS, DESK_Z, FLOOR_HEIGHT, CORRIDOR_Z, LIFT_X } from './rooms.mjs';

const colors = { plaster: 0x253347, trim: 0x526178, oak: 0xa37246, walnut: 0x523c2d, cream: 0xe4d6bc, red: 0xc96464, charcoal: 0x1a2433, green: 0x6c9379, brass: 0xc2a16c };
const boxGeometry = new T.BoxGeometry(1, 1, 1);
const sphereGeometry = new T.SphereGeometry(1, 16, 12);
const cylinderGeometry = new T.CylinderGeometry(1, 1, 1, 16);
const materials = new Map();
function material(color, options = {}) {
  const key = JSON.stringify([color, options]);
  if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness: .8, ...options }));
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
function monitor(parent, x, z, size = .95) {
  box(parent, 0x536368, [.31, .025, .23], [x, .84, z]); box(parent, 0x59686a, [.045, .25, .045], [x, .95, z]);
  const screen = box(parent, 0x37494e, [size, .62, .055], [x, 1.3, z]);
  box(screen, 0x5fadd7, [.91, .82, .08], [0, 0, .53], { emissive: 0x3779bd, emissiveIntensity: .7 });
  box(parent, 0xcccac3, [.5, .022, .17], [x, .84, z + .44]);
  for (let line = 0; line < 3; line += 1) box(parent, 0xb5d4d4, [size * (.6 - line * .12), .018, .005], [x - .05, 1.35 - line * .065, z + .032]);
}
function desk(parent, x, z) {
  const node = group(parent, x, 0, z);
  rounded(node, colors.oak, 2.7, .13, 1.25, 0, .78, 0, .06);
  for (const dx of [-.9, .9]) box(node, 0x283342, [.055, .72, .72], [dx, .37, 0]);
  box(node, 0x414b57, [.38, .6, .65], [.6, .34, .05]);
  monitor(node, -.55, -.25); monitor(node, .48, -.25, .72);
  cylinder(node, 0xf4ede3, .07, .15, [.56, .91, .2]);
  box(node, 0x7d9686, [.2, .045, .3], [.6, .86, -.2]);
  chair(parent, x - .3, z + .95, Math.PI);
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

// Repeated planks and city lights are instanced to keep the diorama inexpensive.
function instances(parent, color, entries) {
  const batch = new T.InstancedMesh(boxGeometry, material(color), entries.length);
  const transform = new T.Object3D();
  entries.forEach(({ size, at }, index) => {
    transform.position.set(...at); transform.scale.set(...size); transform.updateMatrix(); batch.setMatrixAt(index, transform.matrix);
  });
  batch.receiveShadow = true; parent.add(batch); return batch;
}
function woodFloor(parent, left, right, back, front) {
  const batches = Array.from({ length: 5 }, () => []);
  let row = 0;
  for (let z = back; z < front; z += .54, row++) {
    for (let x = left - (row % 3) * .92; x < right; x += 2.8) {
      const start = Math.max(left, x); const end = Math.min(right, x + 2.8);
      if (end - start < .04) continue;
      batches[(row + Math.round(x * 3) % 5 + 5) % 5].push({ size: [end - start - .025, .025, Math.min(.52, front - z)], at: [(start + end) / 2, .015, z + Math.min(.52, front - z) / 2] });
    }
  }
  [0x805638, 0x855b3c, 0x8c6141, 0x825839, 0x8a603f].forEach((color, index) => instances(parent, color, batches[index]));
}
function cityWindows(parent) {
  const { back } = BUILDING;
  environmentSurface(box(parent, 0x0b1830, [22.7, 2.8, .1], [1, 1.82, back + .12], { emissive: 0x0b2445, emissiveIntensity: .35 }), 'sky');
  const day = group(parent); day.userData.environmentPeriod = 'day';
  const night = group(parent); night.userData.environmentPeriod = 'night';
  const disc = (target, color, radius, x, y) => {
    const node = new T.Mesh(new T.CircleGeometry(radius, 24), new T.MeshBasicMaterial({ color }));
    node.position.set(x, y, back + .175); target.add(node);
  };
  disc(day, 0xfff2b8, .22, 6.8, 2.87);
  disc(night, 0xd9e6f5, .15, 6.8, 2.9);
  for (const [x, y] of [[-8.3, 3.02], [-5.6, 2.95], [-2.4, 3.1], [.5, 2.97], [3.4, 3.08], [9.4, 3.02], [11.5, 2.96]]) disc(night, 0xb9d3eb, .018, x, y);
  for (const [x, y, width] of [[-7.5, 2.99, .8], [-1.5, 3.08, .55], [9.6, 2.95, .7]]) {
    const cloud = sphere(day, 0xffffff, [width, .09, .012], [x, y, back + .17]);
    cloud.material = new T.MeshBasicMaterial({ color: 0xf1f8ff }); cloud.castShadow = false;
  }
  const warm = []; const blue = [];
  for (let b = 0; b < 22; b++) {
    const x = -9.9 + b * 1.04; const h = 1.15 + (b * 7 % 11) * .13;
    environmentSurface(box(parent, b % 2 ? 0x13243d : 0x192b44, [.85, h, .05], [x, .45 + h / 2, back + .18]), b % 2 ? 'cityFar' : 'cityNear');
    for (let row = 0; row < 9; row++) for (let col = 0; col < 3; col++) {
      const y = .65 + row * .21;
      if (y > h + .3 || (b * 5 + row * 3 + col) % 4 === 0) continue;
      ((b + row + col) % 3 ? blue : warm).push({ size: [.055, .075, .015], at: [x - .22 + col * .22, y, back + .22] });
    }
  }
  for (const [color, entries] of [[0xa4bfd0, blue], [0xddbc78, warm]]) {
    const lights = instances(night, color, entries);
    lights.material = new T.MeshBasicMaterial({ color });
  }
  for (let x = -10.3; x < 12.7; x += 2.8) {
    const width = Math.min(2.68, 12.7 - x);
    environmentSurface(box(parent, 0x6b93b3, [width, 2.8, .025], [x + width / 2, 1.82, back + .28], { transparent: true, opacity: .12, depthWrite: false, roughness: .12 }), 'windowGlass');
  }
  for (let x = -10.3; x < 12.7; x += 2.8) box(parent, 0x182534, [.075, 2.92, .1], [x, 1.84, back + .34]);
  for (const y of [.42, 1.85, 3.24]) box(parent, 0x182534, [23.1, .075, .12], [1.2, y, back + .34]);
}
function slats(parent, x, z, count, side = false) {
  const nodes = [];
  for (let i = 0; i < count; i++) nodes.push({ size: side ? [.11, 3.1, .09] : [.09, 3.1, .11], at: side ? [x, 1.57, z + i * .23] : [x + i * .23, 1.57, z] });
  instances(parent, 0x93673e, nodes);
}
function lamp(parent, x, z) {
  cylinder(parent, colors.brass, .24, .045, [x, .04, z]);
  cylinder(parent, colors.brass, .035, 1.75, [x, .9, z]);
  environmentSurface(cylinder(parent, 0xf7dba1, .32, .48, [x, 1.83, z], { emissive: 0xffc16c, emissiveIntensity: .55 }), 'lamp');
}

// Only environment surfaces own mutable materials. Furniture and characters keep
// their cached materials, and changing one scene cannot recolor another scene.
function environmentSurface(node, role) {
  node.material = node.material.clone(); node.userData.environmentRole = role;
  if (role !== 'lamp') node.castShadow = false;
  return node;
}

export function applyFloorTheme(floor, theme) {
  const dark = theme === 'dark';
  const palette = dark ? {
    sky: { color: 0x0b1830, emissive: 0x0b2445, emissiveIntensity: .35 },
    cityFar: { color: 0x13243d }, cityNear: { color: 0x192b44 },
    windowGlass: { color: 0x6b93b3, opacity: .12 }, lamp: { emissiveIntensity: 1.15 },
  } : {
    sky: { color: 0x92c6e7, emissive: 0x92c6e7, emissiveIntensity: .65 },
    cityFar: { color: 0x8eaabd }, cityNear: { color: 0x68889f },
    windowGlass: { color: 0xb8e0ed, opacity: .07 }, lamp: { emissiveIntensity: .04 },
  };
  floor.traverse((node) => {
    if (node.userData.environmentPeriod) node.visible = node.userData.environmentPeriod === (dark ? 'night' : 'day');
    if (node.userData.environmentRole === 'roomLight') node.intensity = dark ? 22 : 0;
    const values = palette[node.userData.environmentRole];
    if (values) node.material.setValues(values);
  });
}
function glassLine(parent, start, end, fixed, side = false, door = null, height = 2.9) {
  const parts = door === null ? [[start, end]] : [[start, door - .72], [door + .72, end]];
  for (const [a, b] of parts) {
    if (b <= a) continue;
    box(parent, 0x83b9ce, side ? [.035, height, b - a] : [b - a, height, .035], side ? [fixed, height / 2, (a + b) / 2] : [(a + b) / 2, height / 2, fixed], { transparent: true, opacity: .12, roughness: .15, depthWrite: false });
    for (const y of [.09, height]) box(parent, colors.charcoal, side ? [.08, .065, b - a] : [b - a, .065, .08], side ? [fixed, y, (a + b) / 2] : [(a + b) / 2, y, fixed]);
    for (let at = a; at <= b; at += 2.8) box(parent, colors.charcoal, [.065, height, .065], side ? [fixed, height / 2, at] : [at, height / 2, fixed]);
    box(parent, colors.charcoal, [.065, height, .065], side ? [fixed, height / 2, b] : [b, height / 2, fixed]);
  }
  if (door !== null) {
    box(parent, colors.brass, [1.52, .09, .12], [door, height + .02, fixed]);
    const pivot = group(parent, door - .72, 0, fixed); pivot.rotation.y = -.78;
    box(pivot, 0x8fbccb, [1.3, height - .12, .035], [.65, height / 2, 0], { transparent: true, opacity: .1, depthWrite: false });
    box(pivot, colors.charcoal, [.05, height - .08, .06], [1.3, height / 2, 0]);
    box(pivot, colors.brass, [.04, .42, .06], [1.18, 1.28, .05]);
  }
}
function guide(parent, a, b) {
  const length = Math.hypot(b.x - a.x, b.z - a.z); const steps = Math.floor(length / .52);
  for (let i = 0; i <= steps; i++) {
    const t = i / Math.max(1, steps);
    const mark = box(parent, 0x9ed9d2, [.22, .015, .045], [a.x + (b.x - a.x) * t, .062, a.z + (b.z - a.z) * t], { emissive: 0x52a5a2, emissiveIntensity: .3 });
    mark.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  }
}
function architecture(scene, floor) {
  const node = group(scene, 0, (floor - 1) * FLOOR_HEIGHT, 0);
  const { left, right, back, front, roomsLeft, wallHeight } = BUILDING;
  box(node, 0x192535, [right - roomsLeft, .42, front - back], [(right + roomsLeft) / 2, -.23, (back + front) / 2]);
  box(node, 0x192535, [roomsLeft - left, .42, 3.6 - back], [(left + roomsLeft) / 2, -.23, (back + 3.6) / 2]);
  woodFloor(node, roomsLeft, right, back, front); woodFloor(node, left, roomsLeft, back, 3.6);
  box(node, colors.brass, [right - roomsLeft, .045, .035], [(right + roomsLeft) / 2, -.03, front]);
  box(node, colors.plaster, [right - left, wallHeight, .22], [0, wallHeight / 2, back]);
  box(node, colors.plaster, [.22, wallHeight, 3.6 - back], [left, wallHeight / 2, (back + 3.6) / 2]);
  box(node, 0x526278, [right - left + .2, .16, .35], [0, wallHeight, back]);
  box(node, 0x526278, [.35, .16, 3.6 - back], [left, wallHeight, (back + 3.6) / 2]);
  cityWindows(node);
  const sunlight = group(node); sunlight.userData.environmentPeriod = 'day';
  const sunlightMaterial = new T.MeshBasicMaterial({ color: 0xffefc5, transparent: true, opacity: .14, depthWrite: false });
  for (const x of [-8.5, -5.5, -2.5, 6.2, 9.2]) {
    const patch = new T.Mesh(boxGeometry, sunlightMaterial);
    patch.scale.set(1.7, .006, 4.3); patch.position.set(x, .048, -6.8); patch.rotation.y = -.23;
    sunlight.add(patch);
  }
  const roomLight = new T.PointLight(0xffcf94, 22, 22, 2);
  roomLight.position.set(-3, 3, -3); roomLight.userData.environmentRole = 'roomLight'; node.add(roomLight);
  slats(node, left + .15, -8.9, 26, true);
  for (const z of [-7.2, -3.3, .2]) {
    box(node, colors.brass, [.24, .1, .25], [left + .25, 2.9, z]);
    environmentSurface(box(node, 0xffdfa5, [.26, .05, .29], [left + .27, 2.82, z], { emissive: 0xffb65e, emissiveIntensity: 1 }), 'lamp');
  }
  box(node, 0x111d2a, [2.6, 3.2, .3], [LIFT_X, 1.6, 3.52]);
  for (const dx of [-.53, .53]) box(node, 0x9b8c73, [1.02, 2.65, .08], [LIFT_X + dx, 1.34, 3.72], { metalness: .55, roughness: .38 });
  box(node, 0xdec58d, [1.85, .06, .09], [LIFT_X, 2.8, 3.75], { emissive: 0xd5a755, emissiveIntensity: .7 });
  box(node, 0x162330, [.38, .28, .1], [LIFT_X, 3.02, 3.73]);
  box(node, 0x83c5d0, [.15, .08, .02], [LIFT_X, 3.02, 3.79], { emissive: 0x83c5d0, emissiveIntensity: .6 });
  plant(node, -11.6, -6.7, 1.65); bookshelf(node, -11.6, -9.12, 2);
  for (const x of [left + .15, roomsLeft - .12]) box(node, colors.charcoal, [.055, wallHeight, .055], [x, wallHeight / 2, 6.65]);
  const guides = group(node); node.userData.wayfinding = guides;
  guide(guides, { x: LIFT_X, z: CORRIDOR_Z }, { x: right - .8, z: CORRIDOR_Z });
  for (const room of ROOMS.filter((r) => r.floor === floor)) {
    // Low glazing leaves workstations visible; enclosed rooms have full-height glass.
    glassLine(node, room.left, room.right, room.doorZ, false, room.x, room.id === 'office' || room.id === 'lounge' ? 1.35 : 2.9);
    guide(guides, { x: room.x, z: CORRIDOR_Z }, { x: room.x, z: room.z });
  }
  if (floor < 3) glassLine(node, back + .2, 3.6, BUILDING.split, true);
  if (floor === 2) {
    for (const z of DESK_Z.map((v) => v + 2.1)) guide(guides, { x: -9.8, z }, { x: 1.85, z });
    guide(guides, { x: 1.85, z: -5.2 }, { x: 1.85, z: 2.9 });
  }
  // Corridor waiting bench and greenery keep the front edge visibly occupied.
  sofa(node, 8.8, 6.35, 3.2, Math.PI, 0x526077); plant(node, 12.55, 6.25, 1.1);
  rounded(node, 0x25364c, 5.2, .025, 1.4, 8.7, .05, 5.8, .6);
  return node;
}
function conference(node) {
  rounded(node, 0x36475b, 7.9, .026, 8.6, 8.4, .047, -3.2, .2);
  rounded(node, colors.oak, 3.8, .14, 1.7, 8.4, .9, -3, .3);
  for (const x of [6.9, 8.4, 9.9]) for (const z of [-4.45, -1.55]) chair(node, x, z, z < -3 ? 0 : Math.PI, 0x425c6c);
  for (const x of [7.1, 9.7]) box(node, colors.charcoal, [.12, .84, 1.2], [x, .45, -3]);
  for (const x of [7.4, 9.1]) box(node, 0xe4d7bd, [.6, .03, .4], [x, 1, -3]);
  box(node, 0x152232, [3.7, 1.85, .13], [8.4, 2, -9.18]);
  box(node, 0x7ea6b7, [3.4, 1.58, .035], [8.4, 2, -9.09], { emissive: 0x253d52, emissiveIntensity: .4 });
  for (let i = 0; i < 4; i++) box(node, 0xadc7c8, [.4, .3 + i * .22, .025], [7.2 + i * .7, 1.45 + i * .11, -9.06]);
  plant(node, 12.15, -8.45, 1.65); lamp(node, 4.4, -8.35);
}
function furnish(node, floor) {
  if (floor === 2) {
    for (const station of DESKS) desk(node, station.x, station.z);
    conference(node);
    plant(node, 2.4, -8.6, 1.6); bookshelf(node, -4.6, -9.12, 3.9);
    for (const z of [-5.8, -1.8]) plant(node, -10.02, z, .8);
    return;
  }
  if (floor === 1) {
    rounded(node, 0x354a4b, 9.6, .025, 7.4, -4.4, .047, -4.3, .8);
    sofa(node, -5.6, -6.6, 4.5, 0, 0x557a6e); sofa(node, -8.8, -4.2, 3.1, Math.PI / 2, 0x8a7966);
    sofa(node, -.4, -4.2, 3.1, -Math.PI / 2, 0x8a7966);
    rounded(node, colors.walnut, 2.7, .13, 1.35, -4.5, .55, -3.8, .25);
    cylinder(node, colors.charcoal, .18, .5, [-4.5, .27, -3.8]);
    box(node, 0xd6c4a1, [.7, .06, .5], [-4.8, .65, -3.8]); plant(node, -4, -3.8, .4);
    bookshelf(node, -5.2, -9.12, 4); lamp(node, -9.5, -7.5); plant(node, 2.5, -8.4, 1.7);
    rounded(node, colors.walnut, 4.2, 1.05, 1.25, -6.4, .56, 1.1, .15);
    rounded(node, colors.oak, 4.4, .11, 1.4, -6.4, 1.13, 1.1, .1);
    box(node, 0x667e89, [.9, .55, .08], [-6.7, 1.46, .9]); plant(node, -8, 1.2, .55);
    rounded(node, 0xb4af96, 8.7, .025, 11.8, 8.4, .047, -3, .1);
    box(node, 0x53695c, [7.2, 1, .9], [8.3, .55, -8.4]); box(node, 0xd8c6a2, [7.4, .12, 1.05], [8.3, 1.1, -8.4]);
    box(node, 0x253342, [.95, .85, .7], [5.6, 1.6, -8.3]); box(node, 0x92adad, [.65, .23, .04], [5.6, 1.8, -7.93]);
    box(node, 0xb5bbb4, [1.35, 2.7, 1], [12, 1.38, -8.3]); box(node, 0x354554, [.04, .7, .04], [11.55, 1.3, -7.77]);
    for (const x of [6.4, 9.9]) {
      cylinder(node, colors.oak, 1, .12, [x, .88, -3.7]); cylinder(node, colors.charcoal, .12, .8, [x, .45, -3.7]);
      for (const dz of [-1.35, 1.35]) chair(node, x, -3.7 + dz, dz < 0 ? 0 : Math.PI, 0x7b8c7b);
    }
    plant(node, 4.5, -.6, 1.3); lamp(node, 12.3, -.9); return;
  }
  rounded(node, 0x33465b, 11.3, .025, 11.6, -4.3, .047, -3, .2);
  rounded(node, colors.walnut, 4.8, .18, 1.6, -4.7, .95, -6, .12);
  box(node, colors.walnut, [4.5, .9, .2], [-4.7, .48, -6.1]);
  monitor(node, -4.7, -6.1, 1.25); chair(node, -4.7, -7.5, 0, 0x29333f);
  sofa(node, -7.5, -1.3, 2.7, 0, 0x806553); sofa(node, -.5, -1.3, 2.7, 0, 0x806553);
  rounded(node, colors.oak, 2.8, .12, 1.35, -4, .55, -.8, .2); cylinder(node, colors.charcoal, .2, .5, [-4, .26, -.8]);
  bookshelf(node, -7.2, -9.12, 3.3); plant(node, -9.6, -8.3, 1.7); lamp(node, .8, -8.2);
  glassLine(node, -9.3, -2, 2.95, true);
  rounded(node, 0x40455d, 8.1, .025, 10.1, 8.2, .047, -3.6, .3);
  const presentation = group(node, 8.3, 0, -7.9);
  box(presentation, colors.charcoal, [4.9, 2.7, .18], [0, 2, 0]);
  box(presentation, 0xd9e2dd, [4.6, 2.4, .035], [0, 2, .12], { emissive: 0x859a9a, emissiveIntensity: .12 });
  for (const x of [-1.8, 1.8]) box(presentation, colors.charcoal, [.1, .75, .15], [x, .4, 0]);
  const slide = group(presentation); node.userData.presentation = slide; slide.visible = false;
  box(slide, colors.red, [2.8, .15, .025], [-.3, 2.75, .15]);
  for (let i = 0; i < 3; i++) box(slide, 0x647f89, [1.8 - i * .2, .08, .025], [-1, 2.25 - i * .3, .15]);
  for (let i = 0; i < 3; i++) box(slide, [0x577b89, 0xb58654, 0xac646b][i], [.3, .4 + i * .25, .025], [.6 + i * .5, 1.25 + i * .125, .15]);
  plant(node, 12.1, -8.5, 1.5); lamp(node, 4.2, -7.4);
}
export function buildFloor(scene, floor) { const node = architecture(scene, floor); furnish(node, floor); applyFloorTheme(node, 'dark'); return node; }
export function createLiftPlatform(scene) {
  const node = group(scene); box(node, 0x756c59, [2.35, .13, 2.65], [0, -.04, 0]);
  box(node, 0xddc68f, [2.35, .035, .055], [0, .04, 1.3], { emissive: 0x8c713d, emissiveIntensity: .4 });
  node.visible = false; return node;
}

export function createPerson(parent, index, commander = false) {
  const root = group(parent); root.scale.setScalar(1.14); const skin = [0xe9c09d, 0xce9874, 0xf0cdb2, 0xb87b59][index % 4];
  const shirt = commander ? colors.red : [0x55a5aa, 0xd8a960, 0xb37ca4, 0x8baa7d, 0x7d90b5][index % 5];
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
  const shadow = new T.Mesh(new T.CircleGeometry(.31, 24), new T.MeshBasicMaterial({ color: 0x09101e, transparent: true, opacity: .15, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .028; root.add(shadow);
  const notes = group(body, -.23, .57, .26); notes.rotation.x = -.35;
  rounded(notes, 0x544d47, .24, .3, .035, 0, 0, 0, .025);
  box(notes, 0xf8f2e4, [.2, .25, .01], [0, 0, .025]); notes.visible = false;
  root.userData.notes = notes;
  root.userData.limbs = limbs; return root;
}
