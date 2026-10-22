import * as T from './vendor/three/three.module.js';
import { gesturePose } from './office-gestures.mjs';
import { buildFloor, applyFloorTheme, createPerson, createLiftPlatform } from './office-models.mjs';
import { ROOMS, FLOOR_HEIGHT, CORRIDOR_Z, LIFT_X, BUILDING, MEETING_CENTER, roomById, worldPoint, occupantRoom, occupantPosition, routeBetween, pathToDoor } from './rooms.mjs';

const vec = (point) => new T.Vector3(point.x, point.y, point.z);

// Fit the building's projected bounds, rather than a fixed pixel or camera size.
export function officeCameraFrame(aspect, floor = 0) {
  const base = floor ? (floor - 1) * FLOOR_HEIGHT : 0;
  const low = floor ? base - .45 : -.35;
  const high = floor ? base + BUILDING.wallHeight + .25 : 2 * FLOOR_HEIGHT + BUILDING.wallHeight + .25;
  const target = new T.Vector3(-.1, (low + high) / 2, (BUILDING.back + BUILDING.front) / 2);
  const offset = new T.Vector3(26, floor ? 25 : 23, 44);
  const forward = offset.clone().normalize();
  const right = new T.Vector3(forward.z, 0, -forward.x).normalize();
  const up = new T.Vector3().crossVectors(forward, right).normalize();
  let horizontal = 0; let vertical = 0;
  for (const x of [BUILDING.left - .9, BUILDING.right + .45]) for (const y of [low, high]) for (const z of [BUILDING.back - .2, BUILDING.front + .25]) {
    const point = new T.Vector3(x, y, z).sub(target);
    horizontal = Math.max(horizontal, Math.abs(point.dot(right)));
    vertical = Math.max(vertical, Math.abs(point.dot(up)));
  }
  return { target, eye: target.clone().add(offset), size: Math.max(vertical * 2 + .8, (horizontal * 2 + 1.2) / Math.max(.1, aspect)) };
}

// Keep moving name buttons legible without scaling their text. Positions are
// independent of DOM so dense groups and viewport boundaries can be verified.
export function arrangePersonLabels(items, width, height) {
  const placed = [];
  const fits = (candidate) => candidate.x - candidate.width / 2 >= 8 && candidate.x + candidate.width / 2 <= width - 8
    && candidate.y - candidate.height / 2 >= 8 && candidate.y + candidate.height / 2 <= height - 8
    && placed.every((other) => Math.abs(candidate.x - other.x) >= (candidate.width + other.width) / 2 + 6
      || Math.abs(candidate.y - other.y) >= (candidate.height + other.height) / 2 + 6);
  for (const item of items) {
    const home = { ...item, x: Math.max(item.width / 2 + 8, Math.min(width - item.width / 2 - 8, item.x)),
      y: Math.max(item.height / 2 + 8, Math.min(height - item.height / 2 - 8, item.y)) };
    if (fits(home)) { placed.push(home); continue; }
    const candidates = [];
    for (let ring = 1; ring <= 8; ring++) {
      const dx = ring * (item.width + 8); const dy = ring * (item.height + 8);
      for (const [x, y] of [[0, -dy], [-dx, 0], [dx, 0], [-dx, -dy], [dx, -dy], [0, dy], [-dx, dy], [dx, dy]]) candidates.push({ ...home, x: home.x + x, y: home.y + y });
    }
    placed.push(candidates.find(fits) || home);
  }
  return placed;
}

export class OfficeScene {
  constructor(root) {
    this.root = root; this.motion = true; this.view = 2; this.zoom = 1; this.pathsVisible = true; this.people = new Map(); this.lastTime = 0; this.elapsed = 0;
    this.labels = root.querySelector('#room-hotspots');
    try {
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFShadowMap;
      this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.1;
      this.renderer.domElement.setAttribute('aria-label', '층별 방과 복도, 움직이는 동료가 있는 입체 사무실');
      this.renderer.domElement.setAttribute('role', 'img');
      root.querySelector('#office-canvas').append(this.renderer.domElement);
      this.scene = new T.Scene();
      this.leaderRoot = document.createElement('div'); this.leaderRoot.className = 'person-label-leaders'; this.leaderRoot.setAttribute('aria-hidden', 'true'); root.append(this.leaderRoot);
      this.ambientLight = new T.HemisphereLight(0xb9d5ef, 0x3b302b, 2.1);
      this.scene.add(this.ambientLight);
      const light = new T.DirectionalLight(0xffd8a3, 3.5); light.position.set(-6, 24, 14); light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048); Object.assign(light.shadow.camera, { left: -24, right: 24, top: 25, bottom: -20, far: 90 });
      light.shadow.normalBias = .045; light.shadow.bias = -.0001; this.scene.add(light);
      this.keyLight = light;
      const fill = new T.DirectionalLight(0x86b6f0, 1.2); fill.position.set(8, 9, -7); this.scene.add(fill);
      this.fillLight = fill;
      this.floors = [1, 2, 3].map((floor) => buildFloor(this.scene, floor));
      this.actorRoot = new T.Group(); this.scene.add(this.actorRoot);
      this.commander = createPerson(this.actorRoot, 0, true); this.commander.position.copy(vec(worldPoint(roomById('corridor-2'))));
      this.cabin = createLiftPlatform(this.scene);
      this.routeMaterial = new T.MeshBasicMaterial({ color: 0x9bebe1 });
      this.setTheme(document.documentElement.dataset.theme);
      window.addEventListener('office-theme-change', (event) => this.setTheme(event.detail.theme));
      this.camera = new T.OrthographicCamera(-10, 10, 8, -8, .1, 150);
      const frame = officeCameraFrame(2, 2);
      this.target = frame.target; this.eye = frame.eye; this.size = frame.size;
      this.camera.position.copy(this.eye); this.camera.lookAt(this.target);
      this.resize = new ResizeObserver(() => this.resizeScene()); this.resize.observe(root); this.resizeScene();
      this.renderer.domElement.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.fail(); });
      this.focusFloor(2);
      root.dataset.rendering = 'ready'; root.querySelector('#scene-fallback').hidden = true;
      this.renderer.setAnimationLoop((time) => this.frame(time));
    } catch { this.fail(); }
  }
  fail() {
    this.finishWalk(); this.renderer?.setAnimationLoop(null); this.root.dataset.rendering = 'unavailable';
    this.root.querySelector('#scene-fallback').hidden = false;
  }
  setTheme(theme) {
    if (!this.ambientLight) return;
    const dark = theme === 'dark';
    this.ambientLight.color.setHex(dark ? 0x95b4db : 0xdcefff);
    this.ambientLight.groundColor.setHex(dark ? 0x3b302b : 0x9d8e7d);
    this.ambientLight.intensity = dark ? 1.05 : 2.8;
    if (this.keyLight) {
      this.keyLight.color.setHex(dark ? 0xffce94 : 0xfff1d7);
      this.keyLight.intensity = dark ? 2.4 : 3.8;
    }
    this.fillLight.color.setHex(dark ? 0x769bd6 : 0xb4ddff);
    this.fillLight.intensity = dark ? .7 : 1.6;
    this.renderer.toneMappingExposure = dark ? 1.05 : 1.18;
    this.routeMaterial.color.setHex(dark ? 0x9bebe1 : 0x327b70);
    for (const floor of this.floors || []) applyFloorTheme(floor, theme);
    if (this.root) this.root.dataset.environment = dark ? 'night' : 'day';
    this.renderer.domElement?.setAttribute('aria-label', `${dark ? '도시 불빛과 실내 조명이 켜진 밤' : '밝은 하늘과 자연광이 비치는 낮'}의 입체 사무실. 층별 방과 복도, 움직이는 동료`);
  }
  resizeScene() {
    if (!this.camera) return;
    const width = this.root.clientWidth; const height = this.root.clientHeight;
    if (!width || !height) return;
    this.width = width; this.height = height; this.renderer.setSize(width, height, false);
    this.cameraGoal = officeCameraFrame(width / height, this.view);
    this.snapCamera();
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
  updateCamera() {
    const aspect = this.width / this.height; const span = this.size;
    Object.assign(this.camera, { left: -span * aspect / 2, right: span * aspect / 2, top: span / 2, bottom: -span / 2, zoom: this.zoom });
    this.camera.position.copy(this.eye); this.camera.lookAt(this.target); this.camera.updateProjectionMatrix();
  }
  focusFloor(floor = 0) {
    this.view = Number(floor); this.root.dataset.floor = String(this.view);
    for (let i = 0; i < (this.floors?.length || 0); i += 1) this.floors[i].visible = !this.view || i + 1 === this.view;
    if (!this.camera) return;
    this.zoom = 1;
    this.cameraGoal = officeCameraFrame(this.width / this.height, this.view);
    if (!this.motion) this.snapCamera();
  }
  snapCamera() {
    if (!this.cameraGoal || !this.camera) return;
    this.target.copy(this.cameraGoal.target); this.eye.copy(this.cameraGoal.eye); this.size = this.cameraGoal.size; this.updateCamera();
  }
  setMotion(enabled) { this.motion = enabled; if (!enabled) { this.finishWalk(); this.snapCamera(); } }
  setZoom(value) {
    this.zoom = Math.max(.8, Math.min(1.6, Number(value) || 1));
    if (this.camera) this.updateCamera();
    return this.zoom;
  }
  setPaths(visible) {
    this.pathsVisible = Boolean(visible);
    for (const floor of this.floors || []) floor.userData.wayfinding.visible = this.pathsVisible;
    if (this.route) this.route.visible = this.pathsVisible;
  }
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
    const distance = lengths.reduce((a, b) => a + b, 0);
    if (!distance) { this.commander.position.copy(path.at(-1)); return Promise.resolve(); }
    const curve = new T.CurvePath();
    for (let i = 1; i < path.length; i += 1) if (lengths[i - 1]) curve.add(new T.LineCurve3(path[i - 1].clone().add(new T.Vector3(0, .075, 0)), path[i].clone().add(new T.Vector3(0, .075, 0))));
    this.route = new T.Mesh(new T.TubeGeometry(curve, Math.max(12, Math.ceil(distance * 6)), .045, 6, false), this.routeMaterial);
    this.route.visible = this.pathsVisible !== false; this.scene.add(this.route);
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
      const home = occupantPosition(room, seat, occupant.sceneActivity?.pose);
      let item = this.people.get(key);
      if (!item) { const model = createPerson(this.actorRoot, index + 1); model.position.copy(vec(home)); item = { model, room, index, home, seat }; this.people.set(key, item); }
      this.movePerson(item, room, home);
      if (!occupant.sceneActivity && ['disconnected', 'unknown', 'interrupted', 'paused', 'unavailable'].includes(occupant.status)) {
        item.room = room; item.home = home; item.model.position.copy(vec(home)); item.transfer = null; item.nextDestination = null;
      }
      Object.assign(item, { seat, status: occupant.status, source: occupant.source, id: occupant.id, pose: occupant.sceneActivity?.pose || (occupant.status === 'working' ? 'typing' : 'still') });
    }
    for (const [key, item] of this.people) if (!keep.has(key)) { this.actorRoot.remove(item.model); item.leader?.remove(); this.people.delete(key); }
    if (this.floors?.[2]?.userData.presentation) this.floors[2].userData.presentation.visible = occupants.some((actor) => actor.sceneActivity?.pose === 'presenting');
  }
  movePerson(item, room, home) {
    const unchanged = item.room === room && ['x', 'y', 'z'].every((axis) => item.home[axis] === home[axis]);
    if (item.transfer) { item.nextDestination = unchanged ? null : { room, home }; return; }
    if (unchanged) return;
    const path = [...pathToDoor(item.room, item.model.position).map(vec), ...routeBetween(item.room, room).slice(1).map(vec), ...pathToDoor(room, home).reverse().slice(1).map(vec)];
    item.transfer = { path, at: 0 }; item.room = room; item.home = home;
  }
  placeLabel(element, position, visible = true) {
    if (!element) return;
    const point = position.clone().project(this.camera);
    element.hidden = !visible || point.z < -1 || point.z > 1;
    element.style.left = `${(point.x + 1) * 50}%`; element.style.top = `${(1 - point.y) * 50}%`;
    return { x: (point.x + 1) * this.width / 2, y: (1 - point.y) * this.height / 2 };
  }
  animatePerson(model, walking, time, pose = 'still') {
    const gesture = gesturePose(pose, time, walking, this.motion);
    for (const { arm, leg, sign } of model.userData.limbs) {
      const side = sign < 0 ? 'left' : 'right';
      leg.rotation.x = gesture[`${side}Leg`];
      arm.rotation.x = gesture[`${side}Arm`].x;
      arm.rotation.z = gesture[`${side}Arm`].z;
    }
    model.userData.body.position.y = gesture.bob;
    model.userData.body.rotation.z = gesture.lean;
    model.userData.notes.visible = pose === 'presenting' && !walking;
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
    this.commander.visible = !this.view || Math.abs(this.commander.position.y - (this.view - 1) * FLOOR_HEIGHT) < .1;
    this.cabin.visible = this.commander.visible && Math.abs(this.commander.position.x - LIFT_X) < .03 && Math.abs(this.commander.position.z - CORRIDOR_Z) < .03;
    this.cabin.position.copy(this.commander.position);
    this.animatePerson(this.commander, Boolean(this.walk), this.elapsed);
    const personLabels = [];
    for (const item of this.people.values()) {
      const { model, home } = item; let walking = false;
      if (!this.motion) {
        if (item.nextDestination) { Object.assign(item, item.nextDestination); item.nextDestination = null; }
        model.position.copy(vec(item.home)); item.transfer = null;
      }
      else if (item.transfer) {
        const transfer = item.transfer; const next = transfer.path[transfer.at + 1];
        if (!next) {
          item.transfer = null;
          if (item.nextDestination) { const destination = item.nextDestination; item.nextDestination = null; this.movePerson(item, destination.room, destination.home); }
        }
        else { const direction = next.clone().sub(model.position); const distance = direction.length(); const speed = delta * 3;
          if (distance <= speed) { model.position.copy(next); transfer.at += 1; } else model.position.addScaledVector(direction.normalize(), speed);
          if (direction.x || direction.z) model.rotation.y = Math.atan2(direction.x, direction.z); walking = true;
        }
      } else if (['working', 'idle'].includes(item.status) && item.seat < 4 && item.room === 'office') {
        // A short corridor walk is a spatial animation, never a fabricated work event.
        const phase = (this.elapsed + item.index * 16) % 64;
        if (phase < 18) {
          const room = roomById(item.room);
          const hall = vec(worldPoint(room, room.x, CORRIDOR_Z)); const end = hall.clone(); end.x = item.index % 2 ? 10.7 : -9.7;
          const departure = pathToDoor(item.room, home).map(vec);
          const path = [...departure, hall, end, hall, ...departure.slice().reverse()];
          const lengths = path.slice(1).map((point, i) => point.distanceTo(path[i]));
          let distance = phase / 18 * lengths.reduce((sum, length) => sum + length, 0);
          let at = 0; while (at < lengths.length - 1 && distance > lengths[at]) distance -= lengths[at++];
          const a = path[at]; const b = path[at + 1];
          model.position.lerpVectors(a, b, lengths[at] ? distance / lengths[at] : 0); model.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); walking = true;
        } else { model.position.copy(vec(home)); model.rotation.y = Math.PI; }
      }
      if (!walking && !item.transfer && item.pose === 'discussing') model.rotation.y = Math.atan2(MEETING_CENTER.x - model.position.x, MEETING_CENTER.z - model.position.z);
      if (!walking && !item.transfer && item.pose === 'presenting') model.rotation.y = -.35;
      model.visible = !this.view || Math.abs(model.position.y - (this.view - 1) * FLOOR_HEIGHT) < .1;
      this.animatePerson(model, walking, this.elapsed + item.index, item.transfer ? 'still' : item.pose);
      const label = this.root.querySelector(`[data-person-id="${item.id}"]`);
      const anchor = this.placeLabel(label, model.position.clone().add(new T.Vector3(0, 2.05, 0)), model.visible && Boolean(this.view));
      if (label && !label.hidden) personLabels.push({ item, label, ...anchor });
      else if (item.leader) item.leader.hidden = true;
    }
    for (const room of ROOMS) this.placeLabel(this.root.querySelector(`.room-hotspot[data-room="${room.id}"]`), new T.Vector3(room.id === 'office' ? -4.2 : room.id === 'executive' ? -4.7 : (room.left + room.right) / 2, (room.floor - 1) * FLOOR_HEIGHT + 3.75, this.view ? BUILDING.back + 1.4 : 1.6), !this.view || room.floor === this.view);
    for (let floor = 1; floor <= 3; floor += 1) this.placeLabel(this.root.querySelector(`[data-floor-label="${floor}"]`), new T.Vector3(BUILDING.left + .1, (floor - 1) * FLOOR_HEIGHT + .55, BUILDING.front), !this.view || floor === this.view);
    this.placeLabel(this.root.querySelector('#commander-marker'), this.commander.position.clone().add(new T.Vector3(0, 1.8, 0)), this.commander.visible);
    this.layoutPersonLabels(personLabels);
    this.renderer.render(this.scene, this.camera);
  }

  layoutPersonLabels(items) {
    const measured = items.map((entry) => ({ ...entry, width: entry.label.offsetWidth, height: entry.label.offsetHeight }));
    const arranged = arrangePersonLabels(measured, this.width, this.height);
    for (let i = 0; i < arranged.length; i++) {
      const placed = arranged[i]; const anchor = measured[i];
      placed.label.style.left = `${placed.x}px`; placed.label.style.top = `${placed.y}px`;
      const shifted = Math.hypot(placed.x - anchor.x, placed.y - anchor.y) > 2;
      if (shifted && !placed.item.leader) { placed.item.leader = document.createElement('i'); this.leaderRoot.append(placed.item.leader); }
      const leader = placed.item.leader;
      if (!leader) continue;
      leader.hidden = !shifted;
      if (shifted) {
        const dx = anchor.x - placed.x; const dy = anchor.y + anchor.height / 2 - placed.y;
        Object.assign(leader.style, { left: `${placed.x}px`, top: `${placed.y}px`, height: `${Math.hypot(dx, dy)}px`, transform: `rotate(${Math.atan2(dy, dx) - Math.PI / 2}rad)` });
      }
    }
  }
}
