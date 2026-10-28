import { apiRequest } from './api.mjs';
const $ = (selector) => document.querySelector(selector);
function changeMode(required) {
  $('#login-form').hidden = true;
  $('#password-form').hidden = false;
  $('#login-title').textContent = required ? '첫 비밀번호를 설정하세요.' : '비밀번호 변경';
  $('#login-description').textContent = '변경하면 다른 화면의 로그인도 해제됩니다. 기존과 다른 비밀번호를 12자 이상 입력하세요.';
  $('#initial-help').hidden = !required;
  $('#back-to-office').hidden = required;
  $('#current-password').focus();
}
for (const id of ['#login-form', '#password-form']) $(id).addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  if (button.disabled || !form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form));
  if (id === '#password-form' && values.newPassword !== $('#confirm-password').value) { $('#login-feedback').textContent = '새 비밀번호가 일치하지 않습니다.'; return; }
  button.disabled = true; $('#login-feedback').textContent = '확인 중…';
  try {
    const result = await apiRequest(id === '#login-form' ? '/auth/login' : '/auth/password', { method: 'POST', body: values });
    form.reset();
    if (result.user.mustChangePassword) { changeMode(true); $('#login-feedback').textContent = '로그인되었습니다. 초기 비밀번호를 변경해 주세요.'; }
    else location.replace('/');
  } catch (error) { $('#login-feedback').textContent = error.message; }
  finally { button.disabled = false; }
});
try {
  const { user } = await apiRequest('/auth/session');
  if (user) {
    if (user.mustChangePassword || location.hash === '#password') changeMode(user.mustChangePassword);
    else location.replace('/');
  }
  const health = await apiRequest('/health'); $('#login-version').textContent = `v${health.version}`;
} catch (error) { $('#login-feedback').textContent = error.message; }
