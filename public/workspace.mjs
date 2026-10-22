import { ROOMS, FLOORS, roomById, routeBetween, roomTasks, taskRoom, occupantRoom, isHall, hallForFloor } from './rooms.mjs';
import { OfficeScene } from './office-3d.mjs';
import { OfficeViewControls } from './office-view.mjs';
import { ConversationReader, conversationMarkup, conversationReadError } from './conversation.mjs';
import { officeOccupants, sessionRoom, activityRoomMarkup, activitySummaryMarkup } from './office-activity.mjs';
import { escapeHtml as esc, statusLabel, statusClass, displayTime, orderedLocalSessions, unassignedLocalSessions, observedSessionStatus, sessionStatusLabel, taskUnavailableReason } from './model.mjs';

export class OfficeWorkspace {
  constructor(root, { request, onTaskAction, onSession }) {
    this.root = root;
    this.onTaskAction = onTaskAction;
    this.onSession = onSession;
    this.room = 'corridor-2';
    this.selection = null;
    this.detailRevision = 0;
    this.connected = false;
    this.motion = true;
    this.moving = false;
    this.reader = new ConversationReader(request, () => this.renderConversation());
    this.find = (selector) => root.querySelector(selector);
    this.find('#room-navigation').innerHTML = ROOMS.map((room) => `<button type="button" class="room-nav-button" data-room="${room.id}" aria-pressed="false"><span>${room.floor}F</span>${room.name}</button>`).join('');
    this.find('#floor-navigation').innerHTML = FLOORS.map((floor) => `<button type="button" data-floor="${floor.id}" class="floor-tab" aria-pressed="false"><span class="floor-number">${floor.id}</span><span class="floor-tab-copy"><strong>${floor.title}</strong><span>${floor.description}</span></span><span class="floor-people" data-floor-people="${floor.id}">0명</span></button>`).join('') + '<button type="button" data-floor="0" class="floor-tab overview-tab" aria-pressed="false"><span class="floor-number">▤</span><span class="floor-tab-copy"><strong>전체 건물</strong><span>모든 층의 배치 보기</span></span></button>';
    this.find('#room-hotspots').innerHTML = ROOMS.map((room) => `<button type="button" class="room-hotspot room-${room.id}" data-room="${room.id}" aria-label="${room.floor}층 ${room.name} 입장"><span>${room.number}</span><strong>${room.name}</strong><span class="room-count" data-room-count="${room.id}">0</span></button>`).join('');
    this.scene = new OfficeScene(this.find('#office-scene'));
    this.activityStrip = document.createElement('div');
    this.activityStrip.className = 'scene-activity-strip';
    this.activityStrip.setAttribute('aria-label', '협업과 발표');
    this.activityStrip.hidden = true;
    this.find('.floor-panel .scene-header').after(this.activityStrip);
    this.viewControls = new OfficeViewControls(root, this.scene);
    this.focusFloor(2);
    this.find('#terminal-search').addEventListener('input', () => this.renderConversation(true));
    this.find('#terminal-role').addEventListener('change', () => this.renderConversation(true));
    this.find('#terminal-latest').addEventListener('click', () => { const log = this.find('#terminal-log'); log.scrollTop = log.scrollHeight; });
    this.find('#workbench-close').addEventListener('click', () => {
      this.detailRevision += 1;
      this.detailHidden = true;
      this.renderSelection();
      this.find('#workbench-reopen').focus({ preventScroll: true });
    });
    this.find('#workbench-reopen').addEventListener('click', () => {
      this.detailRevision += 1;
      this.detailHidden = false;
      this.renderSelection();
      this.find('#workbench-title').focus({ preventScroll: true });
      void this.reader.refresh();
    });
    root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.dataset.room) void this.enter(button.dataset.room);
      if (button.hasAttribute('data-floor')) this.focusFloor(Number(button.dataset.floor));
      if (button.hasAttribute('data-leave-room')) void this.enter(hallForFloor(roomById(this.room).floor).id);
      if (button.dataset.workspaceTask) void this.selectTask(button.dataset.workspaceTask);
      if (button.dataset.workspaceSession) void this.selectSession(button.dataset.workspaceSession);
      if (button.dataset.reportAction) this.onTaskAction(button.dataset.reportAction, button.dataset.id);
    });
    this.find('#room-navigation').addEventListener('keydown', (event) => {
      const buttons = [...this.find('#room-navigation').querySelectorAll('button')];
      const index = buttons.indexOf(event.target);
      if (index < 0) return;
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus();
      }
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.target.closest('input, textarea, select, dialog')) { event.preventDefault(); void this.enter(hallForFloor(roomById(this.room).floor).id); }
    });
    this.find('#report-answer-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const content = this.find('#report-answer').value.trim();
      if (content && this.selection?.type === 'task') this.onTaskAction('answer', this.selection.id, content);
    });
  }

  update(state, connected, motion, pending = false) {
    this.state = state;
    this.connected = connected;
    this.motion = motion;
    this.pending = pending;
    this.scene.setMotion(motion);
    this.renderRoom();
    this.renderSelection();
  }

  focusFloor(floor) {
    this.scene.focusFloor(floor);
    this.viewControls.refresh();
    for (const button of this.root.querySelectorAll('button[data-floor]')) {
      const active = Number(button.dataset.floor) === floor;
      button.classList.toggle('is-current', active); button.setAttribute('aria-pressed', String(active));
    }
    const level = FLOORS.find((item) => item.id === floor);
    this.find('#floor-view-title').textContent = level ? `${floor}F · ${level.title}` : '세 개의 층, 하나의 팀';
    this.find('#scene-floor-number').textContent = floor ? `${floor}F` : 'ALL';
    this.find('#scene-floor-name').textContent = level?.title || '하나의 오피스';
    this.find('#scene-floor-detail').textContent = floor === 2 ? '집중하는 자리, 함께 논의하는 방' : floor === 3 ? '질문을 나누고, 다음 방향을 정하는 곳' : floor === 1 ? '잠깐의 휴식, 새로운 대화' : '층을 선택해 동료의 공간으로';
  }

  async enter(id, selection = null) {
    this.detailRevision = (this.detailRevision || 0) + 1;
    const room = roomById(id);
    if (selection || room.id !== this.room) this.detailHidden = false;
    // Finish the current doorway traversal before taking a new route. Rapid
    // selections cannot teleport through a wall or run competing animations.
    if (this.moving) {
      this.nextVisit?.resolve?.();
      return new Promise((resolve) => { this.nextVisit = { id: room.id, selection, resolve }; });
    }
    if (room.id !== this.room) {
      this.moving = true;
      this.selection = null;
      this.reader.select(null);
      this.renderSelection();
      const betweenFloors = roomById(this.room).floor !== room.floor;
      this.find('#room-location').textContent = `${room.floor}층 ${room.name} 이동 중 · ${betweenFloors ? '엘리베이터와 복도' : '복도'}를 따라 이동합니다`;
      this.find('#leave-room').disabled = false;
      this.find('#room-panel').setAttribute('aria-busy', 'true');
      if (betweenFloors) this.focusFloor(0);
      await this.scene.moveCommander(routeBetween(this.room, room.id));
      this.room = room.id;
      this.moving = false;
      this.find('#room-panel').setAttribute('aria-busy', 'false');
      this.focusFloor(room.floor);
    }
    if (this.nextVisit) {
      const next = this.nextVisit;
      this.nextVisit = null;
      try { return await this.enter(next.id, next.selection); }
      finally { next.resolve?.(); }
    }
    if (selection) this.selection = selection;
    else if (!this.selection && this.state) {
      const tasks = roomTasks(this.room, this.state.tasks);
      const session = this.room === 'office' && orderedLocalSessions(this.state.localSessions)[0];
      this.selection = session ? { type: 'session', id: session.id } : tasks.length ? { type: 'task', id: tasks[0].id } : null;
    }
    this.reader.select(this.selection?.type === 'session' ? this.selection.id : null);
    this.renderRoom();
    this.renderSelection();
    if (typeof document === 'undefined' || !document.querySelector('dialog[open]')) this.find('#room-heading').focus({ preventScroll: true });
  }

  selectTask(id) {
    const task = this.state?.tasks.find((item) => item.id === id);
    if (!task) return;
    return this.enter(this.room === 'executive' ? 'executive' : taskRoom(task), { type: 'task', id });
  }
  selectSession(id) {
    this.onSession?.(id);
    return this.enter(this.state ? sessionRoom(this.state, id, this.connected) : 'office', { type: 'session', id });
  }

  renderRoom() {
    if (!this.state) return;
    const room = roomById(this.room);
    if (!this.moving) this.find('#room-location').textContent = isHall(this.room) ? `현재 위치 · ${room.name} — 방을 선택해 입장하세요` : `현재 위치 · ${room.floor}층 ${room.name} — 입장 완료`;
    this.find('#room-number').textContent = room.number ? `${room.floor}F / ROOM ${room.number}` : `${room.floor}F / CORRIDOR`;
    this.find('#room-heading').textContent = room.name;
    this.find('#room-description').textContent = room.description;
    this.find('#leave-room').disabled = isHall(this.room) && !this.moving;
    for (const button of this.root.querySelectorAll('[data-room]')) {
      const selected = button.dataset.room === this.room;
      button.classList.toggle('is-current', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    const tasks = roomTasks(this.room, this.state.tasks);
    const sessions = unassignedLocalSessions(this.state);
    const actors = officeOccupants(this.state, this.connected);
    for (const node of this.root.querySelectorAll('[data-floor-people]')) node.textContent = `${actors.filter((actor) => roomById(occupantRoom(actor)).floor === Number(node.dataset.floorPeople)).length}명`;
    const activitySummary = activitySummaryMarkup(actors);
    if (this.activityStrip.dataset.signature !== activitySummary) {
      this.activityStrip.innerHTML = activitySummary;
      this.activityStrip.hidden = !activitySummary;
      this.activityStrip.dataset.signature = activitySummary;
    }
    for (const node of this.root.querySelectorAll('[data-room-count]')) {
      const id = node.dataset.roomCount;
      const count = ['office', 'meeting'].includes(id) ? actors.filter((actor) => occupantRoom(actor) === id).length
        : id === 'executive' ? roomTasks(id, this.state.tasks).length + actors.filter((actor) => actor.sceneActivity?.room === id && !actor.sceneActivity.taskId).length
        : id === 'pantry' ? this.state.events.length : id === 'lounge' ? this.state.agents.filter((agent) => agent.status === 'idle').length : roomTasks(id, this.state.tasks).length;
      node.textContent = `${count}${['office', 'meeting', 'lounge'].includes(id) ? '명' : '건'}`;
    }
    let content = '';
    if (isHall(this.room)) {
      content = '<div class="room-welcome"><span aria-hidden="true">↳</span><strong>같은 건물에서, 함께하는 일.</strong><p>층을 둘러보고 동료의 방을 선택하세요. Commander가 엘리베이터와 복도를 따라 찾아갑니다.</p><p class="room-key-hint">Tab · 방 선택<br>Enter · 입장 / Esc · 퇴실</p></div>';
    } else if (this.room === 'office') {
      content = `<div class="room-section-label">CLI 세션 <span>${sessions.length}</span></div>` + (sessions.map((session) => `<button class="room-entry" type="button" data-workspace-session="${esc(session.id)}" aria-pressed="${this.selection?.id === session.id}"><span class="entry-symbol">&gt;_</span><span><strong>${esc(session.name)}</strong><small>${sessionStatusLabel(observedSessionStatus(this.state.localSessions, session, this.connected))}</small></span><span aria-hidden="true">↗</span></button>`).join('') || '<p class="room-empty">연결된 CLI 세션이 없습니다. 아래 연결 관리에서 작업 폴더와 연결 방법을 확인하세요.</p>');
      content += `<div class="room-section-label">직원 <span>${this.state.agents.length}</span></div>` + this.state.agents.map((agent) => `<button class="room-entry" type="button" data-agent="${esc(agent.id)}"><span class="entry-symbol">${esc(Array.from(agent.name)[0])}</span><span><strong>${esc(agent.name)}</strong><small>${esc(agent.role)} · ${statusLabel(agent.status)}</small></span><span aria-hidden="true">↗</span></button>`).join('');
      content += '<button type="button" class="button button-primary room-assign" data-room-assign>업무 지시</button>';
    } else if (this.room === 'lounge') {
      const idle = this.state.agents.filter((agent) => agent.status === 'idle');
      content = idle.length ? idle.map((agent) => `<button type="button" class="room-entry" data-agent="${esc(agent.id)}"><span class="entry-symbol">${esc(Array.from(agent.name)[0])}</span><span><strong>${esc(agent.name)}</strong><small>새 업무 대기</small></span></button>`).join('') : '<p class="room-empty">지금은 업무를 기다리는 직원이 없습니다.<br>소파에서 잠시 쉬어 가세요.</p>';
    } else if (this.room === 'pantry') {
      content = '<div class="room-section-label">사무실 소식</div>' + (this.state.events.slice(0, 6).map((event) => `<div class="room-news"><p>${esc(event.message)}</p><time>${displayTime(event.createdAt)}</time></div>`).join('') || '<p class="room-empty">아직 등록된 소식이 없습니다.</p>');
    }
    if (['meeting', 'executive'].includes(this.room)) {
      content += activityRoomMarkup(this.room, actors, this.selection?.id);
      if (this.room === 'meeting' && !content) content = '<p class="room-empty">현재 확인된 협업 이벤트가 없습니다. 같은 프로젝트의 지원 세션 간 메시지 전달을 최근 협업으로 표시합니다.</p>';
    }
    if (tasks.length || this.room === 'executive') {
      content += `<div class="room-section-label">${this.room === 'executive' ? '질문 · 업무보고' : '진행 업무'} <span>${tasks.length}</span></div>`;
      content += tasks.map((task) => `<button class="room-entry report-entry" type="button" data-workspace-task="${esc(task.id)}" aria-pressed="${this.selection?.id === task.id}"><span><strong>${esc(task.title)}</strong><small>${esc(this.state.agents.find((agent) => agent.id === task.agentId)?.name || '직원')}</small></span><span class="status ${statusClass(task.status)}">${statusLabel(task.status)}</span></button>`).join('') || '<p class="room-empty">아직 이 공간에서 확인할 업무가 없습니다. 사무실에서 직원에게 업무를 맡겨 보세요.</p>';
    }
    const list = this.find('#room-content');
    if (list.dataset.signature !== content) {
      const focus = document.activeElement;
      const key = focus?.closest('#room-content') ? ['workspaceTask', 'workspaceSession', 'agent'].find((name) => focus.dataset[name]) : null;
      const value = key && focus.dataset[key];
      const scroll = list.scrollTop;
      list.innerHTML = content;
      list.dataset.signature = content;
      list.scrollTop = scroll;
      if (key) [...list.querySelectorAll('button')].find((node) => node.dataset[key] === value)?.focus({ preventScroll: true });
    }
    const assign = this.find('[data-room-assign]');
    if (assign) {
      assign.disabled = !this.connected || this.pending || !this.state.agents.some((agent) => !taskUnavailableReason(this.state, agent));
      assign.title = assign.disabled ? '업무를 맡길 수 있는 체험 직원과 사무실 연결이 필요합니다.' : '';
    }
  }

  renderSelection() {
    if (!this.state) return;
    const selected = this.selection;
    const valid = selected?.type === 'task' ? this.state.tasks.some((task) => task.id === selected.id)
      : selected?.type === 'session';
    this.find('#workbench-empty').hidden = Boolean(valid) && !this.detailHidden;
    this.find('#workbench-detail').hidden = !valid || this.detailHidden;
    this.find('#workbench-reopen').hidden = !valid || !this.detailHidden;
    if (!valid || this.detailHidden) {
      this.find('#workbench-empty-text').textContent = this.detailHidden && valid ? '대화·업무 화면을 닫았습니다. 실행 중인 작업과 작성 내용은 유지됩니다.' : this.moving ? '목적지로 이동하고 있습니다.' : isHall(this.room) ? '방에 입장하면 업무보고와 대화기록이 이곳에 열립니다.' : '이 공간의 직원·세션·업무를 선택해 내용을 확인하세요.';
      return;
    }
    const isTask = selected.type === 'task';
    const task = isTask ? this.state.tasks.find((item) => item.id === selected.id) : null;
    const observed = !isTask ? this.state.localSessions?.sessions?.find((item) => item.id === selected.id) : null;
    const session = !isTask ? observed || { id: selected.id, name: `Codex · ${selected.id.slice(-4)}`, status: 'disconnected' } : null;
    this.find('#workbench-title').textContent = task?.title || session.name;
    this.find('#workbench-kind').textContent = isTask ? '업무보고 · 체험 직원' : `CLI 대화기록 · ${session.id}`;
    const actor = !isTask && officeOccupants(this.state, this.connected).find((item) => item.source === 'session' ? item.id === session.id : item.connection?.sessionId === session.id);
    this.find('#workbench-status').textContent = isTask ? statusLabel(task.status) : actor?.sceneActivity?.label || (observed ? sessionStatusLabel(observedSessionStatus(this.state.localSessions, session, this.connected)) : '세션 관찰 종료');
    this.find('#workbench-status').className = `status ${statusClass(task?.status || observedSessionStatus(this.state.localSessions, session, this.connected))}`;
    const command = this.find('#workbench-command');
    command.hidden = isTask;
    command.dataset.sessionCommand = session?.id || '';
    command.disabled = !this.connected || this.pending || (!isTask && !observed);
    this.find('#report-detail').hidden = !isTask;
    if (task) {
      this.find('#report-owner').textContent = this.state.agents.find((agent) => agent.id === task.agentId)?.name || '직원';
      this.find('#report-goal').textContent = task.description || task.title;
      this.find('#report-result').textContent = task.result ? (typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2)) : task.status === 'waiting_input' ? '직원의 질문에 답하면 결과 보고로 이어집니다.' : '아직 보고된 결과가 없습니다.';
      this.find('#report-next').textContent = task.status === 'waiting_input' ? '대표이사실에서 질문 발표 · Commander 답변 대기' : task.status === 'waiting_approval' ? '대표이사실에서 결과 검토 후 승인' : task.status === 'completed' ? 'Commander 승인 완료' : statusLabel(task.status);
      const form = this.find('#report-answer-form');
      form.hidden = task.status !== 'waiting_input';
      if (form.dataset.taskId !== task.id || task.status !== 'waiting_input') this.find('#report-answer').value = '';
      form.dataset.taskId = task.id;
      this.find('#report-answer').disabled = !this.connected || this.pending || this.state.office.paused;
      this.find('#report-answer-submit').disabled = !this.connected || this.pending || this.state.office.paused;
      const approve = this.find('#report-approve');
      approve.hidden = task.status !== 'waiting_approval';
      approve.dataset.id = task.id;
      approve.disabled = !this.connected || this.pending || this.state.office.paused;
      this.find('#report-review').hidden = task.status !== 'waiting_approval' || this.room === 'executive';
      this.find('#report-review').dataset.workspaceTask = task.id;
      approve.hidden ||= this.room !== 'executive';
      const cancel = this.find('#report-cancel');
      cancel.hidden = ['completed', 'cancelled', 'failed'].includes(task.status);
      cancel.dataset.cancelTask = task.id;
      cancel.disabled = !this.connected || this.pending;
      this.find('#report-paused').hidden = !this.state.office.paused;
    }
    this.renderConversation();
  }

  renderConversation(reset = false) {
    if (!this.state || !this.selection || this.detailHidden) return;
    const isTask = this.selection.type === 'task';
    const task = isTask && this.state.tasks.find((item) => item.id === this.selection.id);
    const data = isTask ? { status: 'ready', messages: (task?.messages || []).filter((message) => ['user', 'assistant'].includes(message.role)), truncated: false } : this.reader.data;
    const status = this.connected ? data?.status : 'disconnected';
    const notes = {
      disabled: '공개 대화 읽기가 꺼져 있습니다. 대화 읽기 설정에서 켜고 저장해 주세요.',
      empty: '수집 범위에 공개 대화가 없습니다. 세션에 첫 메시지를 보내고 다음 갱신을 기다려 주세요.',
      unavailable: conversationReadError(data) || '이 세션의 기록을 읽을 수 없습니다. 연결 프로그램과 선택한 작업 폴더를 확인하세요.',
      disconnected: '연결이 끊겼거나 기록 갱신이 멈췄습니다. 마지막 수신 내용을 표시합니다.',
    };
    this.find('#terminal-notice').textContent = !data ? '대화기록을 불러오는 중입니다.' : notes[status] || (isTask ? '체험 대화 · 실제 AI 응답이 아닙니다.' : `로컬 기록 · ${data.updatedAt ? displayTime(data.updatedAt) + ' 수신 · ' : ''}최근 최대 60개 / 읽기 전용`);
    this.find('#terminal-settings').hidden = isTask || status !== 'disabled';
    this.find('#terminal-scope').textContent = isTask ? '선택한 업무의 대화' : '선택한 프로젝트 · 최근 7일 폴더 중 24시간 내 활동 세션 · 로그 끝 1MB';
    this.find('#terminal-truncated').hidden = !data?.truncated;
    const log = this.find('#terminal-log');
    const identity = `${this.selection.type}:${this.selection.id}`;
    if (log.dataset.identity !== identity) {
      this.find('#terminal-search').value = '';
      this.find('#terminal-role').value = 'all';
      log.dataset.identity = identity;
      reset = true;
    }
    const markup = data?.messages?.length ? conversationMarkup(data.messages, { query: this.find('#terminal-search').value, role: this.find('#terminal-role').value, demo: isTask })
      : `<p class="terminal-empty">${esc(!data ? '연결된 세션의 기록을 기다리고 있습니다.' : notes[status] || '아직 대화가 없습니다.')}</p>`;
    if (log.dataset.signature !== markup || reset) {
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      const scroll = log.scrollTop;
      log.innerHTML = markup;
      log.dataset.signature = markup;
      log.scrollTop = reset ? 0 : atBottom ? log.scrollHeight : scroll;
    }
  }
}
