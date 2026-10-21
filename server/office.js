import { randomUUID } from 'node:crypto';
import { VERSION, programs, providers } from './catalog.js';

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
  state.office.version = VERSION;
  state.office.name = officeName;
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

  return {
    snapshot() {
      const output = structuredClone(state);
      output.tasks.forEach((task) => delete task.previousStatus);
      return { office: output.office, providers: structuredClone(providers), agents: output.agents, tasks: output.tasks, events: output.events, programs: structuredClone(programs) };
    },
    hire(body) {
      fields(body, ['name', 'role', 'provider', 'model', 'reasoningEffort']);
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
          createdAt: now(), updatedAt: now(),
        };
        next.agents.push(agent);
        refreshAgent(next, agent.id);
        event(next, 'agent.created', '직원 정보를 등록했습니다.');
        return agent;
      });
    },
    editAgent(id, body) {
      fields(body, ['name', 'role', 'model', 'reasoningEffort']);
      return update((next) => {
        const agent = next.agents.find((item) => item.id === id);
        if (!agent) fail(404, 'NOT_FOUND', '직원을 찾을 수 없습니다.');
        const provider = providers.find((item) => item.id === agent.provider);
        if (body.name !== undefined) agent.name = text(body.name, '이름', 40);
        if (body.role !== undefined) agent.role = text(body.role, '역할', 120);
        for (const [key, choices] of [['model', provider.models], ['reasoningEffort', provider.reasoningEfforts]]) {
          if (body[key] !== undefined) {
            if (body[key] !== agent[key]) fail(409, 'CAPABILITY_UNAVAILABLE', '이 연결에서는 모델·추론 강도 변경을 아직 지원하지 않습니다.');
            if (body[key] && !choices.includes(body[key])) fail(400, 'VALIDATION_ERROR', '지원하지 않는 설정입니다.');
          }
        }
        agent.updatedAt = now();
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
          id: randomUUID(), agentId: agent.id, title: text(body.title, '업무 제목', 120),
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
        office: structuredClone(state.office), agents: structuredClone(state.agents), tasks: structuredClone(state.tasks),
      };
    },
  };
}
