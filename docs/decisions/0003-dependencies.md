# ADR-0003：依赖选型

- 状态：提议中
- 日期：2026-08-10

## 背景

两块功能存在「复用现成开源项目」还是「自研」的选择：Markdown 到微信 HTML 的渲染，以及微信接口调用。其余部分（frontmatter 解析、CSS 内联、HTML 净化、图片处理、CLI）没有争议，直接选成熟库即可。

需要注意的是，本 ADR 写作时无法联网核实 npm 上各包的当前状态。下方「待核实」一节列出必须在首个公开预发布版本前完成的检查；核实结果可能改变「主题资产」这一项，但不会改变其他决策，理由见后。

## 决策

### 1. 渲染管线自研，基于 `markdown-it`

微信排版生态里的主流开源项目（`doocs/md`、`markdown-nice` 等）都是**编辑器应用**而非可编程库。复用它们意味着 vendor 代码，而不是加一条依赖。

同时本项目对渲染有两项这些项目不会有的需求：

- 出站链接改写为文末参考列表（技术设计第 5.4 节）
- 图片源改写为内容哈希占位符，以支持上传前哈希（技术设计第 5.5 节、ADR-0002）

选 `markdown-it` 而非 `marked` 或 remark：同步执行、输出确定、renderer 规则可逐条覆写，且脚注有成熟插件。不选 remark 虽然会与 Astro 站点自身的渲染结果有细微差异，但微信 HTML 本来就要重排版，这点差异没有意义，而 remark 的异步与插件链会让确定性快照测试更难写。

### 2. 主题是可替换的单文件 CSS 资产

微信不支持外部样式表，所有排版必须内联，因此主题的实质就是一份 CSS。这也是这类项目里最费时、最有复用价值的资产 —— 代码部分反而只是几十行 renderer 覆写。

主题因此被隔离为一个独立文件，渲染管线只负责把它内联进 HTML，不对其内容做任何假设。

这样安排的直接好处：`doocs/md` 是否可复用这个问题**不阻塞任何代码**。若核实后确认其主题 CSS 可用且许可证允许，替换的是一个文件；若不可用，我们自己写一份，其余代码完全不动。

引入任何外部主题都必须在文件头记录来源仓库、许可证和引入时的 commit，并纳入开放决策 3 的许可证审查。

### 3. 微信接口调用不使用第三方 SDK

Node 生态没有事实标准的公众号 SDK；现存的几个多年未更新，大概率不含草稿箱和 stable-token 接口。

即使有，也不该用。需要的调用只有获取 token、上传图片、上传永久素材、创建草稿、列出草稿五个，都是普通 JSON 或 multipart 请求；而错误码分类、配额单独成类不重试、HTTP 200 中检查 `errcode` 这些要求（技术设计第 9 节）反而需要绕开封装才能实现。用 Node 内置 `fetch` 直接写，不引入 HTTP 库。

ADR-0005 把微信协议实现留在 Node，因此这一条覆盖全部微信调用。转发代理不理解微信，自然也不需要 SDK。

### 4. Node 侧依赖

| 用途 | 选择 | 理由 |
| --- | --- | --- |
| frontmatter 解析 | `gray-matter` | 事实标准，YAML 与正文一次拿到 |
| Markdown 解析 | `markdown-it` + `markdown-it-footnote` | 同步、确定性、规则可覆写 |
| CSS 内联 | `juice` | 微信不支持外部样式表 |
| HTML 净化 | `sanitize-html` | 白名单式，默认拒绝 |
| HTML 改写 | `cheerio` | 技术设计第 5.5 节要求用解析器而非正则 |
| SVG 栅格化 | `@resvg/resvg-js` | Rust 实现，不加载远程资源、不执行脚本，直接满足第 10 节的安全要求；`sharp` 走 librsvg，这些开关不可控 |
| 图片规范化 | `sharp` | 里程碑 2 才引入 |
| CLI | `cac` | 体积小，无装饰性输出 |
| 测试 | `vitest` | 与 TypeScript ESM 直接兼容 |
| HTTP | Node 内置 `fetch` | Node 22 已全局提供，不引入 axios |

### 5. 代理侧依赖

转发代理寄生在已有的 `yt_dlp_fastapi` 服务中（见 ADR-0005），沿用其技术栈：

| 用途 | 选择 | 理由 |
| --- | --- | --- |
| Web 框架 | FastAPI | 服务已在用 |
| HTTP 客户端 | `httpx` | 异步，超时与重定向限制可配 |
| 请求体透传 | `python-multipart` | FastAPI 处理 multipart 的前提 |
| 测试 | `pytest` | 只需覆盖转发语义、白名单与认证 |

不需要 `respx`：代理不理解微信，微信契约测试全部在 Node 侧。这是 ADR-0005 相对 ADR-0004 省下的东西之一。

## 核实进度

### 已核实

**Node 依赖版本与可安装性**（2026-08-11，pnpm）。全部安装成功，里程碑 1-5 的 138 项测试与 `build` 在这套版本下通过：

| 包 | 版本范围 |
| --- | --- |
| `markdown-it` | `^15.0.0` |
| `markdown-it-footnote` | `^4.0.0` |
| `gray-matter` | `^4.0.3` |
| `cheerio` | `^1.2.0` |
| `juice` | `^12.1.2` |
| `sanitize-html` | `^2.17.6` |
| `cac` | `^7.0.0` |
| `@resvg/resvg-js`（可选） | `^2.6.2` |
| `sharp`（可选） | `^0.35.3` |

两个可选原生模块在开发机（Linux x64/WSL）上安装并实际加载成功：`sharp` 0.35.3 使用 libvips 8.18.3，`@resvg/resvg-js` 2.6.2 成功加载原生 `Resvg`。上游支持矩阵覆盖 CI 使用的 Node 22/Linux x64 glibc：resvg-js 提供对应 napi-rs 预编译包；sharp 为 Linux x64 glibc 提供预编译包，但要求 glibc >= 2.28 和 SSE4.2。`ubuntu-latest` 满足这些约束。

集成时暴露并已解决的类型问题，记录于此以免重犯：

- `markdown-it` v15 自带类型，其默认导出是值而非类声明，名字不能直接用作类型。使用 `InstanceType<typeof MarkdownIt>`。
- `markdown-it-footnote` 不提供类型声明。本仓库在 `src/module-declarations.d.ts` 中自带最小声明，且刻意不引用 markdown-it 的类型 —— `skipLibCheck` 不检查该文件，在其中犯同样的错误不会有任何报错。
- **fetch 相关类型来自 `@types/node` 而非 DOM lib，全局可见的名字比浏览器少。** `BodyInit` 不是全局名，改用 `RequestInit['body']`；假 fetch 的参数从 `Parameters<typeof fetch>` 推导。写全局名之前先确认它确实是全局的。
- `Blob` 构造参数在 TS 7 + `@types/node` 26 下对 `Uint8Array` 的底层缓冲区类型有要求，需要复制为 `ArrayBuffer` 支撑的视图。
- `sharp` 以结构化类型而非 `typeof import('sharp')` 描述。它是可选依赖，类型查询会让没装成功的机器连 `typecheck` 都过不了。

**`doocs/md` 核实结果**（2026-08-11，仓库 HEAD `130f8d5`）：仓库采用 WTFPL，并已有内部 `@md/core` workspace；但公共 npm registry 中没有 `@md/core`，根包 `md` 是编辑器 monorepo 而非可编程渲染库。因此不把它加入运行时依赖，继续使用本仓库独立、可替换的默认主题。以后若单独引入其 CSS，仍须在主题文件头记录来源 commit 与许可证。

**代理侧依赖**（2026-08-11，读 submodule 源码确认）。`yt_dlp_fastapi/requirements.txt`：

```
fastapi>=0.115,<1.0
httpx>=0.27,<1.0
playwright>=1.55,<2.0
python-dotenv>=1.0,<2.0
uvicorn[standard]>=0.30,<1.0
yt-dlp>=2026.2.21,<2027.0.0
```

`httpx` 已经是既有依赖，转发端点不引入任何新包。`python-multipart` 也不需要 —— 转发端点读原始请求体透传，不解析 multipart。

两项与安全相关的现状：

- **该服务已有通用转发端点 `/v1/proxy`，但不能复用**。理由见 ADR-0005 第 2 条，其中「不支持 multipart 请求体」是硬阻塞。
- **uvicorn access log 会泄露 access token**。access log 记录完整请求行含 query string，而微信把 `access_token` 放在 query 里。已通过在 `uvicorn.run()` 传 `access_log=False` 解决，代理端点自行输出不含 query 的日志行。前置反向代理与 APM 仍需单独确认。

### 待核实

以下都不阻塞代码，但在首个公开预发布版本前必须完成。

1. 首次公开预发布前再做一次生态检索，确认没有新出现的、以库形态发布且同时满足出站链接改写与上传前图片占位符要求的微信排版方案。
2. 首次在 GitHub Actions 上运行后，确认锁文件在 Node 22/`ubuntu-latest` 实际选择了上述 Linux x64 预编译包；上游支持矩阵已经覆盖该组合，但 CI 运行记录才是最终证据。

核实完成后把结论移到「已核实」一节并注明日期。

## 后果

### 正面影响

- 渲染管线的每一步都可单独快照测试，不受上游编辑器项目的版本节奏影响。
- 主题可替换，使最有价值的社区资产（CSS）能被复用，而不必承担 vendor 整个应用的许可证与维护成本。
- 微信调用集中在网关一处，错误分类和配额策略不受第三方封装限制。

### 负面影响

- 渲染质量的下限由我们自己保证，社区主题多年打磨出的排版细节需要逐步补齐。
- 项目跨两种语言，依赖与测试各一套。
- `markdown-it` 与 Astro 站点的 remark 渲染结果不完全一致，同一篇文章在网页和公众号上可能有细微差异。这是可接受的，但不能被误当成 bug。
