// popup.js — Codex 登陆助手核心交互逻辑
// 令牌仅在官方 OAuth 交换与本地文件下载流程中处理

document.addEventListener('DOMContentLoaded', () => {
  showState('unauthorized');
  initOAuthPending();
  bindEvents();
});

/**
 * 切换界面显示状态
 * @param {'loading'|'unauthorized'|'authorized'} state 
 */
function showState(state) {
  const loadingEl = document.getElementById('state-loading');
  const unauthorizedEl = document.getElementById('state-unauthorized');
  const authorizedEl = document.getElementById('state-authorized');

  loadingEl.classList.remove('active');
  unauthorizedEl.classList.remove('active');
  authorizedEl.classList.remove('active');

  if (state === 'loading') {
    loadingEl.classList.add('active');
  } else if (state === 'unauthorized') {
    unauthorizedEl.classList.add('active');
  } else if (state === 'authorized') {
    authorizedEl.classList.add('active');
  }
}

/**
 * 绑定所有 DOM 按钮事件
 */
function bindEvents() {
  document.getElementById('btn-oauth-start-unauthorized').addEventListener('click', startOAuthLogin);
  document.getElementById('btn-oauth-complete').addEventListener('click', completeOAuthLogin);
}

function initOAuthPending() {
  chrome.runtime.sendMessage({ action: 'oauth_pending' }, (response) => {
    if (!chrome.runtime.lastError && response?.success && response.pending) {
      document.getElementById('oauth-callback-panel').hidden = false;
    }
  });
}

function startOAuthLogin() {
  chrome.runtime.sendMessage({ action: 'oauth_start' }, (response) => {
    if (chrome.runtime.lastError || !response?.success) {
      showToast(response?.error || '❌ 无法启动官方 OAuth 登录');
      return;
    }
    chrome.tabs.create({ url: response.authUrl });
    window.close();
  });
}

function completeOAuthLogin() {
  const callbackUrl = document.getElementById('oauth-callback-url').value.trim();
  if (!callbackUrl) {
    showToast('请先粘贴浏览器回调地址');
    return;
  }

  const button = document.getElementById('btn-oauth-complete');
  button.disabled = true;
  button.textContent = '正在安全交换令牌...';
  chrome.runtime.sendMessage({ action: 'oauth_complete', callbackUrl }, (response) => {
    button.disabled = false;
    button.textContent = '验证回调并导出 auth.json';
    if (chrome.runtime.lastError || !response?.success) {
      showToast(response?.error || '❌ OAuth 登录失败');
      return;
    }

    try {
      const authJsonString = generateCodexAuthJson(response.data);
      chrome.runtime.sendMessage({ action: 'download_auth_json', jsonContent: authJsonString }, (downloadResponse) => {
        if (chrome.runtime.lastError || !downloadResponse?.success) {
          showToast('❌ 下载失败，请重新尝试');
          return;
        }
        document.getElementById('oauth-callback-panel').hidden = true;
        document.getElementById('oauth-callback-url').value = '';
        showToast('🎉 auth.json 已开始下载');
      });
    } catch (error) {
      showToast(error.message || '❌ OAuth 令牌格式无效');
    }
  });
}

/**
 * 将 OAuth 登录返回的真实令牌转化为 Codex auth.json。
 */
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

/**
 * 一键复制公共方法
 */
function copyToClipboard(text, successMsg) {
  navigator.clipboard.writeText(text)
    .then(() => {
      showToast(successMsg);
    })
    .catch(err => {
      console.error('复制失败:', err);
      showToast('❌ 复制失败，请手动选取');
    });
}

/**
 * 弹出精致轻巧的 Toast 反馈
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  
  toastMsg.textContent = message;
  toast.classList.add('show');
  
  // 2秒后淡出
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}
