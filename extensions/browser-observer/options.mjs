import { officeOrigins } from './tabs.mjs';

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
