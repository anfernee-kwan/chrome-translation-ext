# 双语对照翻译 Chrome 插件 — 设计文档

**日期**: 2026-05-02
**作者**: anfernee

## 1. 目标

为个人浏览外文网页提供双语对照阅读体验：保留原文，将中文译文按段落 inline 插入到原文段落下方，方便对照阅读。翻译能力由用户配置的大模型 API（当前使用兼容 Anthropic 原生协议的 Claude Haiku）提供。

## 2. 范围

### 包含
- 手动触发整页翻译（点击浏览器工具栏图标）
- 翻译"正文段落 + 表格单元格"类元素：`<p>`, `<li>`, `<h1>`-`<h6>`, `<blockquote>`, `<td>`
- 译文紧跟原段落下方，淡灰色 + 左侧竖线区分
- 点击图标在 显示译文 / 隐藏译文 之间切换；首次翻译结果在内存中缓存（页面生命周期内）
- Options 配置页：provider、baseURL、apiKey、model
- Provider 抽象层；当前实现 Anthropic 原生协议；预留 OpenAI 兼容接口

### 不包含（YAGNI）
- 跨页面持久化缓存（chrome.storage 持久化）
- 划词/选段翻译
- 自动检测页面语言、自动翻译
- SPA 动态加载内容的增量翻译
- 多 provider 同时使用 / 译文质量对比
- 多目标语言（仅简体中文）
- popup UI（点击图标直接触发 action，不弹 popup）

## 3. 用户流程

1. 用户访问外文网页
2. 点击工具栏插件图标 → 状态：未翻译 → 触发翻译
3. 内容脚本扫描段落、分批，背景脚本调用 API 并发翻译
4. 译文按段落 inline 插入原文下方，淡灰色样式
5. 再次点击图标 → 隐藏所有译文（DOM 仍保留，仅 CSS 隐藏）
6. 第三次点击 → 重新显示译文（不重新调用 API）
7. 页面刷新或关闭 → 缓存丢失，下次访问需重新翻译

## 4. 架构

### 4.1 目录结构

```
chrome-translation-ext/
├── manifest.json              # MV3 manifest
├── background.js              # service worker：API 调用、tab 状态管理、消息路由
├── content.js                 # 段落扫描、批次切分、译文插入、显隐切换
├── content.css                # 译文样式
├── options.html               # 配置页 HTML
├── options.js                 # 配置页逻辑
├── lib/
│   └── providers.js           # provider 抽象：anthropic / openai-compatible（仅接口）
└── icons/
    └── icon-{16,48,128}.png
```

### 4.2 组件职责

**background.js (service worker)**
- 监听 `chrome.action.onClicked`
- 维护 tab 状态：`Map<tabId, 'untranslated' | 'translating' | 'shown' | 'hidden'>`
- 收到点击事件后根据状态决定动作：translate / toggle
- 接收 content.js 发来的批次，调用 provider 完成翻译，返回结果
- tab 关闭/导航时清理状态：监听 `tabs.onRemoved`、`webNavigation.onCommitted`（main frame）

**content.js**
- 扫描 DOM，按选择器筛选候选段落
- 过滤规则：文本长度 >= 4 字符、中文字符占比 < 50%、未带 `data-tr-done` 标记
- 批次切分：累计 ~2000 字符或 ≤ 20 段为一批
- 给段落分配唯一 ID（`data-tr-id="{n}"`），把 `[{n}] {text}` 编号文本发给 background
- 接收译文后在对应原段落 `afterend` 插入 `<div class="__tr_zh" data-tr-of="{n}">{译文}</div>`，并在原段落上加 `data-tr-done="1"`
- 切换：toggle `<body>` 上的 `__tr_hidden` class

**lib/providers.js**
- 暴露 `translate({ provider, baseURL, apiKey, model, batches })` 统一接口
- `batches: string[]` —— 每个元素是一个完整的批次文本（含 `[1]...[N]` 编号）
- 返回 `string[]` —— 与 batches 同长度，每元素是模型原始文本输出
- Anthropic 实现：`POST {baseURL}/v1/messages`，header `x-api-key`、`anthropic-version: 2023-06-01`
- 解析逻辑放在 content.js（按 `[N]` 拆分）

**options.js / options.html**
- 表单字段：provider (select)、baseURL、apiKey、model（默认 `claude-haiku-4-5-20251001`）
- 保存到 `chrome.storage.local`
- 简单 "测试连接" 按钮：发送一句固定文本调用一次 API，显示结果或错误

## 5. 数据流

```
[用户点击图标]
    ↓
chrome.action.onClicked → background
    ↓
background 检查 tabState[tabId]
    ├─ untranslated → 发消息 {type:'translate'} 给 content
    └─ shown/hidden → 发消息 {type:'toggle'}
                          ↓
                      content toggle body class，回报新状态
    ↓
content 收 'translate' →
    1. 扫描段落，分配 tr-id，分批
    2. 逐批发 {type:'translateBatch', text} 给 background
    3. background 调 provider → 返回译文文本
    4. content 解析 [N] 编号 → 找到对应 data-tr-id 段落 → 插入译文
    5. 全部完成后回报 'shown'
```

**消息协议**：
```js
// content → background
{ type: 'translateBatch', text: '[1] ...\n[2] ...' }

// background → content
{ type: 'translate' }
{ type: 'toggle' }

// background → content (响应 translateBatch)
{ ok: true, text: '[1] 译文\n[2] 译文' }
{ ok: false, error: '...' }
```

## 6. Provider：Anthropic 原生协议

**请求**：
```
POST {baseURL}/v1/messages
Headers:
  x-api-key: {apiKey}
  anthropic-version: 2023-06-01
  content-type: application/json
Body:
{
  "model": "{model}",
  "max_tokens": 4096,
  "system": "{system prompt}",
  "messages": [{"role":"user", "content": "{batch text}"}]
}
```

**System prompt**：
```
你是专业翻译。将下面带编号的英文段落翻译成简体中文。
要求：
1. 严格保留编号格式 [N] 译文
2. 每段译文一行，不要换行
3. 不要添加任何解释、前言、总结
4. 专业术语和人名/地名按惯例翻译，不确定时保留原文
```

**解析**：`response.content[0].text` → content.js 按 `^\[(\d+)\]\s*(.+)$` 多行匹配。

## 7. 译文样式 (content.css)

```css
.__tr_zh {
  display: block;
  margin: 4px 0 8px 0;
  padding-left: 8px;
  border-left: 3px solid #ccc;
  color: #666;
  font-size: 0.95em;
  line-height: 1.5;
  font-family: inherit;
}
body.__tr_hidden .__tr_zh { display: none; }
/* 表格单元格内：译文紧跟在原文本后，仍 block 但 margin 收紧 */
td .__tr_zh, li .__tr_zh { margin: 2px 0 0 0; }
```

## 8. 错误处理

| 场景 | 处理 |
|---|---|
| 未配置 apiKey/baseURL | 点击图标时 background 检测，弹 `chrome.notifications` 提示 "请到选项页配置"，不进入翻译流程 |
| API 网络/认证失败 | 该批次失败，console.error，badge 显示 "!"；其他批次继续；最终在 badge 上显示 "{成功批数}/{总批数}" 几秒后清除 |
| 模型返回编号缺失或错乱 | 该批次自动 fallback：拆为单段重试一次（每段一次调用）；仍失败则跳过该段，原文保持不变 |
| 段落在翻译期间被页面 JS 修改 | 通过 `data-tr-id` 定位，找不到���跳过 |
| content script 在受限页面（chrome://、PDF、file://）无法注入 | background 收到 `chrome.action.onClicked` 但 `sendMessage` 失败时，notify "此页面不支持翻译" |

## 9. 状态机

每个 tab 独立状态，存储在 background 的 `Map`：

```
untranslated --[click]--> translating --[完成]--> shown
                              |
                              └--[失败]--> untranslated（保留已翻译的）
shown --[click]--> hidden
hidden --[click]--> shown
[tab close / nav]--> 清理 Map 项
```

## 10. 配置存储

`chrome.storage.local` 中：
```json
{
  "provider": "anthropic",
  "baseURL": "https://...",
  "apiKey": "sk-...",
  "model": "claude-haiku-4-5-20251001"
}
```

## 11. Manifest 关键项

```json
{
  "manifest_version": 3,
  "name": "Bilingual Translator",
  "version": "0.1.0",
  "permissions": ["activeTab", "storage", "scripting", "notifications"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "action": { "default_icon": { ... } },
  "options_page": "options.html",
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }]
}
```

`host_permissions: <all_urls>` 是为了让 background 的 fetch 能调到任意 baseURL（用户配置的 API 域名）。

## 12. 测试

**手动验证页面**：
- English Wikipedia article（多 `<p>`、`<h2>`、`<table>`）
- Hacker News story page（短评论 `<p>`）
- MDN 文档页（嵌套 `<li>`、代码块应跳过）
- 已经是中文的页面（验证大部分段落被过滤跳过）

**边界**：
- 极短页面（< 5 段，只 1 批）
- 超长页面（> 200 段，多批并发）
- 含表格的页面（`<td>` 译文样式紧凑不破版）
- 受限页面（chrome://newtab、PDF viewer）→ 友好失败

## 13. 非目标 / 已知限制

- 不处理 SPA 路由切换；用户切换路由后需重新点击翻译
- 不处理 iframe 内的内容（content script 默认只注入主 frame）
- 翻译不流式渲染；每批完成后整批一次性插入
- 段落选择器是固定列表，对非语义化网页（全 `<div>` 布局）效果可能差
