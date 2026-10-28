import { DialogLayer } from './dialog-layer.mjs';

export function initializePasswordDialog(document, { request, notify = () => {} }) {
  const trigger = document.querySelector('#password-button');
  const dialog = document.createElement('dialog');
  dialog.id = 'password-dialog';
  dialog.setAttribute('aria-labelledby', 'password-dialog-title');
  dialog.innerHTML = `<header class="dialog-layer-header"><div><p class="eyebrow">ADMIN</p><h2 id="password-dialog-title">비밀번호 변경</h2></div><button type="button" class="button button-small" data-layer-close>닫기</button></header>
    <div class="dialog-layer-body"><form id="account-password-form" class="form-stack">
      <p class="field-help" id="password-policy">기존과 다른 8~256자로 입력하세요. 변경하면 다른 로그인 세션은 종료됩니다.</p>
      <label class="form-field">현재 비밀번호<input name="currentPassword" type="password" autocomplete="current-password" maxlength="256" required></label>
      <label class="form-field">새 비밀번호<input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="256" aria-describedby="password-policy" required></label>
      <label class="form-field">새 비밀번호 확인<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label>
      <p id="password-dialog-feedback" class="field-help" role="status" aria-live="polite"></p>
      <div class="form-actions"><button class="button" type="button" data-layer-close>취소</button><button class="button button-primary" type="submit">비밀번호 저장</button></div>
    </form></div>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const feedback = dialog.querySelector('#password-dialog-feedback');
  const submit = form.querySelector('[type="submit"]');
  let pending = false;
  const layer = new DialogLayer(dialog, { onClose: () => { form.reset(); feedback.textContent = ''; } });
  trigger.addEventListener('click', () => {
    feedback.textContent = pending ? '비밀번호를 저장하는 중입니다…' : '';
    layer.open();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    const { currentPassword, newPassword, confirmPassword } = form.elements;
    if (newPassword.value !== confirmPassword.value) {
      feedback.textContent = '새 비밀번호가 일치하지 않습니다.';
      confirmPassword.focus();
      return;
    }
    if (currentPassword.value === newPassword.value) {
      feedback.textContent = '현재 비밀번호와 다른 비밀번호를 입력해 주세요.';
      newPassword.focus();
      return;
    }
    pending = true; submit.disabled = true;
    feedback.textContent = '비밀번호를 저장하는 중입니다…';
    try {
      await request('/auth/password', { method: 'POST', body: { currentPassword: currentPassword.value, newPassword: newPassword.value } });
      form.reset();
      const message = '비밀번호를 변경했습니다. 다른 로그인 세션은 종료되었습니다.';
      if (dialog.open) feedback.textContent = message;
      else notify(message);
    } catch (error) {
      if (dialog.open) feedback.textContent = error.message;
      else notify(error.message, true);
    } finally { pending = false; submit.disabled = false; }
  });
  return layer;
}
