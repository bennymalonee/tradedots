import {randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 16 || password.length > 512) throw Error('Use a password with 16–512 characters');
  const salt = randomBytes(16).toString('hex');
  const digest = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${digest.toString('hex')}`;
}
export function validHash(hash) {return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash || '');}
export async function verifyPassword(password, hash) {
  if (!validHash(hash) || typeof password !== 'string' || password.length > 512) return false;
  const [,salt,expected] = hash.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected,'hex'));
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function cookieToken(header, name) {
  const value = String(header || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
export function sameOrigin(request, origin) {
  return request.headers.get('origin') === origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}
export async function login(pool, password, hash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Shared rate limit persists across restarts and serializes concurrent login attempts.
    const {rows:[guard]} = await client.query('SELECT failures,window_start FROM login_guard WHERE id=1 FOR UPDATE');
    const expired = Date.now() - new Date(guard.window_start).getTime() >= 15*60*1000;
    const failures = expired ? 0 : guard.failures;
    if (failures >= 10) {await client.query('COMMIT'); return {status:429};}
    if (!(await verifyPassword(password, hash))) {
      await client.query('UPDATE login_guard SET failures=$1,window_start=CASE WHEN $2 THEN now() ELSE window_start END WHERE id=1',[failures+1,expired]);
      await client.query('COMMIT'); return {status:401};
    }
    const token = randomBytes(32).toString('hex');
    await client.query('DELETE FROM owner_sessions WHERE expires_at<=now()');
    await client.query("INSERT INTO owner_sessions(token_hash,expires_at) VALUES($1,now()+interval '8 hours')",[tokenHash(token)]);
    await client.query('UPDATE login_guard SET failures=0,window_start=now() WHERE id=1');
    await client.query('COMMIT'); return {status:200,token};
  } catch(error) {await client.query('ROLLBACK'); throw error;}
  finally {client.release();}
}
