'use strict';
/**
 * Inicio de sesión con Microsoft (la cuenta de Minecraft Java):
 *   ventana oficial de Microsoft (OAuth 2.0) → Xbox Live → XSTS → Minecraft → perfil.
 *
 * Dos formas de entrar:
 *  - «oficial» (la de serie: launcher.config.json sin microsoftClientId): con el ID del launcher oficial de Minecraft,
 *    como hacen casi todos los launchers no oficiales. No hay que registrar nada ni esperar a Mojang.
 *    Lo malo: la ventana de Microsoft dice «Minecraft» en vez de «Zeroria Launcher», y si Microsoft algún día lo
 *    corta habría que pasar a la otra forma.
 *  - «propia»: con tu app de Azure aprobada por Mojang (pon su ID en microsoftClientId).
 */
const { BrowserWindow, session } = require('electron');
const crypto = require('crypto');
const { CONFIG, fetchT } = require('./util');
const accounts = require('./accounts');

const FLOWS = {
  oficial: {
    clientId: '00000000402b5328',
    authorize: 'https://login.live.com/oauth20_authorize.srf',
    token: 'https://login.live.com/oauth20_token.srf',
    redirect: 'https://login.live.com/oauth20_desktop.srf',
    scope: 'service::user.auth.xboxlive.com::MBI_SSL',
    ticket: (t) => t,
    pkce: false,
  },
  propia: {
    clientId: null,
    authorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    redirect: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
    scope: 'XboxLive.signin offline_access',
    ticket: (t) => `d=${t}`,
    pkce: true,
  },
};

class AuthError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function ownId() {
  const id = CONFIG.microsoftClientId;
  return id && !String(id).startsWith('PON_AQUI') ? id : null;
}

function flow(name) {
  const n = name || (ownId() ? 'propia' : 'oficial');
  const f = { ...FLOWS[n], name: n };
  if (n === 'propia') f.clientId = ownId();
  return f;
}

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/** Abre la ventana de Microsoft y devuelve el «code» de autorización. */
function askCode(parent, f) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(12));
  const q = { client_id: f.clientId, response_type: 'code', redirect_uri: f.redirect, scope: f.scope, prompt: 'select_account', state };
  if (f.pkce) Object.assign(q, { code_challenge: challenge, code_challenge_method: 'S256' });
  const url = `${f.authorize}?` + new URLSearchParams(q);
  return new Promise((resolve, reject) => {
    // Sesión propia (sin galletas de antes): así se puede elegir otra cuenta
    const part = `ms-login-${Date.now()}`;
    const win = new BrowserWindow({
      width: 520, height: 680, parent, modal: !!parent, show: false, autoHideMenuBar: true, title: 'Iniciar sesión con Microsoft',
      backgroundColor: '#1b1410', webPreferences: { partition: part, sandbox: true, contextIsolation: true },
    });
    let done = false;
    const finish = (err, value) => {
      if (done) return; done = true;
      if (!win.isDestroyed()) win.close();
      session.fromPartition(part).clearStorageData().catch(() => {});
      err ? reject(err) : resolve(value);
    };
    const check = (target) => {
      if (!target.startsWith(f.redirect)) return false;
      const p = new URL(target).searchParams;
      if (p.get('error')) finish(new AuthError(p.get('error_description') || p.get('error'), 'cancelado'));
      else if (p.get('state') && p.get('state') !== state) finish(new AuthError('Respuesta de Microsoft no válida.', 'estado'));
      else if (!p.get('code')) return false;
      else finish(null, { code: p.get('code'), verifier });
      return true;
    };
    win.webContents.on('will-redirect', (e, target) => { if (check(target)) e.preventDefault(); });
    win.webContents.on('will-navigate', (e, target) => { if (check(target)) e.preventDefault(); });
    win.webContents.on('did-navigate', (_e, target) => check(target));
    win.on('closed', () => finish(new AuthError('Has cerrado la ventana de inicio de sesión.', 'cancelado')));
    win.once('ready-to-show', () => win.show());
    win.loadURL(url);
  });
}

async function postForm(url, data) {
  const r = await fetchT(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError(j.error_description || `Microsoft respondió ${r.status}`, 'microsoft');
  return j;
}

async function postJson(url, body, headers = {}) {
  const r = await fetchT(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* no es JSON */ }
  return { ok: r.ok, status: r.status, json: j };
}

const XERR = {
  2148916233: 'Esta cuenta de Microsoft no tiene perfil de Xbox. Entra una vez en xbox.com para crearlo.',
  2148916235: 'Xbox Live no está disponible en tu país.',
  2148916236: 'La cuenta necesita verificación de adulto (Corea del Sur).',
  2148916237: 'La cuenta necesita verificación de adulto (Corea del Sur).',
  2148916238: 'Es una cuenta de menor: un adulto tiene que añadirla a una familia de Microsoft.',
};

/** De un token de Microsoft a uno de Minecraft (y su perfil). */
async function minecraftFromMs(msAccess, f) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: f.ticket(msAccess) },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  if (!xbl.ok) throw new AuthError('No se pudo entrar en Xbox Live.', 'xbox');
  const uhs = xbl.json.DisplayClaims?.xui?.[0]?.uhs;
  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.json.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  if (!xsts.ok) throw new AuthError(XERR[xsts.json.XErr] || 'Xbox Live rechazó la cuenta.', 'xsts');
  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${uhs};${xsts.json.Token}`,
  });
  if (!mc.ok) {
    if (mc.status === 403 && f.name === 'propia') {
      throw new AuthError('Mojang todavía no ha aprobado tu app de Azure. Quita microsoftClientId de launcher.config.json para usar el inicio de sesión normal.', 'mojang');
    }
    throw new AuthError(`Minecraft rechazó el inicio de sesión (${mc.status}). Prueba más tarde.`, 'minecraft');
  }
  const token = mc.json.access_token;
  const prof = await fetchT('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${token}` } });
  if (prof.status === 404) throw new AuthError('Esta cuenta no tiene Minecraft: Java Edition.', 'sin-juego');
  if (!prof.ok) throw new AuthError(`No se pudo leer el perfil (${prof.status}).`, 'perfil');
  const p = await prof.json();
  const skin = (p.skins || []).find((s) => s.state === 'ACTIVE');
  return {
    uuid: p.id, nombre: p.name, skin: skin ? { url: skin.url, modelo: skin.variant === 'SLIM' ? 'slim' : 'classic' } : null,
    mcToken: token, mcExpira: Date.now() + (mc.json.expires_in || 86400) * 1000,
  };
}

/** Añadir cuenta: ventana de Microsoft y toda la cadena. */
async function login(parent) {
  const f = flow();
  const { code, verifier } = await askCode(parent, f);
  const data = { client_id: f.clientId, grant_type: 'authorization_code', code, redirect_uri: f.redirect, scope: f.scope };
  if (f.pkce) data.code_verifier = verifier;
  const ms = await postForm(f.token, data);
  const acc = await minecraftFromMs(ms.access_token, f);
  await accounts.upsert({ ...acc, msRefresh: ms.refresh_token, flujo: f.name });
  return accounts.list();
}

/** La cuenta activa con un token de Minecraft válido (lo renueva si caduca en menos de 10 minutos). */
async function ensureActive() {
  const acc = accounts.active();
  if (!acc) throw new AuthError('Inicia sesión con tu cuenta de Microsoft.', 'sin-cuenta');
  if (acc.mcToken && acc.mcExpira - Date.now() > 10 * 60 * 1000) return acc;
  const f = flow(acc.flujo === 'propia' ? (ownId() ? 'propia' : null) : 'oficial');
  if (!acc.msRefresh || f.name !== (acc.flujo || 'propia')) throw new AuthError('Vuelve a iniciar sesión.', 'caducada');
  let ms;
  try {
    ms = await postForm(f.token, { client_id: f.clientId, grant_type: 'refresh_token', refresh_token: acc.msRefresh, scope: f.scope, redirect_uri: f.redirect });
  } catch {
    throw new AuthError('La sesión ha caducado: vuelve a iniciar sesión.', 'caducada');
  }
  const fresh = await minecraftFromMs(ms.access_token, f);
  const merged = { ...acc, ...fresh, msRefresh: ms.refresh_token || acc.msRefresh, flujo: f.name };
  await accounts.upsert(merged);
  return merged;
}

module.exports = { login, ensureActive, AuthError };
