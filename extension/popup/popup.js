// Popup and callback status page. OAuth and download run entirely in the worker.
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('state-loading').classList.remove('active');
  document.getElementById('state-unauthorized').classList.add('active');
  document.getElementById('btn-oauth-start-unauthorized').addEventListener('click', startOAuthLogin);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.codexOAuthStatus) renderStatus(changes.codexOAuthStatus.newValue);
  });
  chrome.runtime.sendMessage({ action: 'oauth_status' }, response => {
    if (chrome.runtime.lastError || !response?.success) {
      renderStatus({ phase: 'failed', message: '无法读取登录状态，请重新打开扩展。' });
      return;
    }
    renderStatus(response.status);
  });
});

function renderStatus(status = { phase: 'idle' }) {
  const panel = document.getElementById('oauth-status-panel');
  const button = document.getElementById('btn-oauth-start-unauthorized');
  panel.hidden = status.phase === 'idle';
  document.getElementById('oauth-status-message').textContent = status.message || '';
  button.disabled = ['exchanging', 'downloading'].includes(status.phase);
  button.textContent = status.phase === 'idle' ? '开始官方登录并自动下载' :
    button.disabled ? '正在自动处理…' : '重新开始官方登录';
}

function startOAuthLogin() {
  const button = document.getElementById('btn-oauth-start-unauthorized');
  button.disabled = true;
  chrome.runtime.sendMessage({ action: 'oauth_start' }, response => {
    if (chrome.runtime.lastError || !response?.success) {
      renderStatus({ phase: 'failed', message: response?.error || '无法启动官方登录，请重新尝试。' });
      return;
    }
    window.close();
  });
}
