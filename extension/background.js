// background.js — 官方 OAuth + PKCE 授权码交换与文件下载

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'oauth_start') {
    openCodexOAuth()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'oauth_status') {
    getOAuthStatus()
      .then(status => sendResponse({ success: true, status }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_OAUTH_REDIRECT_URI = 'http://127.0.0.1:1457/auth/callback';
const completingStates = new Set();
let startingOAuth = false;

// Capture the main-frame URL before localhost connection failure. Listeners
// are registered at worker startup so Chrome can wake a suspended worker.
const callbackFilter = { url: [{ hostEquals: '127.0.0.1', pathEquals: '/auth/callback' }] };
for (const event of [chrome.webNavigation.onBeforeNavigate, chrome.webNavigation.onCommitted, chrome.webNavigation.onErrorOccurred]) {
  event.addListener(details => handleOAuthNavigation(details).catch(() => {}), callbackFilter);
}

chrome.downloads.onChanged.addListener(delta => handleDownloadChange(delta).catch(() => {}));

async function setOAuthStatus(status) {
  await chrome.storage.session.set({ codexOAuthStatus: status });
}

async function getOAuthStatus() {
  const stored = await chrome.storage.session.get(['codexOAuthStatus', 'codexOAuthPending']);
  const pending = stored.codexOAuthPending;
  if (pending && (Date.now() - pending.createdAt > 10 * 60 * 1000 ||
      (pending.phase === 'exchanging' && !completingStates.has(pending.state)))) {
    await chrome.storage.session.remove('codexOAuthPending');
    await setOAuthStatus({ phase: 'failed', message: '登录请求已过期或中断，请重新开始登录。' });
    return { phase: 'failed', message: '登录请求已过期或中断，请重新开始登录。' };
  }
  return stored.codexOAuthStatus || { phase: 'idle' };
}

async function openCodexOAuth() {
  if (startingOAuth || completingStates.size) throw new Error('登录正在处理中，请稍候。');
  startingOAuth = true;
  try {
    const authUrl = await startCodexOAuth();
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    const { codexOAuthPending: pending } = await chrome.storage.session.get('codexOAuthPending');
    await chrome.storage.session.set({ codexOAuthPending: { ...pending, tabId: tab.id } });
    await setOAuthStatus({ phase: 'waiting', message: '请在打开的页面完成登录，完成后将自动下载。' });
    await chrome.tabs.update(tab.id, { url: authUrl });
  } catch (error) {
    await chrome.storage.session.remove('codexOAuthPending');
    await setOAuthStatus({ phase: 'failed', message: '无法打开登录页面，请重新尝试。' });
    throw error;
  } finally { startingOAuth = false; }
}

async function handleOAuthNavigation(details) {
  if (details.frameId !== 0) return;
  let callback;
  try { callback = new URL(details.url); } catch { return; }
  if (`${callback.origin}${callback.pathname}` !== CODEX_OAUTH_REDIRECT_URI) return;
  const { codexOAuthPending: pending } = await chrome.storage.session.get('codexOAuthPending');
  if (!pending || pending.tabId !== details.tabId || callback.searchParams.get('state') !== pending.state ||
      pending.phase === 'exchanging' || completingStates.has(pending.state)) return;
  completingStates.add(pending.state);
  try {
    await chrome.storage.session.set({ codexOAuthPending: { ...pending, phase: 'exchanging' } });
    await setOAuthStatus({ phase: 'exchanging', message: '已收到登录回调，正在生成 auth.json…' });
    // Replace the callback URL with a local status page, also removing the
    // authorization code from the address bar. A closed tab must not abort export.
    await chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL('popup/popup.html') }).catch(() => {});
    const tokens = await completeCodexOAuth(details.url);
    await downloadAuthJson(generateCodexAuthJson(tokens));
  } catch {
    await chrome.storage.session.remove('codexOAuthPending');
    // Never persist server error text: it could contain a code or token.
    await setOAuthStatus({ phase: 'failed', message: '登录或下载未完成，请重新登录。' });
  } finally { completingStates.delete(pending.state); }
}

async function downloadAuthJson(jsonContent) {
  const downloadId = await chrome.downloads.download({
    url: 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonContent),
    filename: 'auth.json',
    saveAs: false,
    conflictAction: 'uniquify'
  });
  await setOAuthStatus({ phase: 'downloading', downloadId, message: 'auth.json 已开始自动下载。' });
  // A small data URL can complete before its id is saved. Query once to catch
  // that race; subsequent transitions are handled by downloads.onChanged.
  await handleDownloadChange({ id: downloadId });
  return downloadId;
}

async function handleDownloadChange(delta) {
  const { codexOAuthStatus: status } = await chrome.storage.session.get('codexOAuthStatus');
  if (!status || status.phase !== 'downloading' || status.downloadId !== delta.id) return;
  const [download] = await chrome.downloads.search({ id: delta.id });
  if (download?.state === 'complete') {
    const filename = download.filename.split(/[\\/]/).pop();
    await setOAuthStatus({ phase: 'complete', message: `已自动保存 ${filename}，请在浏览器下载列表中查看。` });
  } else if (download?.state === 'interrupted') {
    await setOAuthStatus({ phase: 'failed', message: '文件下载被中断，请重新登录并导出。' });
  }
}

async function startCodexOAuth() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = toBase64Url(verifierBytes);
  const state = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challengeDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = toBase64Url(new Uint8Array(challengeDigest));

  await chrome.storage.session.set({
    codexOAuthPending: { codeVerifier, state, createdAt: Date.now() }
  });

  const authUrl = new URL('https://auth.openai.com/oauth/authorize');
  const params = {
    response_type: 'code',
    client_id: CODEX_OAUTH_CLIENT_ID,
    redirect_uri: CODEX_OAUTH_REDIRECT_URI,
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
    state
  };
  for (const [key, value] of Object.entries(params)) authUrl.searchParams.set(key, value);
  return authUrl.toString();
}

async function completeCodexOAuth(callbackUrl) {
  const pending = (await chrome.storage.session.get('codexOAuthPending')).codexOAuthPending;
  if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
    await chrome.storage.session.remove('codexOAuthPending');
    throw new Error('登录请求已过期，请重新开始官方登录。');
  }

  let callback;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new Error('OAuth 回调链接无效。');
  }

  if (`${callback.origin}${callback.pathname}` !== CODEX_OAUTH_REDIRECT_URI) {
    throw new Error('OAuth 回调链接地址不匹配。');
  }
  if (callback.searchParams.get('state') !== pending.state) {
    throw new Error('OAuth state 校验失败。请使用本次登录产生的回调链接重新尝试。');
  }
  if (callback.searchParams.has('error')) {
    await chrome.storage.session.remove('codexOAuthPending');
    throw new Error(`官方登录未完成：${callback.searchParams.get('error_description') || callback.searchParams.get('error')}`);
  }

  const code = callback.searchParams.get('code');
  if (!code) throw new Error('回调链接中没有 authorization code。');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CODEX_OAUTH_REDIRECT_URI,
    client_id: CODEX_OAUTH_CLIENT_ID,
    code_verifier: pending.codeVerifier
  });
  const response = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || `OAuth 令牌交换失败（HTTP ${response.status}）。`);
  }

  if (![data.id_token, data.access_token, data.refresh_token].every(value => typeof value === 'string' && value.trim())) {
    await chrome.storage.session.remove('codexOAuthPending');
    throw new Error('官方 OAuth 响应缺少 id_token、access_token 或 refresh_token。');
  }
  await chrome.storage.session.remove('codexOAuthPending');

  const idClaims = decodeJwtPayload(data.id_token);
  const accountId = idClaims['https://api.openai.com/auth']?.chatgpt_account_id;
  const apiKey = await obtainApiKey(data.id_token);
  return {
    id_token: data.id_token,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    account_id: typeof accountId === 'string' && accountId ? accountId : null,
    api_key: apiKey
  };
}

// Codex 官方登录会额外尝试用 id_token 换取 API key；失败时仍保存 OAuth 令牌。
async function obtainApiKey(idToken) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: CODEX_OAUTH_CLIENT_ID,
    requested_token: 'openai-api-key',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token'
  });

  try {
    const response = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.access_token === 'string' && data.access_token.trim()
      ? data.access_token
      : null;
  } catch {
    return null;
  }
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !part)) throw new Error('OAuth id_token 格式无效。');
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, char => char.charCodeAt(0))));
}

function generateCodexAuthJson(oauthTokens) {
  const refreshToken = oauthTokens?.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken.trim() === '') {
    throw new Error('官方 OAuth 登录结果缺少 refresh_token，请重新登录后再导出。');
  }

  const accessToken = oauthTokens?.access_token;
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    throw new Error('无法导出：OAuth 登录结果缺少 access_token。');
  }

  const idToken = oauthTokens?.id_token;
  if (typeof idToken !== 'string' || idToken.trim() === '') {
    throw new Error('无法导出：OAuth 登录结果缺少 id_token。');
  }

  const accountId = oauthTokens.account_id;
  const apiKey = oauthTokens.api_key;

  const authConfig = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: typeof apiKey === 'string' && apiKey.trim() ? apiKey : null,
    tokens: {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: typeof accountId === 'string' && accountId ? accountId : null
    },
    last_refresh: new Date().toISOString()
  };

  return JSON.stringify(authConfig, null, 2);
}
