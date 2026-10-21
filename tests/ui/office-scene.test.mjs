import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficeScene, officeCameraFrame } from '../../public/office-3d.mjs';
import { routeBetween, BUILDING, FLOOR_HEIGHT } from '../../public/rooms.mjs';
import { Object3D, Scene, MeshBasicMaterial, OrthographicCamera, Vector3 } from '../../public/vendor/three/three.module.js';

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
    for (const x of [BUILDING.left, BUILDING.right]) for (const z of [BUILDING.back, BUILDING.front]) for (const y of [base - .28, (floor ? base : 2 * FLOOR_HEIGHT) + 2.55]) {
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
