import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficeWorkspace } from '../../public/workspace.mjs';
import { configureProjectFloors, roomById, FLOOR_HEIGHT } from '../../public/rooms.mjs';
import { Object3D } from '../../public/vendor/three/three.module.js';

const projects = [{ id: 'a', name: 'A', source: 'folder', floor: 2 }, { id: 'b', name: 'B', source: 'folder', floor: 5 }];

function workspaceFixture(t) {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null, querySelector() { return null; } };
  t.after(() => { globalThis.document = previousDocument; configureProjectFloors(); });
  const nodes = new Map();
  const nav = {
    buttons: [], contains(node) { return this.buttons.includes(node); },
    set innerHTML(html) {
      this.buttons = [...html.matchAll(/data-(room|floor)="([^"]+)"/g)].map((match) => ({
        dataset: { [match[1]]: match[2] }, classList: { toggle() {} }, setAttribute() {},
        focus() { document.activeElement = this; },
      }));
    },
    querySelectorAll() { return this.buttons; },
  };
  nodes.set('#room-navigation', nav);
  const scene = {
    view: 1, zoom: 1.3, commander: new Object3D(),
    focusFloor(floor) { this.view = floor; this.zoom = 1; }, setZoom(zoom) { this.zoom = zoom; },
    rebuildFloors() { this.finish?.(); },
    moveCommander() { return new Promise((resolve) => { this.finish = resolve; }); },
  };
  const workspace = Object.assign(Object.create(OfficeWorkspace.prototype), {
    room: 'warehouse', scene, moving: false, selection: null, answerDrafts: new Map(),
    root: { querySelectorAll(selector) { return selector === '[data-floor-label]' ? [] : nav.buttons.filter((button) => button.dataset.floor); } },
    viewControls: { refresh() {} }, renderRoom() {}, renderSelection() {},
    find(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { setAttribute() {}, insertAdjacentHTML() {}, focus() {} });
      return nodes.get(selector);
    },
  });
  workspace.syncProjects(projects);
  return workspace;
}

test('the first live snapshot opens a work floor while an empty snapshot has no fixed workspace', (t) => {
  const workspace = workspaceFixture(t);
  workspace.syncProjects([]);
  assert.equal(workspace.room, 'warehouse');
  workspace.syncProjects(projects, true);
  assert.equal(workspace.room, 'office');
  assert.equal(workspace.scene.view, 2);
});

test('floor removal preserves the surviving room, navigation focus, report draft and zoom', (t) => {
  const workspace = workspaceFixture(t);
  workspace.room = 'office-b';
  workspace.selection = { type: 'task', id: 'report' };
  workspace.answerDrafts.set('report', 'Unsent answer');
  workspace.find('#room-navigation').buttons.find((button) => button.dataset.room === 'office-b').focus();
  workspace.syncProjects([projects[1]]);
  assert.equal(workspace.room, 'office-b');
  assert.equal(workspace.scene.view, 2);
  assert.equal(workspace.scene.commander.position.y, FLOOR_HEIGHT);
  assert.equal(workspace.scene.zoom, 1.3);
  assert.equal(document.activeElement.dataset.room, 'office-b');
  assert.deepEqual(workspace.selection, { type: 'task', id: 'report' });
  assert.equal(workspace.answerDrafts.get('report'), 'Unsent answer');
  workspace.scene.view = 0;
  workspace.syncProjects([]);
  assert.equal(workspace.scene.view, 0);
  assert.equal(workspace.room, 'warehouse');
  assert.equal(document.activeElement.dataset.room, 'warehouse');
  assert.equal(workspace.scene.zoom, 1.3);
  assert.equal(workspace.answerDrafts.get('report'), 'Unsent answer');
});

test('a shrinking building cancels obsolete movement without resurrecting removed rooms or queued visits', async (t) => {
  const workspace = workspaceFixture(t);
  const move = workspace.enter('office');
  const queued = workspace.enter('office-b', { type: 'task', id: 'report' });
  workspace.syncProjects([]);
  await Promise.all([move, queued]);
  assert.equal(workspace.moving, false);
  assert.equal(workspace.room, 'warehouse');
  assert.equal(workspace.scene.view, 0, 'a building view stays open across an update');
  assert.equal(workspace.nextVisit, null);
  assert.equal(workspace.currentVisit, null);
  assert.equal(workspace.selection.id, 'report');
  assert.equal(workspace.scene.commander.position.y, 0);
});

test('surviving movement destinations and corridors follow their project when floor numbers change', async (t) => {
  const workspace = workspaceFixture(t);
  const move = workspace.enter('office-b');
  workspace.syncProjects([projects[1]]);
  await move;
  assert.equal(workspace.room, 'office-b');
  assert.equal(workspace.scene.commander.position.y, FLOOR_HEIGHT);
  workspace.room = 'corridor-2';
  workspace.syncProjects(projects);
  assert.equal(workspace.room, 'corridor-3');
  assert.equal(roomById(workspace.room).floor, 3);
  workspace.syncProjects([]);
  assert.equal(workspace.room, 'warehouse');
});
