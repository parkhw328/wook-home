const FINAL = new Set(['accepted', 'failed', 'unknown', 'expired', 'rejected']);
const RECEIPTS_KEY = 'stackqueue.command-receipts.v1';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function loadCommandReceipts(storage) {
  try {
    const value = JSON.parse(storage.getItem(RECEIPTS_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => UUID.test(entry?.id) && UUID.test(entry?.sessionId))
      .slice(-20).map(({ id, sessionId }) => ({ id, sessionId, status: 'unconfirmed', restored: true }));
  } catch { return []; }
}

export function saveCommandReceipts(storage, deliveries) {
  try {
    storage.setItem(RECEIPTS_KEY, JSON.stringify([...deliveries.values()].slice(-20)
      .map(({ record: { id, sessionId } }) => ({ id, sessionId }))));
  } catch { /* Storage can be unavailable; the in-memory receipt remains usable. */ }
}

export function commandUnavailableReason(state, sessionId, connected = true) {
  if (!connected) return '서버 연결을 확인한 뒤 지시할 수 있습니다.';
  if (state.office?.paused) return '사무실 업무를 재개한 뒤 지시할 수 있습니다.';
  if (state.localSessions?.status !== 'connected') return '호스트 연결 프로그램과의 연결을 확인해 주세요.';
  if (!state.localSessions.sessions?.some((session) => session.id === sessionId)) return '현재 관찰 중인 세션을 선택해 주세요.';
  if (state.agents?.some((agent) => agent.connection?.sessionId === sessionId && agent.workArchive?.stored)) return '대기실에 보관한 업무입니다. 직원 상세에서 사무실로 복귀한 뒤 지시해 주세요.';
  if (state.localSessions.sessions.find((session) => session.id === sessionId)?.canControl === false) return '이 세션은 지시 전송을 지원하지 않습니다. 원래 CLI에서 확인해 주세요.';
  const control = state.localSessions.control;
  if (!control?.enabled) {
    return control?.reason === 'cli_unavailable'
      ? '호스트에서 Codex CLI의 명령 기능을 사용할 수 없습니다. 연결 안내를 확인해 주세요.'
      : '연결 설정에서 Codex 지시 전송을 켜고 저장한 뒤 적용 상태를 확인해 주세요.';
  }
  return '';
}

export function commandPresentation(record) {
  const messages = {
    submitting: ['지시를 접수하는 중', '서버의 접수 응답을 기다립니다.'],
    pending: ['호스트 전송 대기', '지시가 사무실에 접수되었습니다. 연결 프로그램이 Codex에 전달합니다.'],
    sending: ['Codex에 전달 중', '전달 결과를 확인하고 있습니다. 같은 지시를 다시 보내지 마세요.'],
    accepted: ['Codex 큐에 접수됨', '지시가 Codex의 실행 대기열에 들어갔습니다. 작업 완료를 뜻하지 않습니다.'],
    failed: ['지시 전달 실패', 'Codex가 지시를 접수하지 못했습니다. 원래 CLI와 연결 프로그램을 확인해 주세요.'],
    unknown: ['접수 여부 확인 필요', '전달 여부를 확정할 수 없습니다. 중복 실행을 피하려면 원래 CLI에서 먼저 확인하세요.'],
    expired: ['지시 대기 시간 만료', '제한 시간 내 전달되지 않았습니다. 연결 프로그램을 확인한 뒤 새 지시를 작성하세요.'],
    rejected: ['지시가 접수되지 않음', record?.error || '접수 조건을 확인한 뒤 새 지시를 작성하세요.'],
    unconfirmed: ['서버 접수 여부 확인 중', '응답을 받지 못했습니다. 같은 지시 ID로 접수 기록을 조회하며 자동 재전송하지 않습니다.'],
    not_found: ['접수 기록 없음', record?.restored
      ? '현재 서버에 이 지시의 기록이 없습니다. 전송 원문은 저장하지 않으므로 원래 CLI를 확인한 뒤 새 지시를 작성하세요.'
      : '현재 서버에 이 지시의 기록이 없습니다. 다시 전송하면 같은 지시 ID를 사용해 중복 접수를 막습니다.'],
  };
  if (record?.status === 'failed' && record.code === 'MODEL_UNAVAILABLE') messages.failed = ['모델·강도 확인 필요', '현재 Codex에서 지원하지 않는 선택입니다. 지시는 전송하지 않았습니다. 모델 목록을 다시 확인해 주세요.'];
  if (record?.status === 'failed' && record.code === 'SETTINGS_REJECTED') messages.failed = ['실행 설정 적용 실패', 'Codex 연결 또는 모델 설정 변경을 확인하지 못해 지시를 전송하지 않았습니다. 실행 중인 Codex와 연결 프로그램을 확인해 주세요.'];
  if (record?.status === 'failed' && record.code === 'SETTINGS_UNCERTAIN') messages.failed = ['설정 적용 확인 필요', '설정 변경 응답을 받지 못했습니다. 지시는 전송하지 않았으며 모델·강도는 원래 CLI에서 확인해 주세요.'];
  const [title, description] = Object.hasOwn(messages, record?.status) ? messages[record.status] : messages.unknown;
  return {
    title, description,
    final: FINAL.has(record?.status) || (record?.status === 'not_found' && record.restored),
    retry: record?.status === 'not_found' && Boolean(record.content),
  };
}

// A delivery keeps one ID across retries. Reads can recover a lost POST response;
// neither polling nor reconnecting sends a second command automatically.
export class CommandDelivery {
  constructor(request, record, changed = () => {}) {
    this.request = request;
    this.record = { ...record };
    this.changed = changed;
    this.busy = false;
  }

  update(values) {
    Object.assign(this.record, values);
    this.changed(this.record);
  }

  async send() {
    if (this.busy || FINAL.has(this.record.status) || !this.record.content) return;
    this.busy = true;
    this.update({ status: 'submitting', error: '', lookupError: '' });
    try {
      const receipt = await this.request(`/local-sessions/${encodeURIComponent(this.record.sessionId)}/commands`, {
        method: 'POST', body: { id: this.record.id, content: this.record.content,
          ...(this.record.model ? { model: this.record.model, reasoningEffort: this.record.reasoningEffort } : {}) },
      });
      this.update(receipt);
    } catch (error) {
      const uncertain = !error.status || error.status >= 500 || error.code === 'COMMAND_ID_CONFLICT';
      this.update({ status: uncertain ? 'unconfirmed' : 'rejected', error: error.message });
    } finally {
      this.busy = false;
      this.changed(this.record);
    }
    if (this.record.status === 'unconfirmed') await this.check();
  }

  async check() {
    if (this.busy) return;
    this.busy = true;
    try {
      const receipt = await this.request(`/local-commands/${encodeURIComponent(this.record.id)}`);
      this.update({ ...receipt, lookupError: '' });
    } catch (error) {
      if (error.code === 'COMMAND_NOT_FOUND') this.update({ status: 'not_found', lookupError: '' });
      else this.update({ lookupError: '접수 상태를 조회할 수 없습니다. 연결이 복구되면 다시 확인합니다.' });
    } finally {
      this.busy = false;
      this.changed(this.record);
    }
  }

  async retry() {
    if (this.busy || this.record.status !== 'not_found') return;
    await this.check();
    if (this.record.status === 'not_found' && !this.record.lookupError) await this.send();
  }

  shouldPoll() {
    return ['pending', 'sending', 'unconfirmed'].includes(this.record.status) && !this.busy;
  }
}
