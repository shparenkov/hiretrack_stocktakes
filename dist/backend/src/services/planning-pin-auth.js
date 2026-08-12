"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installPlanningPinAuth = installPlanningPinAuth;
const crypto_1 = __importDefault(require("crypto"));
// Second, page-scoped access gate on top of the main password/session (see
// password-auth.ts) - only covers /planning and /api/planning. Mirrors
// crew-bookings-pin-auth.ts's own reasoning: this page reads live production
// data (and the shortage tab calls the rate-limited api_v2 gateway), so it
// gets its own short PIN as a deliberate extra step, same pattern as Crew
// Bookings.
const COOKIE_NAME = 'planning_pin';
const DEFAULT_SESSION_DAYS = 30;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const PIN_PATH = '/planning/pin';
function sessionTtlMs() {
    const configuredDays = Number(process.env.PLANNING_PIN_SESSION_DAYS || DEFAULT_SESSION_DAYS);
    const days = Number.isFinite(configuredDays) ? Math.min(365, Math.max(1, configuredDays)) : DEFAULT_SESSION_DAYS;
    return days * 24 * 60 * 60 * 1000;
}
function readPin() {
    return (process.env.PLANNING_PIN || '4471').trim();
}
function signature(payload, pin) {
    return crypto_1.default.createHmac('sha256', pin).update(payload).digest('base64url');
}
function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto_1.default.timingSafeEqual(leftBuffer, rightBuffer);
}
function parseCookies(req) {
    return (req.headers.cookie || '').split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator < 0)
            return cookies;
        const name = part.slice(0, separator).trim();
        if (!name)
            return cookies;
        try {
            cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
        }
        catch {
            // Ignore malformed cookie values instead of failing the request.
        }
        return cookies;
    }, {});
}
function hasValidPinSession(req, pin) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token)
        return false;
    const separator = token.indexOf('.');
    if (separator < 0)
        return false;
    const expiresAt = token.slice(0, separator);
    const suppliedSignature = token.slice(separator + 1);
    if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Date.now())
        return false;
    return safeEqual(suppliedSignature, signature(expiresAt, pin));
}
function isHttps(req) {
    return req.secure || req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
}
function pinPage(errorMessage = '') {
    const error = errorMessage ? `<p class="error">${errorMessage}</p>` : '';
    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Планирование · PIN</title>
  <style>
    :root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #e9edf1; color: #17212b; }
    main { width: min(360px, calc(100vw - 32px)); background: #fff; border: 1px solid #aeb9c4; }
    header { padding: 20px 24px 16px; background: #2d5f8f; color: #fff; }
    h1 { margin: 0; font-size: 20px; font-weight: 600; }
    header p { margin: 6px 0 0; color: #dcecf5; font: 13px Arial, sans-serif; }
    form { padding: 22px 24px; }
    label { display: block; margin-bottom: 8px; font: 600 12px Arial, sans-serif; text-transform: uppercase; letter-spacing: .06em; }
    input { width: 100%; height: 46px; padding: 0 11px; border: 1px solid #8997a5; font: 22px Arial, sans-serif; letter-spacing: .3em; text-align: center; }
    input:focus { outline: 2px solid #8ac0d6; outline-offset: 1px; }
    button { width: 100%; height: 42px; margin-top: 14px; border: 0; background: #2d5f8f; color: #fff; font: 600 14px Arial, sans-serif; cursor: pointer; }
    button:hover { background: #234a70; }
    .error { margin: 0 0 14px; padding: 9px 10px; background: #fae7e4; color: #932b20; font: 13px Arial, sans-serif; }
  </style>
</head>
<body>
  <main>
    <header><h1>Планирование</h1><p>Введите PIN-код доступа</p></header>
    <form method="post" action="${PIN_PATH}">
      ${error}
      <label for="pin">PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" required autofocus>
      <button type="submit">Войти</button>
    </form>
  </main>
</body>
</html>`;
}
function installPlanningPinAuth(app) {
    const pin = readPin();
    const sessionDurationMs = sessionTtlMs();
    const failures = new Map();
    app.get(PIN_PATH, (req, res) => {
        if (hasValidPinSession(req, pin))
            return res.redirect('/planning/');
        return res.type('html').send(pinPage());
    });
    app.post(PIN_PATH, (req, res) => {
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        if (failures.size > 2000) {
            for (const [failureKey, failure] of failures) {
                if (failure.resetAt <= now)
                    failures.delete(failureKey);
            }
            if (failures.size > 2000)
                failures.delete(failures.keys().next().value);
        }
        const record = failures.get(key);
        if (record && record.resetAt > now && record.count >= MAX_FAILURES) {
            return res.status(429).type('html').send(pinPage('Слишком много попыток. Повторите через 15 минут.'));
        }
        const suppliedPin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
        if (!safeEqual(suppliedPin, pin)) {
            failures.set(key, record && record.resetAt > now
                ? { count: record.count + 1, resetAt: record.resetAt }
                : { count: 1, resetAt: now + FAILURE_WINDOW_MS });
            return res.status(401).type('html').send(pinPage('Неверный PIN.'));
        }
        failures.delete(key);
        const expiresAt = String(now + sessionDurationMs);
        const token = `${expiresAt}.${signature(expiresAt, pin)}`;
        const secure = isHttps(req) ? '; Secure' : '';
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${sessionDurationMs / 1000}; HttpOnly; SameSite=Lax${secure}`);
        return res.redirect('/planning/');
    });
    app.use((req, res, next) => {
        const gated = req.path.startsWith('/planning') || req.path.startsWith('/api/planning');
        if (!gated || req.path === PIN_PATH)
            return next();
        if (hasValidPinSession(req, pin))
            return next();
        if (req.path.startsWith('/api/planning')) {
            return res.status(401).json({ error: 'pin_required' });
        }
        return res.redirect(PIN_PATH);
    });
}
