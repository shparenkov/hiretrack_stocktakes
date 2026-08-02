import crypto from 'crypto';
import fs from 'fs';
import { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'stocktake_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

type FailureRecord = { count: number; resetAt: number };

function readPassword(): string {
  const directPassword = process.env.STOCKTAKE_ACCESS_PASSWORD?.trim();
  if (directPassword) return directPassword;

  const passwordFile = process.env.STOCKTAKE_ACCESS_PASSWORD_FILE?.trim();
  if (!passwordFile) return '';
  try {
    return fs.readFileSync(passwordFile, 'utf8').trim();
  } catch {
    return '';
  }
}

function signature(payload: string, password: string): string {
  return crypto.createHmac('sha256', password).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(req: Request): Record<string, string> {
  return (req.headers.cookie || '').split(';').reduce<Record<string, string>>((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    const name = part.slice(0, separator).trim();
    if (!name) return cookies;
    try {
      cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      // Ignore malformed cookie values instead of failing the request.
    }
    return cookies;
  }, {});
}

function hasValidSession(req: Request, password: string): boolean {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return false;
  const separator = token.indexOf('.');
  if (separator < 0) return false;
  const expiresAt = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now()) return false;
  return safeEqual(suppliedSignature, signature(expiresAt, password));
}

function isHttps(req: Request): boolean {
  return req.secure || req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
}

function loginPage(errorMessage = ''): string {
  const error = errorMessage ? `<p class="error">${errorMessage}</p>` : '';
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Stock Check · Вход</title>
  <style>
    :root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #e9edf1; color: #17212b; }
    main { width: min(390px, calc(100vw - 32px)); background: #fff; border: 1px solid #aeb9c4; box-shadow: 0 18px 45px rgba(23,33,43,.14); }
    header { padding: 22px 24px 18px; background: #245995; color: #fff; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; }
    header p { margin: 6px 0 0; color: #dbe8f7; font: 13px Arial, sans-serif; }
    form { padding: 24px; }
    label { display: block; margin-bottom: 8px; font: 600 12px Arial, sans-serif; text-transform: uppercase; letter-spacing: .06em; }
    input { width: 100%; height: 42px; padding: 0 11px; border: 1px solid #8997a5; font: 16px Arial, sans-serif; }
    input:focus { outline: 2px solid #7eb4e8; outline-offset: 1px; }
    button { width: 100%; height: 42px; margin-top: 14px; border: 0; background: #245995; color: #fff; font: 600 14px Arial, sans-serif; cursor: pointer; }
    button:hover { background: #194979; }
    .error { margin: 0 0 14px; padding: 9px 10px; background: #fae7e4; color: #932b20; font: 13px Arial, sans-serif; }
  </style>
</head>
<body>
  <main>
    <header><h1>HireTrack Stock Check</h1><p>Введите пароль для доступа к инвентаризации</p></header>
    <form method="post" action="/login">
      ${error}
      <label for="password">Пароль</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Войти</button>
    </form>
  </main>
</body>
</html>`;
}

export function installPasswordAuth(app: import('express').Express): void {
  const password = readPassword();
  if (!password) {
    throw new Error('STOCKTAKE_ACCESS_PASSWORD or STOCKTAKE_ACCESS_PASSWORD_FILE must be configured.');
  }

  const failures = new Map<string, FailureRecord>();

  app.get('/login', (req, res) => {
    if (hasValidSession(req, password)) return res.redirect('/bitrix/tickets/stocktake-history/');
    return res.type('html').send(loginPage());
  });

  app.post('/login', (req, res) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    if (failures.size > 2000) {
      for (const [failureKey, failure] of failures) {
        if (failure.resetAt <= now) failures.delete(failureKey);
      }
      if (failures.size > 2000) failures.delete(failures.keys().next().value as string);
    }
    const record = failures.get(key);
    if (record && record.resetAt > now && record.count >= MAX_FAILURES) {
      return res.status(429).type('html').send(loginPage('Слишком много попыток. Повторите через 15 минут.'));
    }

    const suppliedPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!safeEqual(suppliedPassword, password)) {
      failures.set(key, record && record.resetAt > now
        ? { count: record.count + 1, resetAt: record.resetAt }
        : { count: 1, resetAt: now + FAILURE_WINDOW_MS });
      return res.status(401).type('html').send(loginPage('Неверный пароль.'));
    }

    failures.delete(key);
    const expiresAt = String(now + SESSION_TTL_MS);
    const token = `${expiresAt}.${signature(expiresAt, password)}`;
    const secure = isHttps(req) ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`);
    return res.redirect('/bitrix/tickets/stocktake-history/');
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (hasValidSession(req, password)) return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/tickets/')) {
      return res.status(401).json({ error: 'authentication_required' });
    }
    return res.redirect('/login');
  });
}
