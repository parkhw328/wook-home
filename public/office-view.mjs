export class OfficeViewControls {
  constructor(root, scene) {
    this.root = root;
    this.scene = scene;
    this.fullscreen = root.querySelector('#office-fullscreen');
    this.announcement = root.querySelector('#office-view-status');
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-scene-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.sceneAction;
      if (action === 'in') scene.setZoom(scene.zoom + .15);
      if (action === 'out') scene.setZoom(scene.zoom - .15);
      if (action === 'fit') scene.setZoom(1);
      if (action === 'paths') scene.setPaths(!scene.pathsVisible);
      if (action === 'fullscreen') void this.toggleFullscreen();
      if (action === 'work') root.querySelector('.workbench').scrollIntoView({ behavior: scene.motion ? 'smooth' : 'instant', block: 'start' });
      this.refresh();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.expanded && !event.target.closest('dialog')) {
        event.preventDefault(); event.stopImmediatePropagation(); void this.leaveFullscreen();
      }
    }, true);
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement === root) this.setExpanded(true);
      else if (this.nativeFullscreen) { this.nativeFullscreen = false; this.setExpanded(false, this.restoreFocusOnExit !== false); }
    });
    window.addEventListener('hashchange', () => {
      if (this.expanded && ['#tasks', '#search', '#handoff', '#connection-settings'].includes(location.hash)) void this.leaveFullscreen({ restoreFocus: false });
    });
    this.refresh();
  }

  refresh() {
    const zoom = this.scene.zoom || 1;
    this.root.querySelector('#office-zoom').textContent = `${Math.round(zoom * 100)}%`;
    this.root.querySelector('[data-scene-action="out"]').disabled = zoom <= .8;
    this.root.querySelector('[data-scene-action="in"]').disabled = zoom >= 1.6;
    this.root.querySelector('[data-scene-action="paths"]').setAttribute('aria-pressed', String(this.scene.pathsVisible));
    this.root.querySelector('#scene-legend').hidden = !this.scene.pathsVisible;
  }

  setExpanded(value, restoreFocus = true) {
    this.expanded = value;
    this.root.classList.toggle('is-expanded', value);
    document.body.classList.toggle('office-expanded', value);
    this.fullscreen.setAttribute('aria-pressed', String(value));
    this.fullscreen.querySelector('span').textContent = value ? '전체화면 닫기' : '전체화면';
    this.announcement.textContent = value ? '사무실 전체화면. Escape 또는 전체화면 닫기로 돌아갑니다.' : '일반 화면으로 돌아왔습니다. 선택한 방과 대화는 유지됩니다.';
    if (!value && restoreFocus && !document.querySelector('dialog[open]') && !this.root.closest('[hidden]')) this.fullscreen.focus({ preventScroll: true });
  }

  async toggleFullscreen() {
    if (this.expanded) return this.leaveFullscreen();
    this.restoreFocusOnExit = true;
    this.setExpanded(true);
    if (this.root.requestFullscreen && document.fullscreenEnabled) {
      this.nativeFullscreen = true;
      try { await this.root.requestFullscreen(); }
      catch { this.nativeFullscreen = false; this.announcement.textContent = '브라우저 안에서 넓게 펼쳤습니다. 전체화면 닫기로 돌아갑니다.'; }
    }
  }

  async leaveFullscreen({ restoreFocus = true } = {}) {
    this.restoreFocusOnExit = restoreFocus;
    if (document.fullscreenElement === this.root) {
      try { await document.exitFullscreen(); }
      catch { return; }
    }
    this.nativeFullscreen = false;
    this.setExpanded(false, restoreFocus);
  }
}
