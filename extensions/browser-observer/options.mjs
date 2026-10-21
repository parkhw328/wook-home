import { officeOrigins } from './tabs.mjs';
import { searchConversation, selectedConversations } from './search.mjs';

const field = document.querySelector('#office-url');
const status = document.querySelector('#status');
const settings = await chrome.storage.local.get('officeUrl');
field.value = settings.officeUrl || 'http://localhost:8080/';
document.querySelector('#settings').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const origins = officeOrigins(field.value);
    await chrome.storage.local.set({ officeUrl: `${origins[0]}/` });
    status.textContent = '저장했습니다. 사무실을 새로고침하고 감지를 켜 주세요.';
  } catch { status.textContent = 'http://localhost:포트/ 형식의 로컬 사무실 주소를 입력하세요.'; }
});

const captureStatus = document.querySelector('#search-status');
const toggle = document.querySelector('#search-toggle');
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const current = tab && !tab.incognito ? searchConversation(tab.url) : null;
let selected = selectedConversations((await chrome.storage.local.get('searchSelections')).searchSelections);
function renderSelections() {
  document.querySelector('#search-current').textContent = current ? `${{openai: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', meta: 'Meta AI'}[current.provider]} · ${current.key.slice(-8)}` : '보관할 AI 대화 탭에서 이 확장 버튼을 열어 주세요. 새 대화 화면은 저장된 대화 주소가 생긴 뒤 선택할 수 있습니다.';
  const enabled = selected.some((entry) => entry.key === current?.key);
  toggle.disabled = !current || (!enabled && selected.length >= 50);
  toggle.textContent = enabled ? '현재 대화 보관 끄기' : '현재 대화 보관 켜기';
  toggle.setAttribute('aria-pressed', String(enabled));
  const list = document.querySelector('#search-selected');
  list.replaceChildren();
  for (const entry of selected) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${entry.provider} · ${entry.key.slice(-8)} 보관 끄기`;
    button.addEventListener('click', () => save(selected.filter((item) => item.key !== entry.key)));
    list.append(button);
  }
}
async function save(next) {
  await chrome.storage.local.set({ searchSelections: next });
  selected = next;
  captureStatus.textContent = '저장했습니다. 사무실의 자료 검색에서 웹 보관을 켜면 반영됩니다. 기존 검색 자료는 유지됩니다.';
  renderSelections();
}
toggle.addEventListener('click', () => {
  if (!current) return;
  save(selected.some((item) => item.key === current.key) ? selected.filter((item) => item.key !== current.key) : [...selected, current]);
});
renderSelections();
