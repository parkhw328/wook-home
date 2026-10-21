import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficeScene } from '../../public/office-3d.mjs';
import { routeBetween } from '../../public/rooms.mjs';
import { Object3D, Scene, LineDashedMaterial } from '../../public/vendor/three/three.module.js';

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
  Object.assign(scene, { root: { dataset: { rendering: 'ready' } }, motion: true, commander: new Object3D(), scene: new Scene(), routeMaterial: new LineDashedMaterial() });
  await scene.moveCommander([{ x: 0, y: 0, z: 0 }, { x: .1, y: 0, z: 0 }]);
  assert.equal(scene.commander.position.x, .1);
  assert.equal(scene.walk, null);
  assert.equal(scene.route, null);
});
