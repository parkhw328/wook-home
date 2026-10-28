import { assignedProject, ensureProject } from './projects.js';
import { randomUUID } from 'node:crypto';
import { VERSION, programs, providers } from './catalog.js';
import { modelId, effortId, supportsExecutionOptions } from './execution-options.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const finished = new Set(['completed', 'cancelled', 'failed']);
const fail = (status, code, message) => { throw new ApiError(status, code, message); };

function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'VALIDATION_ERROR', 'JSON 객체를 입력해 주세요.');
  if (Object.keys(body).some((key) => !allowed.includes(key))) fail(400, 'VALIDATION_ERROR', '지원하지 않는 입력 항목이 있습니다.');
}

function text(value, label, limit, required = true) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') fail(400, 'VALIDATION_ERROR', `${label}은 문자열이어야 합니다.`);
  const clean = value.trim();
  if ((required && !clean) || clean.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(clean)) {
    fail(400, 'VALIDATION_ERROR', `${label}은 ${required ? '1' : '0'}~${limit}자로 입력해 주세요.`);
  }
  return clean;
}

function event(state, type, message) {
  state.events.unshift({ id: randomUUID(), type, message, createdAt: now() });
  state.events = state.events.slice(0, 200);
}

function message(role, content) {
  return { id: randomUUID(), role, content, createdAt: now() };
}

function connectionPreference(value) {
  if (value === null) return null;
  fields(value, ['source', 'kind']);
  const kinds = { cli: ['session', 'process'], web: ['conversation', 'page'] };
  if (!kinds[value.source]?.includes(value.kind)) fail(400, 'VALIDATION_ERROR', '지원되는 연결 종류를 선택해 주세요.');
  return { source: value.source, kind: value.kind };
}

function projectName(value = '') {
  const name = text(value, '담당 프로젝트', 80, false);
  if (/[\r\n\t]/.test(name)) fail(400, 'VALIDATION_ERROR', '담당 프로젝트 이름은 한 줄로 입력해 주세요.');
  return name;
}

function refreshAgent(state, agentId) {
  const agent = state.agents.find((item) => item.id === agentId);
  if (!agent) return;
  const provider = providers.find((item) => item.id === agent.provider);
  const task = state.tasks.find((item) => item.agentId === agentId && !finished.has(item.status));
  agent.status = !provider.available ? 'unavailable' : state.office.paused ? 'paused' : task?.status ?? 'idle';
  agent.updatedAt = now();
}

function pauseState(state, reason) {
  state.office.paused = true;
  for (const task of state.tasks) {
    if (!finished.has(task.status) && task.status !== 'paused') {
      task.previousStatus = task.status;
      task.status = 'paused';
      task.updatedAt = now();
    }
  }
  state.agents.forEach((agent) => refreshAgent(state, agent.id));
  event(state, 'office.paused', reason);
}

export function createOffice(store, { name = 'StackQueue Office' } = {}) {
  const officeName = text(name, '사무실 이름', 80);
  let state = store.load();
  if (state && state.schemaVersion !== 1) throw new Error('Unsupported database schema');
  if (!state) {
    state = {
      schemaVersion: 1,
      office: { name: officeName, paused: false, mode: 'local', version: VERSION },
      agents: [], tasks: [], events: [],
    };
    event(state, 'office.created', '새 사무실이 준비되었습니다. 체험 직원을 등록해 보세요.');
  } else if (state.tasks.some((task) => !finished.has(task.status) && task.status !== 'paused')) {
    pauseState(state, '이전 실행의 미완료 업무를 일시 중지했습니다. 확인 후 재개해 주세요.');
  }
  state.releasedAgents ??= [];
  state.sessionRegistry ??= {};
  state.projects ??= [];
  state.office.version = VERSION;
  state.office.name = officeName;
  for (const agent of [...state.agents, ...state.releasedAgents]) {
    agent.projectName ??= '';
    agent.assignedProjectId = assignedProject(state, agent.projectName);
    agent.executionPreference ??= null;
    agent.settingsRevision ??= 0;
  }
  for (const task of state.tasks) {
    if (!Object.hasOwn(task, 'projectId')) {
      const agent = [...state.agents, ...state.releasedAgents].find((item) => item.id === task.agentId);
      task.projectId = agent?.observedProjectId || agent?.assignedProjectId || null;
    }
  }
  store.save(state);

  function update(action) {
    const next = structuredClone(state);
    const result = action(next);
    store.save(next);
    state = next;
    return structuredClone(result);
  }

  function taskById(next, id) {
    const task = next.tasks.find((item) => item.id === id);
    if (!task) fail(404, 'NOT_FOUND', '업무를 찾을 수 없습니다.');
    return task;
  }

  function active(next) {
    if (next.office.paused) fail(409, 'OFFICE_PAUSED', '사무실을 재개한 후 진행해 주세요.');
  }

  // Local-only opaque keys retain alias ownership and explicit opt-outs across
  // restarts. Raw provider IDs and this registry never enter public snapshots.
  function registerSession(next, agentId, key = null) {
    if (key !== null && (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) throw new Error('Invalid session registration key');
    if (key && next.sessionRegistry[key] && next.sessionRegistry[key] !== agentId) fail(409, 'ENTRY_ALREADY_LINKED', '이미 다른 직원에게 연결되어 있습니다.');
    if (key && !Object.hasOwn(next.sessionRegistry, key) && Object.keys(next.sessionRegistry).length >= 4096) fail(409, 'LIMIT_REACHED', '로컬 세션 등록 기록 한도에 도달했습니다.');
    for (const [previous, owner] of Object.entries(next.sessionRegistry)) if (owner === agentId) next.sessionRegistry[previous] = null;
    if (key) next.sessionRegistry[key] = agentId;
  }

  return {
    observeProject(id, workspace) {
      const key = workspace?.workspaceKey && workspace.workspace ? workspace.workspaceKey : null;
      const agent = state.agents.find((item) => item.id === id);
      if (!agent || (agent.observedProjectId || null) === key) return;
      update((next) => {
        const target = next.agents.find((item) => item.id === id);
        target.observedProjectId = key ? ensureProject(next, key, workspace.workspace, 'folder').id : null;
      });
    },
    sessionRegistration(key) { return state.sessionRegistry[key]; },
    hasSessionRegistration(id) { return Object.values(state.sessionRegistry).includes(id); },
    snapshot() {
      const output = structuredClone(state);
      output.tasks.forEach((task) => delete task.previousStatus);
      return { office: output.office, projects: output.projects, providers: structuredClone(providers), agents: output.agents, releasedAgents: output.releasedAgents, tasks: output.tasks, events: output.events, programs: structuredClone(programs) };
    },
    hire(body, preference = null, archiveNote = null, registrationKey = null) {
      fields(body, ['name', 'role', 'provider', 'model', 'reasoningEffort', 'projectName']);
      const connection = connectionPreference(preference);
      return update((next) => {
        if (next.agents.length >= 100) fail(409, 'LIMIT_REACHED', '초기 버전은 직원 100명까지 등록할 수 있습니다.');
        const provider = providers.find((item) => item.id === body.provider);
        if (!provider) fail(400, 'VALIDATION_ERROR', '지원되는 공급자를 선택해 주세요.');
        const model = text(body.model, '모델', 100, false) || provider.models[0] || '';
        const reasoningEffort = text(body.reasoningEffort, '추론 강도', 30, false) || provider.reasoningEfforts[0] || '';
        if ((model && !provider.models.includes(model)) || (reasoningEffort && !provider.reasoningEfforts.includes(reasoningEffort))) {
          fail(400, 'VALIDATION_ERROR', '현재 지원되는 모델과 추론 강도를 선택해 주세요.');
        }
        const agent = {
          id: randomUUID(), name: text(body.name, '이름', 40), role: text(body.role, '역할', 120),
          provider: provider.id, model, reasoningEffort, status: 'idle', location: 'local-container',
          projectName: projectName(body.projectName), executionPreference: null, settingsRevision: 0,
          createdAt: now(), updatedAt: now(),
        };
        agent.assignedProjectId = assignedProject(next, agent.projectName);
        if (connection) agent.connectionPreference = connection;
        if (archiveNote !== null) agent.workArchive = { stored: true, note: text(archiveNote, '보관 메모', 4000, false), updatedAt: now() };
        registerSession(next, agent.id, registrationKey);
        next.agents.push(agent);
        refreshAgent(next, agent.id);
        event(next, 'agent.created', '직원 정보를 등록했습니다.');
        return agent;
      });
    },
    releaseAgent(id, body) {
      fields(body, ['settingsRevision']);
      return update((next) => {
        const agent = next.agents.find((item) => item.id === id);
        if (!agent) fail(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
        if (!Number.isSafeInteger(body.settingsRevision)) fail(400, 'VALIDATION_ERROR', '최신 직원 설정 버전이 필요합니다.');
        if (agent.settingsRevision !== body.settingsRevision) fail(409, 'SETTINGS_CONFLICT', '직원 정보가 변경되었습니다. 상세를 다시 열어 확인해 주세요.');
        if (next.tasks.some((task) => task.agentId === id && !finished.has(task.status))) fail(409, 'AGENT_BUSY', '진행 중인 체험 업무를 완료하거나 취소한 뒤 등록을 해제해 주세요.');
        if (next.releasedAgents.length >= 1000) fail(409, 'LIMIT_REACHED', '직원 해제 기록 한도에 도달했습니다.');
        delete agent.connectionPreference;
        registerSession(next, id);
        agent.settingsRevision += 1;
        agent.releasedAt = now();
        next.agents = next.agents.filter((item) => item.id !== id);
        next.releasedAgents.unshift(agent);
        event(next, 'agent.released', '직원 등록을 해제하고 업무·메모를 해제 기록에 보존했습니다.');
        return { id, released: true };
      });
    },
    restoreAgent(id, body) {
      fields(body, ['settingsRevision']);
      return update((next) => {
        const agent = next.releasedAgents.find((item) => item.id === id);
        if (!agent) fail(404, 'NOT_FOUND', '해제 기록을 찾을 수 없습니다.');
        if (!Number.isSafeInteger(body.settingsRevision)) fail(400, 'VALIDATION_ERROR', '최신 직원 설정 버전이 필요합니다.');
        if (body.settingsRevision !== agent.settingsRevision) fail(409, 'SETTINGS_CONFLICT', '해제 기록을 다시 확인해 주세요.');
        if (next.agents.length >= 100) fail(409, 'LIMIT_REACHED', '직원은 100명까지 등록할 수 있습니다.');
        delete agent.releasedAt;
        agent.settingsRevision += 1;
        next.releasedAgents = next.releasedAgents.filter((item) => item.id !== id);
        next.agents.push(agent);
        refreshAgent(next, id);
        event(next, 'agent.restored', '직원을 다시 등록했습니다. 외부 연결은 직접 선택해 주세요.');
        return agent;
      });
    },
    archiveAgent(id, body) {
      fields(body, ['stored', 'note', 'settingsRevision', 'projectName']);
      if (typeof body.stored !== 'boolean' || !Number.isSafeInteger(body.settingsRevision)) fail(400, 'VALIDATION_ERROR', '보관 여부와 최신 직원 설정 버전이 필요합니다.');
      return update((next) => {
        const agent = next.agents.find((item) => item.id === id);
        if (!agent) fail(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
        if (agent.settingsRevision !== body.settingsRevision) fail(409, 'SETTINGS_CONFLICT', '다른 화면에서 직원 정보를 변경했습니다. 메모를 보존하고 최신 정보를 다시 확인해 주세요.');
        if (agent.provider === 'demo') fail(409, 'PROVIDER_MISMATCH', '체험 업무는 업무보고에서 관리해 주세요.');
        if (body.projectName !== undefined) { agent.projectName = projectName(body.projectName); agent.assignedProjectId = assignedProject(next, agent.projectName); }
        agent.workArchive = { stored: body.stored, note: text(body.note, '보관 메모', 4000, false), updatedAt: now() };
        agent.settingsRevision += 1;
        agent.updatedAt = now();
        event(next, 'agent.archive.updated', body.stored ? '직원 업무를 대기실에 보관했습니다.' : '보관 업무를 사무실로 복귀했습니다. 실제 실행은 별도로 확인해 주세요.');
        return agent;
      });
    },
    setAgentConnection(id, preference, settingsRevision, registrationKey = null) {
      const connection = connectionPreference(preference);
      return update((next) => {
        const agent = next.agents.find((item) => item.id === id);
        if (!agent) fail(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
        if (settingsRevision !== undefined && (!Number.isSafeInteger(settingsRevision) || settingsRevision < 0)) fail(400, 'VALIDATION_ERROR', '직원 설정 버전을 확인해 주세요.');
        if (settingsRevision !== undefined && settingsRevision !== agent.settingsRevision) fail(409, 'SETTINGS_CONFLICT', '다른 화면에서 직원 설정 또는 연결을 변경했습니다. 최신 정보를 확인한 뒤 다시 연결해 주세요.');
        if (agent.provider === 'demo') fail(409, 'PROVIDER_MISMATCH', '체험 직원에는 외부 세션을 연결할 수 없습니다.');
        registerSession(next, id, registrationKey);
        if (connection) agent.connectionPreference = connection;
        else delete agent.connectionPreference;
        agent.settingsRevision += 1;
        agent.updatedAt = now();
        event(next, 'agent.connection.updated', connection ? '직원의 관찰 연결을 지정했습니다.' : '직원의 관찰 연결을 해제했습니다.');
        return agent;
      });
    },
    editAgent(id, body, { execution, canConfigureExecution = false } = {}) {
      fields(body, ['name', 'role', 'model', 'reasoningEffort', 'projectName', 'executionPreference', 'settingsRevision']);
      return update((next) => {
        const agent = next.agents.find((item) => item.id === id);
        if (!agent) fail(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
        if (body.settingsRevision !== undefined && (!Number.isSafeInteger(body.settingsRevision) || body.settingsRevision < 0)) fail(400, 'VALIDATION_ERROR', '직원 설정 버전을 확인해 주세요.');
        if (body.settingsRevision !== undefined && body.settingsRevision !== agent.settingsRevision) fail(409, 'SETTINGS_CONFLICT', '다른 화면에서 직원 설정 또는 연결을 변경했습니다. 작성 내용은 유지됩니다. 최신 설정을 다시 불러온 뒤 저장해 주세요.');
        const provider = providers.find((item) => item.id === agent.provider);
        if (body.name !== undefined) agent.name = text(body.name, '이름', 40);
        if (body.role !== undefined) agent.role = text(body.role, '역할', 120);
        if (body.projectName !== undefined) { agent.projectName = projectName(body.projectName); agent.assignedProjectId = assignedProject(next, agent.projectName); }
        if (body.executionPreference !== undefined) {
          const selection = body.executionPreference;
          if (selection !== null) {
            fields(selection, ['model', 'reasoningEffort']);
            if (!modelId(selection.model) || !effortId(selection.reasoningEffort)) fail(400, 'VALIDATION_ERROR', '기본 모델과 추론 강도를 함께 선택해 주세요.');
            const changed = selection.model !== agent.executionPreference?.model || selection.reasoningEffort !== agent.executionPreference?.reasoningEffort;
            if (changed && (agent.provider !== 'openai' || !canConfigureExecution)) fail(409, 'CAPABILITY_UNAVAILABLE', '모델 설정을 저장하려면 이 직원에게 지원되는 Codex 대화를 연결해 주세요.');
            if (changed && !supportsExecutionOptions(execution, selection)) fail(409, 'MODEL_UNAVAILABLE', '현재 Codex가 지원하는 모델과 추론 강도를 다시 선택해 주세요.');
          }
          agent.executionPreference = selection && { model: selection.model, reasoningEffort: selection.reasoningEffort };
        }
        for (const [key, choices] of [['model', provider.models], ['reasoningEffort', provider.reasoningEfforts]]) {
          if (body[key] !== undefined) {
            if (body[key] !== agent[key]) fail(409, 'CAPABILITY_UNAVAILABLE', '이 연결에서는 모델·추론 강도 변경을 아직 지원하지 않습니다.');
            if (body[key] && !choices.includes(body[key])) fail(400, 'VALIDATION_ERROR', '지원하지 않는 설정입니다.');
          }
        }
        agent.updatedAt = now();
        agent.settingsRevision += 1;
        event(next, 'agent.updated', '직원 정보를 변경했습니다.');
        return agent;
      });
    },
    assign(body) {
      fields(body, ['agentId', 'title', 'description']);
      return update((next) => {
        active(next);
        const agent = next.agents.find((item) => item.id === body.agentId);
        if (!agent) fail(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
        if (!providers.find((item) => item.id === agent.provider).available) fail(409, 'PROVIDER_UNAVAILABLE', '실제 AI 연결은 준비 중입니다. 체험 직원을 이용해 주세요.');
        if (next.tasks.some((task) => task.agentId === agent.id && !finished.has(task.status))) fail(409, 'AGENT_BUSY', '이 직원의 기존 업무를 완료하거나 취소해 주세요.');
        if (next.tasks.length >= 1000) fail(409, 'LIMIT_REACHED', '초기 버전의 업무 저장 한도에 도달했습니다.');
        const task = {
          id: randomUUID(), agentId: agent.id, projectId: agent.observedProjectId || agent.assignedProjectId || null, title: text(body.title, '업무 제목', 120),
          description: text(body.description, '업무 설명', 4000, false), status: 'waiting_input', result: '',
          messages: [message('assistant', '[체험 안내] 실제 AI를 호출하지 않는 업무 흐름입니다. 이 업무에서 가장 중요하게 확인할 점을 알려주세요.')],
          createdAt: now(), updatedAt: now(),
        };
        next.tasks.unshift(task);
        refreshAgent(next, agent.id);
        event(next, 'task.created', '체험 업무가 Commander의 답변을 기다립니다.');
        return task;
      });
    },
    answer(id, body) {
      fields(body, ['content']);
      return update((next) => {
        active(next);
        const task = taskById(next, id);
        if (task.status !== 'waiting_input') fail(409, 'INVALID_STATE', '답변 대기 중인 업무에만 답할 수 있습니다.');
        task.messages.push(message('user', text(body.content, '답변', 4000)));
        task.result = '[체험 결과] Commander의 확인 사항을 저장했습니다. 업무 지시 → 질문 → 답변 → 승인 흐름이 준비되었습니다. 실제 AI 작업이나 파일 변경은 수행하지 않았습니다.';
        task.messages.push(message('assistant', task.result));
        task.status = 'waiting_approval';
        task.updatedAt = now();
        refreshAgent(next, task.agentId);
        event(next, 'task.answered', '체험 결과가 Commander의 승인을 기다립니다.');
        return task;
      });
    },
    approve(id, body) {
      fields(body, []);
      return update((next) => {
        active(next);
        const task = taskById(next, id);
        if (task.status !== 'waiting_approval') fail(409, 'INVALID_STATE', '승인 대기 중인 업무만 완료할 수 있습니다.');
        task.status = 'completed';
        task.updatedAt = now();
        refreshAgent(next, task.agentId);
        event(next, 'task.completed', 'Commander가 체험 결과를 승인했습니다.');
        return task;
      });
    },
    cancel(id, body) {
      fields(body, []);
      return update((next) => {
        const task = taskById(next, id);
        if (finished.has(task.status)) fail(409, 'INVALID_STATE', '이미 종료된 업무입니다.');
        task.status = 'cancelled';
        delete task.previousStatus;
        task.updatedAt = now();
        refreshAgent(next, task.agentId);
        event(next, 'task.cancelled', '업무를 취소했습니다.');
        return task;
      });
    },
    pause(body = {}, reason = '업무를 일시 중지하고 인계할 상태를 저장했습니다.') {
      fields(body, []);
      return update((next) => {
        if (!next.office.paused) pauseState(next, reason);
        return next.office;
      });
    },
    resume(body) {
      fields(body, []);
      return update((next) => {
        if (next.office.paused) {
          next.office.paused = false;
          for (const task of next.tasks) {
            if (task.status === 'paused') {
              task.status = task.previousStatus ?? 'waiting_input';
              delete task.previousStatus;
              task.updatedAt = now();
            }
          }
          next.agents.forEach((agent) => refreshAgent(next, agent.id));
          event(next, 'office.resumed', '사무실 업무를 재개했습니다.');
        }
        return next.office;
      });
    },
    handoff() {
      return {
        schemaVersion: 1, exportedAt: now(),
        notice: '사용자가 입력한 업무·대화가 포함됩니다. 공개 전 내용을 검토하세요. 인증 정보는 수집하지 않습니다. 이 버전은 가져오기를 지원하지 않습니다.',
        office: structuredClone(state.office), agents: state.agents.map(({ connectionPreference: _, workArchive: _archive, ...agent }) => structuredClone(agent)), releasedAgents: state.releasedAgents.map(({ workArchive: _, ...agent }) => structuredClone(agent)), tasks: structuredClone(state.tasks),
      };
    },
  };
}
