import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { configureProjectFloors } from '../../public/rooms.mjs';

// Explicit occupied layout for the existing room, route and activity scenarios.
beforeEach(() => configureProjectFloors([{ id: null, name: 'Test project', source: 'manual', floor: 2 }]));
afterEach(() => configureProjectFloors());
import { buildFloor, applyFloorTheme } from '../../public/office-models.mjs';
import { OfficeScene, officeCameraFrame, arrangePersonLabels } from '../../public/office-3d.mjs';
import { routeBetween, BUILDING, FLOOR_HEIGHT, CORRIDOR_Z, LIFT_X, occupantRoom } from '../../public/rooms.mjs';
import { Object3D, Scene, MeshBasicMaterial, OrthographicCamera, Vector3, Box3, HemisphereLight, DirectionalLight } from '../../public/vendor/three/three.module.js';

test('theme changes update lighting without replacing actors, routes or camera selection', () => {
  const scene = Object.create(OfficeScene.prototype);
  Object.assign(scene, { ambientLight: new HemisphereLight(), fillLight: new DirectionalLight(), renderer: {},
    routeMaterial: new MeshBasicMaterial(), camera: new OrthographicCamera(), commander: new Object3D(),
    people: new Map([['session', new Object3D()]]), view: 3, zoom: 1.4, walk: { destination: 'executive' } });
  const { camera, commander, people, walk } = scene;
  scene.setTheme('light');
  const lightExposure = scene.renderer.toneMappingExposure;
  scene.setTheme('dark');
  assert.ok(scene.renderer.toneMappingExposure < lightExposure);
  assert.equal(scene.routeMaterial.color.getHex(), 0x9bebe1);
  assert.equal(scene.camera, camera); assert.equal(scene.commander, commander);
  assert.equal(scene.people, people); assert.equal(scene.walk, walk);
  assert.equal(scene.view, 3); assert.equal(scene.zoom, 1.4);
});

test('day and night update all floors in place without sharing mutable environment materials', () => {
  const scene = new Scene();
  const floors = [1, 2, 3].map((floor) => buildFloor(scene, floor));
  const findRole = (floor, role) => {
    let result; floor.traverse((node) => { if (node.userData.environmentRole === role) result ||= node; }); return result;
  };
  const nodes = [];
  scene.traverse((node) => nodes.push({ node, geometry: node.geometry, material: node.material }));
  const sky = findRole(floors[0], 'sky');
  const otherSky = findRole(floors[1], 'sky');
  const nightSky = sky.material.color.getHex();
  assert.notEqual(sky.material, otherSky.material);
  applyFloorTheme(floors[0], 'light');
  assert.notEqual(sky.material.color.getHex(), nightSky);
  assert.equal(otherSky.material.color.getHex(), nightSky);
  floors[0].visible = false;
  for (const theme of ['light', 'dark', 'light', 'dark']) for (const floor of floors) {
    const dark = theme === 'dark';
    applyFloorTheme(floor, theme);
    floor.traverse((node) => {
      if (node.userData.environmentPeriod) assert.equal(node.visible, node.userData.environmentPeriod === (dark ? 'night' : 'day'));
    });
    assert.equal(findRole(floor, 'roomLight').intensity > 0, dark);
    assert.equal(findRole(floor, 'lamp').material.emissiveIntensity > 1, dark);
  }
  assert.equal(floors[0].visible, false, 'theme changes must not reveal unselected floors');
  assert.equal(sky.material.color.getHex(), nightSky);
  const after = []; scene.traverse((node) => after.push(node));
  assert.deepEqual(after, nodes.map(({ node }) => node));
  for (const { node, geometry, material } of nodes) {
    assert.equal(node.geometry, geometry); assert.equal(node.material, material);
  }
});

test('missing WebGL preserves room navigation and does not block entry with reduced motion', async () => {
  const fallback = { hidden: true };
  const root = { dataset: {}, querySelector(selector) { return selector === '#scene-fallback' ? fallback : {}; } };
  const scene = new OfficeScene(root); // No DOM/WebGL in Node: exercise the real failure branch.
  assert.equal(root.dataset.rendering, 'unavailable');
  assert.equal(fallback.hidden, false);
  scene.setMotion(false);
  scene.focusFloor(3);
  await scene.moveCommander(routeBetween('office', 'executive'));
  assert.equal(root.dataset.floor, '3');
});

test('a suspended render loop cannot leave room entry waiting forever', async () => {
  const scene = Object.create(OfficeScene.prototype);
  Object.assign(scene, { root: { dataset: { rendering: 'ready' } }, motion: true, commander: new Object3D(), scene: new Scene(), routeMaterial: new MeshBasicMaterial() });
  await scene.moveCommander([{ x: 0, y: 0, z: 0 }, { x: .1, y: 0, z: 0 }]);
  assert.equal(scene.commander.position.x, .1);
  assert.equal(scene.walk, null);
  assert.equal(scene.route, null);
});

test('automatic camera framing contains each floor and the full building at desktop, portrait and ultrawide ratios', () => {
  for (const aspect of [.75, 1.35, 16 / 9, 21 / 9, 3.5]) for (const floor of [0, 1, 2, 3]) {
    const frame = officeCameraFrame(aspect, floor);
    const camera = new OrthographicCamera(-frame.size * aspect / 2, frame.size * aspect / 2, frame.size / 2, -frame.size / 2, .1, 150);
    camera.position.copy(frame.eye); camera.lookAt(frame.target); camera.updateMatrixWorld();
    const base = floor ? (floor - 1) * FLOOR_HEIGHT : 0;
    for (const x of [BUILDING.left, BUILDING.right]) for (const z of [BUILDING.back, BUILDING.front]) for (const y of [base - .45, (floor ? base : 2 * FLOOR_HEIGHT) + BUILDING.wallHeight + .25]) {
      const projected = new Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, `building clipped at aspect ${aspect}, floor ${floor}`);
    }
  }
});

test('zero-length walking requests finish without invalid route geometry', async () => {
  const scene = Object.create(OfficeScene.prototype);
  Object.assign(scene, { root: { dataset: { rendering: 'ready' } }, motion: true, commander: new Object3D(), scene: new Scene() });
  await scene.moveCommander([{ x: 1, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }]);
  assert.deepEqual(scene.commander.position.toArray(), [1, 0, 2]);
  assert.equal(scene.walk, undefined);
});

test('observed activities move actors through the lift and queue new destinations without cutting across floors', () => {
  const scene = Object.create(OfficeScene.prototype);
  Object.assign(scene, { actorRoot: new Object3D(), people: new Map() });
  const actor = { source: 'agent', id: 'session-a', status: 'observing', sessionLifecycle: 'live' };
  scene.syncPeople([actor]);
  const item = scene.people.get('agent:session-a');
  scene.syncPeople([{ ...actor, sceneActivity: { room: 'meeting', pose: 'discussing' } }]);
  assert.equal(item.room, 'meeting'); assert.equal(item.pose, 'discussing');
  for (let index = 1; index < item.transfer.path.length; index++) {
    const [from, to] = [item.transfer.path[index - 1], item.transfer.path[index]];
    if (from.y !== to.y) { assert.equal(from.x, LIFT_X); assert.equal(to.x, LIFT_X); assert.equal(from.z, CORRIDOR_Z); }
  }
  const route = item.transfer;
  item.model.position.copy(route.path[2]);
  scene.syncPeople([{ ...actor, sceneActivity: { room: 'executive', pose: 'presenting' } }]);
  assert.equal(item.transfer, route, 'finish a valid traversal before changing destinations');
  assert.equal(item.nextDestination.room, 'executive');
  assert.equal(item.pose, 'presenting');
  scene.syncPeople([actor]);
  assert.equal(item.nextDestination.room, 'office', 'expiry clears the presentation destination');
  assert.equal(occupantRoom({ source: 'session', status: 'working', sceneActivity: { room: 'executive' } }), 'executive');
});

test('furnished floors stay inside the building envelope and retain route and presentation controls', () => {
  const scene = new Scene();
  for (const floor of [1, 2, 3]) {
    const model = buildFloor(scene, floor);
    const bounds = new Box3().setFromObject(model);
    assert.ok(bounds.min.x >= BUILDING.left - .2 && bounds.max.x <= BUILDING.right + .2, `floor ${floor}: furniture or glazing projects beyond side walls`);
    assert.ok(bounds.min.z >= BUILDING.back - .2 && bounds.max.z <= BUILDING.front + .2);
    assert.ok(bounds.max.y <= (floor - 1) * FLOOR_HEIGHT + BUILDING.wallHeight + .2);
    assert.ok(model.userData.wayfinding.children.length > 0);
    if (floor === 3) assert.equal(model.userData.presentation.visible, false, 'no presentation slide before an actual activity');
  }
});


test('crowded person labels separate within the scene without shrinking controls or changing anchor data', () => {
  const labels = Array.from({ length: 16 }, (_, index) => ({ id: index, x: 360, y: 220, width: 90, height: 44 }));
  const before = structuredClone(labels);
  const arranged = arrangePersonLabels(labels, 820, 560);
  assert.deepEqual(labels, before);
  assert.deepEqual(arranged.map((item) => item.id), labels.map((item) => item.id));
  for (const [index, item] of arranged.entries()) {
    assert.equal(item.width, 90); assert.equal(item.height, 44);
    assert.ok(item.x >= 53 && item.x <= 767 && item.y >= 30 && item.y <= 530);
    for (const other of arranged.slice(index + 1)) assert.ok(Math.abs(item.x - other.x) >= 96 || Math.abs(item.y - other.y) >= 50, 'names remain independently clickable');
  }
});

test('three wrapped full session IDs fit near a mobile map edge even when anchor rings miss available gaps', () => {
  const labels = [[283, 183], [234, 220], [185, 256]].map(([x, y], id) => ({ id, x, y, width: 256, height: 116 }));
  const result = arrangePersonLabels(labels, 820, 560);
  for (const [i, label] of result.entries()) {
    assert.ok(label.x >= 136 && label.x <= 684 && label.y >= 66 && label.y <= 494);
    for (const other of result.slice(i + 1)) assert.ok(Math.abs(label.x - other.x) >= 262 || Math.abs(label.y - other.y) >= 122);
  }
});
