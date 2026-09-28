// background.js — 官方 OAuth + PKCE 授权码交换与文件下载

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download_auth_json') {
    // 在 Service Worker 进程中执行下载，完全独立于 Popup 生命周期
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(message.jsonContent);
    chrome.downloads.download({
      url: dataUrl,
      filename: 'auth.json',
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('下载异常:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, downloadId: downloadId });
      }
    });
    return true; // 保持异步通信通道开启
  }

  if (message.action === 'oauth_start') {
    startCodexOAuth()
      .then(authUrl => sendResponse({ success: true, authUrl }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'oauth_pending') {
    chrome.storage.session.get('codexOAuthPending', ({ codexOAuthPending }) => {
      sendResponse({ success: true, pending: Boolean(codexOAuthPending) });
    });
    return true;
  }

  if (message.action === 'oauth_complete') {
    completeCodexOAuth(message.callbackUrl)
      .then(tokens => sendResponse({ success: true, data: tokens }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_OAUTH_REDIRECT_URI = 'http://127.0.0.1:1457/auth/callback';

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
    throw new Error('请粘贴浏览器地址栏中的完整回调链接。');
  }

  if (`${callback.origin}${callback.pathname}` !== CODEX_OAUTH_REDIRECT_URI) {
    throw new Error('回调链接地址不匹配，请粘贴 127.0.0.1:1457/auth/callback 页面地址。');
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
