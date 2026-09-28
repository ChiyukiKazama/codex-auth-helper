# 🔐 Codex 认证助手 (Codex Auth Helper)

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](./extension/manifest.json)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-orange.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

**Codex 认证助手** 是用于导出 Codex `auth.json` 的 Chrome 扩展程序。

本插件通过 Codex OAuth Authorization Code + PKCE 登录流程获取 `id_token`、`access_token` 和 `refresh_token`，并按 Codex 的字段格式生成 `auth.json`。另外会尝试用 `id_token` 向官方认证站点交换 `OPENAI_API_KEY`；该交换失败时，此字段为 `null`，OAuth 令牌仍可导出。ChatGPT 网页会话令牌不会被冒充为 OAuth 令牌。

---

## 🌟 核心特性

- 🔐 **官方 OAuth + PKCE**：通过授权码和 PKCE 校验交换真实 OAuth 令牌，不合成或伪造 JWT。
- 🔒 **令牌交换由浏览器直连官方认证站点**：扩展仅在用户主动登录后向 `auth.openai.com` 交换授权码和可选 API key；不会把凭证发送到本项目服务器或第三方服务。
- 💾 **本地生成文件**：令牌只用于当前导出流程，配置通过浏览器下载保存到本机。

---

## 🚀 极速上手

### 1. 开发者模式安装 (本地加载)
1. 下载或克隆本仓库到您的本地电脑。
2. 打开 Chrome 浏览器，在地址栏输入 `chrome://extensions/` 并回车。
3. 在右上角开启 **"开发者模式" (Developer mode)** 开关。
4. 点击左上角的 **"加载已解压的扩展程序" (Load unpacked)**。
5. 选择本仓库中的 `extension` 文件夹（即包含 `manifest.json` 的目录）。
6. 安装完成后，在浏览器工具栏的“拼图”图标中找到 **Codex 认证助手** 并将其固定。

### 2. 导出 `auth.json`
1. 点击扩展中的 **开始官方登录并生成 auth.json**，并在打开的页面完成官方登录和页面要求的验证。
2. 授权完成后，浏览器会跳转到本机回调地址。因为扩展不能监听本机端口，页面可能显示连接失败；复制地址栏中的完整回调链接。
3. 重新打开扩展，将回调链接粘贴到输入框并完成验证，扩展会交换授权码并下载 `auth.json`。

### 3. 在另一台电脑使用

1. 将导出的 `auth.json` 安全地复制到目标电脑的 `%USERPROFILE%\.codex\auth.json`（Windows）或 `~/.codex/auth.json`（macOS/Linux）。覆盖前先备份目标电脑原有文件。
2. 关闭并重新启动 Codex，使其重新读取登录文件。
3. 如果请求发往 `api.omni.undertides.cn` 等自定义地址，请同时检查目标电脑的 Codex 提供商配置。`auth.json` 不包含请求地址，替换它不会把自定义网关改成 OpenAI 官方接口。

### 报错排查

- `Invalid 'refresh_token': empty string`：旧文件的 `tokens.refresh_token` 为空。重新从扩展完成 OAuth 登录与导出；不要把其他令牌复制到该字段。
- `401 INVALID_API_KEY`，且错误地址是自定义网关：已进入模型请求阶段。请检查目标电脑配置的网关地址、网关所要求的认证方式以及对应凭证。Codex 的 `auth_mode: "chatgpt"` 使用 OAuth `access_token`；自定义网关可能不接受它。`OPENAI_API_KEY` 是官方令牌交换产生的可选字段，不能保证能用于第三方网关。
- 排查时只分享 `auth_mode`、四个令牌字段是否为非空字符串、错误地址以及已遮盖密钥的提供商配置；不要分享 `auth.json` 的实际令牌或完整回调链接。

## 🔒 安全与隐私承诺

> [!IMPORTANT]
> `auth.json` 含有可持续使用的 refresh token，应像密码一样保管，不要分享或上传。

- **无第三方中转**：授权码交换直接连接 `auth.openai.com`，不经过本项目服务器。
- **最小化权限声明**：声明 `downloads`、`storage`（短期保存 PKCE 校验值）以及官方认证站点的连接权限。
- **彻底的代码闭环**：您可以随时通过浏览器开发者工具 (F12) 检查 `background.js` 和 `popup.js`。没有引入任何外部不可控 CDN 第三方库，所有静态资源均本地打包。

---

## 📜 许可证

本项目基于 [MIT License](LICENSE) 开源，允许任何个人或团队进行自由修改与二次分发，但请务必保留原作者署名及开源协议声明。
