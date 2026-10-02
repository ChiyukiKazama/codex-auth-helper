# 🔐 Codex 认证助手 (Codex Auth Helper)

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](./extension/manifest.json)
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
1. 更新后在 `chrome://extensions/` 重新加载扩展，确认版本为 **1.2.0**，允许新增的导航监听权限。
2. 点击 **开始官方登录并自动下载**，在打开的页面完成登录和账户验证。
3. 授权跳转到回调地址时，扩展自动校验本次登录的标签页与 `state`，交换令牌并开始下载 `auth.json`。无需复制回调 URL、重新打开弹窗或点击下载；后台流程可在弹窗关闭后继续运行。
4. 登录标签页会显示处理结果；浏览器下载列表中可找到文件。重复下载可能命名为 `auth (1).json` 等，结果页会显示实际文件名，请使用本次下载文件。浏览器的下载限制或管理员策略仍可能要求用户确认。

### 3. 在另一台电脑使用

1. 将导出的 `auth.json` 安全地复制到目标电脑的 `%USERPROFILE%\.codex\auth.json`（Windows）或 `~/.codex/auth.json`（macOS/Linux）。覆盖前先备份目标电脑原有文件。
2. 关闭并重新启动 Codex，使其重新读取登录文件。
3. 如果请求发往 `api.omni.undertides.cn` 等自定义地址，请同时检查目标电脑的 Codex 提供商配置。`auth.json` 不包含请求地址，替换它不会把自定义网关改成 OpenAI 官方接口。

### 报错排查

- `Invalid 'refresh_token': empty string`：旧文件的 `tokens.refresh_token` 为空。重新从扩展完成 OAuth 登录与导出；不要把其他令牌复制到该字段。
- `401 INVALID_API_KEY`，且错误地址是自定义网关：已进入模型请求阶段。请检查目标电脑配置的网关地址、网关所要求的认证方式以及对应凭证。Codex 的 `auth_mode: "chatgpt"` 使用 OAuth `access_token`；自定义网关可能不接受它。`OPENAI_API_KEY` 是官方令牌交换产生的可选字段，不能保证能用于第三方网关。
- 排查时只分享 `auth_mode`、四个令牌字段是否为非空字符串、错误地址以及已遮盖密钥的提供商配置；不要分享 `auth.json` 的实际令牌或完整回调链接。

### 持续出现 401：在报错电脑定位实际配置

错误中的 `url` 是本次请求实际访问的地址。即使提供商名称显示为 OpenAI，`openai_base_url`、环境变量、配置档或启动程序仍可能覆盖地址。`api.omni.undertides.cn` 不是 OpenAI 官方域名，导出的 OpenAI OAuth 凭证不能自动变成这个网关的密钥。

把 `scripts` 文件夹复制到报错的 Windows 电脑，在该文件夹打开 PowerShell，先运行离线诊断：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Diagnose-CodexAuth.ps1
```

脚本仅读取文件和环境变量，不联网、不刷新令牌、不修改配置。输出隐藏令牌、账户标识以及 URL 中的密码、路径和查询参数，检查令牌完整性、过期状态、旧版占位符和配置中的地址线索。可直接分享输出报告。配置检查是行扫描，可能包含未启用的配置项；它不读取正在运行的应用内存或系统凭据库，也不能证明 JWT 签名有效。

如果要确认安装的文件与本次下载一致，附加 `-ExportedAuthPath 'C:\实际下载目录\auth (1).json'`。如果设置了自定义 `CODEX_HOME`，脚本会使用它；也可通过 `-CodexDirectory 'C:\实际配置目录'` 指定。

已有官方 Codex CLI 时，可用同一份 `auth.json` 临时指定官方地址启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-CodexOfficial.ps1
```

该启动脚本仅对当前 CLI 进程指定 `https://chatgpt.com/backend-api/codex` 和文件凭据存储，并清除该进程继承的 API key、access token 与基础地址覆盖变量；退出时恢复环境。它不改写 `config.toml`，不影响已经打开的桌面客户端。Codex 在正常使用过程中可能刷新并更新当前 `auth.json`，请以更新后的文件为准。脚本先确认 CLI 选择 ChatGPT 登录，再启动交互界面；发送一条短消息后才算进行了实际请求验证。管理员强制的配置仍然有效。

如果临时启动可以正常使用，后续应修正原客户端的路由覆盖或凭据存储设置。如果官方地址仍返回 401，保留新的完整错误（含 URL）和离线报告继续排查令牌。仅运行 `-StatusOnly` 只检查本地认证模式，不能证明令牌已被服务端接受。

### 本地回归检查

```powershell
node --test tests/auth.test.cjs tests/diagnose.test.cjs
```

这些检查使用虚构令牌，验证字段映射、失败处理、诊断脱敏与临时启动行为；不代表真实账户登录或另一台电脑的请求已通过。

## 🔒 安全与隐私承诺

> [!IMPORTANT]
> `auth.json` 含有可持续使用的 refresh token，应像密码一样保管，不要分享或上传。

- **无第三方中转**：授权码交换直接连接 `auth.openai.com`，不经过本项目服务器。
- **权限声明**：声明 `downloads`、`storage`（短期保存 PKCE 校验值与处理状态）、`webNavigation`（捕获登录回调）以及官方认证站点的连接权限。仅处理精确回调地址且匹配本次登录标签页和 `state` 的主框架导航，不保存回调 URL 或令牌到扩展存储。
- **彻底的代码闭环**：您可以随时通过浏览器开发者工具 (F12) 检查 `background.js` 和 `popup.js`。没有引入任何外部不可控 CDN 第三方库，所有静态资源均本地打包。

---

## 📜 许可证

本项目基于 [MIT License](LICENSE) 开源，允许任何个人或团队进行自由修改与二次分发，但请务必保留原作者署名及开源协议声明。
