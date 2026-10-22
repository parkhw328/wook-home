import { apiRequest } from './api.mjs';
import { displayTime } from './model.mjs';

export function settingsMessage(state) {
  if (!state) return '설정을 불러오고 있습니다.';
  const messages = {
    storage_error: '설정 파일을 읽을 수 없습니다. 아래 연결 안내에서 공유 폴더 권한을 확인해 주세요.',
    not_connected: '연결 프로그램 실행 대기 · 선택을 저장한 뒤 아래 실행 안내를 따라 주세요.',
    upgrade_required: '이전 연결 프로그램이 실행 중입니다. 최신 코드에서 연결 프로그램만 다시 실행해 주세요.',
    bridge_error: '연결 프로그램이 설정 파일을 읽지 못했습니다. 서버와 호스트의 공유 폴더 권한을 확인해 주세요.',
    pending: '저장됨 · 연결 프로그램의 적용 확인을 기다리고 있습니다. 보통 5초 안에 반영됩니다.',
    applied: state.saved ? '저장한 설정을 연결 프로그램에 적용했습니다.' : '현재 연결 설정입니다. 원하는 기능을 선택하고 저장하세요.',
  };
  if (state.status === 'applied' && state.options.commands && !state.applied?.commands) return '설정은 반영됐지만 지시 전송은 준비되지 않았습니다. 호스트의 Codex 설치와 명령 지원을 확인해 주세요.';
  return messages[state.status] || '연결 상태를 확인해 주세요.';
}

export function mountBridgeSettings(root) {
  root.innerHTML = `<header class="connection-settings-heading"><h3 tabindex="-1" id="connection-settings-title">이 사무실에서 사용할 기능</h3><p>필요한 기능을 선택하세요. 저장하면 실행 중인 연결 프로그램에 반영되고 다음 실행에도 유지됩니다.</p></header>
    <p class="settings-summary" id="bridge-settings-status" role="status"></p><p id="bridge-settings-scope" class="session-scope"></p>
    <form id="bridge-settings-form"><fieldset id="bridge-settings-fields" disabled><legend class="sr-only">연결 기능 선택</legend>
      <label class="connection-option" for="setting-conversations"><input type="checkbox" id="setting-conversations" name="conversations"><span><strong>공개 대화 읽기</strong><span>연결한 프로젝트의 최근 Codex 지시와 공개 응답을 대화창에서 읽습니다. 최근 최대 60개 메시지를 표시합니다.</span><small>시스템 지침·내부 추론·도구 원문은 제외합니다. 끄면 임시 읽기 사본을 정리합니다.</small><span class="subtle-tag" data-setting-state="conversations">확인 중</span></span></label>
      <label class="connection-option" for="setting-searchHistory"><input type="checkbox" id="setting-searchHistory" name="searchHistory"><span><strong>CLI 대화 검색 보관</strong><span>연결한 프로젝트의 Codex·Claude Code·Gemini 공개 대화를 이 PC에 보관해 자료 검색에서 찾습니다.</span><small>최근 대화 읽기와 별도입니다. 끄면 새 수집만 멈추고 기존 검색 사본은 유지합니다.</small><span class="subtle-tag" data-setting-state="searchHistory">확인 중</span></span></label>
      <label class="connection-option" for="setting-commands"><input type="checkbox" id="setting-commands" name="commands"><span><strong>Codex 지시 전송</strong><span>사무실에서 작성한 지시를 지원되는 기존 Codex 세션에 보낼 수 있습니다. 이 선택만으로 지시를 보내지는 않습니다.</span><small>끄면 새 전송을 막습니다. 이미 전송 중인 지시와 실행 중인 업무는 취소하지 않습니다.</small><span class="subtle-tag" data-setting-state="commands">확인 중</span></span></label>
    </fieldset><p class="settings-scope-note">이 설정은 사무실 서버가 실행되는 PC와 연결한 프로젝트에 적용됩니다. 웹 대화 보관은 자료 검색에서 개별 동의를 거쳐 설정합니다.</p>
    <div class="settings-actions"><button type="submit" class="button button-primary" id="bridge-settings-save" disabled>설정 저장</button><button type="button" class="button" id="bridge-settings-reload">저장된 설정 다시 불러오기</button></div><p id="bridge-settings-feedback" role="status"></p></form>
    <details id="bridge-start-guide" class="bridge-start-guide"><summary>처음 연결하거나 연결 프로그램을 업데이트할 때</summary><ol><li><strong>서버 PC에서 터미널 열기</strong><p>CLI를 사용하는 계정으로 이 저장소 폴더를 여세요. Docker 밖에서 실행하며 Node.js 24.14 이상, 27 미만이 필요합니다. 다른 PC로 사무실을 보고 있어도 명령은 서버 PC에서 실행하세요.</p></li><li><strong>아래 명령을 한 번 실행하기</strong><p>이미 이전 연결 프로그램이 실행 중이면 그 터미널에서 Ctrl+C로 종료한 뒤 실행하세요. Codex 자체는 재시작하지 않습니다.</p><label for="bridge-start-command">저장소 폴더에서 실행할 명령</label><textarea id="bridge-start-command" rows="2" readonly spellcheck="false">npm ci
npm run bridge:codex -- --workspace .</textarea><button type="button" class="button" id="bridge-command-copy">실행 명령 복사</button><p id="bridge-copy-feedback" role="status"></p><p>다른 프로젝트를 연결할 때는 마지막 <code>.</code>을 해당 폴더 경로로 바꾸세요. 공백이 있는 경로는 따옴표로 감쌉니다. 이 터미널은 계속 켜 둡니다.</p></li><li><strong>화면에서 저장하고 적용 상태 확인하기</strong><p>위에서 기능을 선택하고 저장하세요. 이후 설정 변경에는 연결 프로그램을 다시 실행할 필요가 없습니다. 화면이 호스트 프로그램을 자동 실행하지는 않습니다.</p></li></ol><p><a class="inline-link" href="https://github.com/parkhw328/wook-home/wiki/CLI" target="_blank" rel="noopener noreferrer">연결·권한 문제 해결 ↗</a></p></details>`;
  const find = (selector) => root.querySelector(selector);
  const form = find('form');
  const keys = ['conversations', 'searchHistory', 'commands'];
  let state;
  let revision = null;
  let dirty = false;
  let busy = false;
  let reading = false;
  let generation = 0;
  let online = false;
  let initialized = false;
  let pendingSince;
  function accept(next, replace = false) {
    state = next;
    online = true;
    if (!initialized || replace || (!dirty && !busy)) {
      revision = state.revision;
      for (const key of keys) form.elements[key].checked = state.options[key];
    }
    if (!initialized) find('#bridge-start-guide').open = ['not_connected', 'upgrade_required'].includes(state.status);
    initialized = true;
    if (state.status !== 'pending') pendingSince = null;
    else pendingSince ||= Date.now();
    render();
  }
  function render() {
    find('#bridge-settings-status').textContent = !online && initialized ? '서버 연결 끊김 · 아래는 마지막으로 받은 상태입니다. 선택한 내용은 유지됩니다.' : settingsMessage(state);
    if (pendingSince && Date.now() - pendingSince > 20000) find('#bridge-settings-status').textContent = '설정은 저장됐지만 적용 응답이 늦어지고 있습니다. 연결 프로그램의 실행 상태와 공유 폴더 권한을 확인해 주세요.';
    find('#bridge-settings-scope').textContent = state ? `연결 프로젝트: ${state.workspace || '연결 후 확인'}${state.updatedAt ? ` · 마지막 확인 ${displayTime(state.updatedAt)}` : ''}` : '';
    find('#bridge-settings-fields').disabled = !state || busy || !online || !state.writable || state.status === 'storage_error';
    find('#bridge-settings-save').disabled = !state || busy || !online || !state.writable || state.status === 'storage_error' || (!dirty && state.saved);
    find('#bridge-settings-save').textContent = busy ? '저장 중…' : '설정 저장';
    find('#bridge-settings-reload').disabled = busy;
    for (const key of keys) {
      const badge = find(`[data-setting-state="${key}"]`);
      badge.textContent = !online ? '상태 확인 필요' : !state?.applied ? '연결 대기' : state.status === 'pending' ? `현재 ${state.applied[key] ? '켜짐' : '꺼짐'} · 적용 대기`
        : key === 'commands' && state.options.commands && !state.applied.commands ? '지시 전송 준비 필요' : state.applied[key] ? '현재 켜짐' : '현재 꺼짐';
    }
    if (state && !state.writable) find('#bridge-settings-status').textContent = '설정 폴더에 쓸 수 없습니다. 연결 프로그램과 사무실의 공유 폴더 계정·권한을 확인해 주세요.';
  }
  async function read(replace = false) {
    if (reading || busy) return;
    reading = true;
    const current = generation;
    try {
      const next = await apiRequest('/bridge/settings');
      if (current !== generation || busy) return;
      if (replace) { dirty = false; find('#bridge-settings-feedback').textContent = '저장된 설정을 다시 불러왔습니다.'; }
      accept(next, replace);
      if (dirty && next.revision !== revision) find('#bridge-settings-feedback').textContent = '다른 화면에서 설정이 변경됐습니다. 현재 선택은 유지했습니다. 저장된 설정 다시 불러기로 최신 선택을 확인하세요.';
    } catch (error) {
      if (current !== generation) return;
      online = false; render(); find('#bridge-settings-feedback').textContent = error.message;
    } finally { reading = false; }
  }
  form.addEventListener('change', () => { dirty = true; find('#bridge-settings-feedback').textContent = '아직 저장하지 않은 선택입니다.'; render(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || find('#bridge-settings-save').disabled) return;
    const options = Object.fromEntries(keys.map((key) => [key, form.elements[key].checked]));
    busy = true; generation += 1; render();
    try {
      const next = await apiRequest('/bridge/settings', { method: 'PUT', body: { revision, options } });
      dirty = false; accept(next, true);
      find('#bridge-settings-feedback').textContent = '이 사무실에 저장했습니다. 위에서 실제 적용 상태를 확인하세요.';
    } catch (error) { find('#bridge-settings-feedback').textContent = error.message; }
    finally { busy = false; render(); }
  });
  find('#bridge-settings-reload').addEventListener('click', () => { void read(true); });
  find('#bridge-command-copy').addEventListener('click', async () => {
    const command = find('#bridge-start-command');
    try { await navigator.clipboard.writeText(command.value); find('#bridge-copy-feedback').textContent = '복사했습니다. 서버 PC의 터미널에 붙여 넣어 실행하세요.'; }
    catch { command.focus(); command.select(); find('#bridge-copy-feedback').textContent = '명령을 선택했습니다. Ctrl+C 또는 복사 메뉴로 복사하세요.'; }
  });
  render();
  return { read };
}
