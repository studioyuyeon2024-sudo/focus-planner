// Auth screen: email signup / signin. Mounts the auth overlay.
import { supabase } from './supabase.js';
import { el, clear } from './ui.js';

let mode = 'signin'; // 'signin' | 'signup'

function render(root, onSuccess) {
  clear(root);

  const errEl = el('div', { class: 'auth-err' });
  const okEl = el('div', { class: 'auth-ok' });
  const emailIn = el('input', { type: 'email', placeholder: '이메일', autocomplete: 'email' });
  const pwIn = el('input', { type: 'password', placeholder: '비밀번호 (6자 이상)', autocomplete: mode === 'signup' ? 'new-password' : 'current-password' });
  const submitBtn = el('button', { type: 'submit' }, mode === 'signin' ? '로그인' : '가입하기');
  const switchBtn = el('button', { class: 'auth-link', type: 'button' },
    mode === 'signin' ? '계정이 없으신가요? 가입하기' : '이미 계정이 있나요? 로그인'
  );
  switchBtn.addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    render(root, onSuccess);
  });

  const form = el('form', { class: 'auth-card' },
    el('div', { class: 'auth-title' }, 'Focus Planner'),
    el('div', { class: 'auth-h2' }, mode === 'signin' ? '다시 만나서 반가워요' : '시작해볼까요'),
    el('div', { class: 'auth-sub' }, '뽀모도로 + 시간 블록 + 달력으로 하루를 잘 관리해보세요.'),
    emailIn,
    pwIn,
    submitBtn,
    errEl,
    okEl,
    switchBtn,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    okEl.textContent = '';
    const email = emailIn.value.trim();
    const password = pwIn.value;
    if (!email || password.length < 6) {
      errEl.textContent = '이메일과 6자 이상 비밀번호를 입력해주세요.';
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '...';
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSuccess();
      } else {
        const redirectTo = window.location.origin + window.location.pathname;
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        if (data.session) {
          onSuccess();
        } else {
          okEl.textContent = '가입 완료! 이메일을 확인해 인증 링크를 눌러주세요.';
        }
      }
    } catch (err) {
      errEl.textContent = translateAuthError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'signin' ? '로그인' : '가입하기';
    }
  });

  root.appendChild(form);
  emailIn.focus();
}

function translateAuthError(msg) {
  if (!msg) return '문제가 생겼어요. 다시 시도해주세요.';
  if (/Invalid login credentials/i.test(msg)) return '이메일이나 비밀번호가 맞지 않아요.';
  if (/User already registered/i.test(msg)) return '이미 가입된 이메일이에요. 로그인해보세요.';
  if (/Email not confirmed/i.test(msg)) return '이메일 인증 메일을 먼저 확인해주세요.';
  if (/at least 6 characters/i.test(msg)) return '비밀번호는 6자 이상이어야 해요.';
  return msg;
}

export function mountAuth(onSuccess) {
  const overlay = document.getElementById('authOverlay');
  overlay.style.display = '';
  render(overlay, () => {
    overlay.style.display = 'none';
    onSuccess();
  });
}

export function hideAuth() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'none';
}

export async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}
