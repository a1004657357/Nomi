const crypto = require('node:crypto');

function createAuthToken(configuredToken) {
  const configured = String(configuredToken || '').trim();
  return configured || crypto.randomBytes(32).toString('hex');
}

function isAllowedOrigin(origin, port) {
  if (!origin) return false;
  if (/^chrome-extension:\/\/[a-z0-9_-]+$/i.test(origin)) return true;
  if (origin === 'https://app.pavo-ai.cn') return true;
  try {
    const url = new URL(origin);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    return url.protocol === 'http:' && loopback && Number(url.port || 80) === Number(port);
  } catch {
    return false;
  }
}

function safeTokenEqual(received, expected) {
  const left = Buffer.from(String(received || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function isAuthorizedRequest(req, url, expectedToken) {
  const headerToken = req?.headers?.['x-nomi-token'];
  const queryToken = url?.searchParams?.get('token');
  const cookieHeader = String(req?.headers?.cookie || '');
  const cookieToken = cookieHeader.split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === 'nomi_token')?.slice(1).join('=');
  let decodedCookieToken = '';
  try { decodedCookieToken = decodeURIComponent(cookieToken || ''); } catch { decodedCookieToken = ''; }
  return safeTokenEqual(headerToken || queryToken || decodedCookieToken, expectedToken);
}

module.exports = { createAuthToken, isAllowedOrigin, isAuthorizedRequest };
