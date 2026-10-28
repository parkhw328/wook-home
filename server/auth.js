import { randomBytes, createHash, scrypt as derive, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from './office.js';

const scrypt = promisify(derive);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const TTL = 8 * 60 * 60 * 1000;
const cookieName = 'wook_session';
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const invalid = () => new ApiError(401, 'INVALID_CREDENTIALS', '계정 또는 비밀번호를 확인해 주세요.');
async function passwordHash(password, salt) { return (await scrypt(password, salt, 64, options)).toString('hex'); }

// No credentials in office state, handoff, images, logs, URLs or browser storage.
export async function createAuth(directory, { clock = Date.now } = {}) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'admin-auth.json');
  const initialFile = join(directory, 'admin-initial-password.txt');
  let account;
  const sessions = new Map();
  const attempts = new Map();
  let busy = 0;
  function save(next) {
    writeFileSync(`${file}.tmp`, JSON.stringify(next), { mode: 0o600 });
    chmodSync(`${file}.tmp`, 0o600);
    renameSync(`${file}.tmp`, file);
    account = next;
  }
  try {
    account = JSON.parse(readFileSync(file, 'utf8'));
    if (account.username !== 'admin' || !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{128}$/.test(account.hash)) throw new Error('Invalid account');
    chmodSync(file, 0o600);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read local admin account.');
    const password = randomBytes(24).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    writeFileSync(initialFile, `admin\n${password}\n`, { mode: 0o600 });
    chmodSync(initialFile, 0o600);
    save({ username: 'admin', salt, hash: await passwordHash(password, salt), mustChangePassword: true });
  }
  const tokenFrom = (request) => (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
  const cookie = (token, request, clear = false) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : TTL / 1000}${request.socket?.encrypted ? '; Secure' : ''}`;
  function user(request) {
    const key = digest(tokenFrom(request));
    const session = sessions.get(key);
    if (!session || session.expires <= clock()) { sessions.delete(key); return null; }
    return { username: 'admin', mustChangePassword: account.mustChangePassword, expiresAt: new Date(session.expires).toISOString() };
  }
  function issue(request) {
    for (const [key, value] of sessions) if (value.expires <= clock()) sessions.delete(key);
    if (sessions.size >= 32) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('base64url');
    sessions.set(digest(token), { expires: clock() + TTL });
    return { user: user({ headers: { cookie: `${cookieName}=${token}` } }), cookie: cookie(token, request) };
  }
  async function verify(request, password) {
    const ip = request.socket?.remoteAddress || 'local';
    for (const [key, value] of attempts) if (value.until <= clock()) attempts.delete(key);
    const attempt = attempts.get(ip) || { count: 0, until: clock() + 15 * 60000 };
    if (attempt.count >= 10 || busy >= 2 || attempts.size >= 1024 && !attempts.has(ip)) throw new ApiError(429, 'LOGIN_LIMIT', '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
    attempt.count += 1; attempts.set(ip, attempt);
    if (typeof password !== 'string' || !password || password.length > 256) throw invalid();
    busy += 1;
    try { return timingSafeEqual(Buffer.from(await passwordHash(password, account.salt), 'hex'), Buffer.from(account.hash, 'hex')); }
    finally { busy -= 1; }
  }
  return {
    user,
    require(request) {
      const current = user(request);
      if (!current) throw new ApiError(401, 'LOGIN_REQUIRED', '로그인 후 사무실을 이용해 주세요.');
      if (current.mustChangePassword) throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', '초기 비밀번호를 변경해 주세요.');
      return current;
    },
    async login(request, input) {
      if (!await verify(request, input?.password) || input?.username !== 'admin') throw invalid();
      attempts.delete(request.socket?.remoteAddress || 'local');
      sessions.delete(digest(tokenFrom(request)));
      return issue(request);
    },
    logout(request) { sessions.delete(digest(tokenFrom(request))); return cookie('', request, true); },
    async changePassword(request, input) {
      if (!user(request)) throw new ApiError(401, 'LOGIN_REQUIRED', '다시 로그인해 주세요.');
      const next = input?.newPassword;
      if (typeof next !== 'string' || next.length < 8 || next.length > 256 || next === input.currentPassword) throw new ApiError(400, 'PASSWORD_POLICY', '기존과 다른 비밀번호를 8~256자로 입력해 주세요.');
      const previousHash = account.hash;
      if (!await verify(request, input.currentPassword)) throw invalid();
      const salt = randomBytes(16).toString('hex');
      const hash = await passwordHash(next, salt);
      if (account.hash !== previousHash) throw new ApiError(409, 'PASSWORD_CONFLICT', '비밀번호가 변경되었습니다. 다시 로그인해 주세요.');
      save({ username: 'admin', salt, hash, mustChangePassword: false });
      sessions.clear();
      rmSync(initialFile, { force: true });
      attempts.delete(request.socket?.remoteAddress || 'local');
      return issue(request);
    },
  };
}
