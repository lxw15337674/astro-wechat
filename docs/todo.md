# 待办

截至 2026-08-11。下面按「阻塞程度」而非「工作量」排序。

## 1. 验证与提交（已完成）

`sharp` 已加入 optional dependencies，并完成以下验证：

```bash
pnpm run typecheck && pnpm test && pnpm run build
```

结果：类型检查通过，135 项测试全部通过，声明与 JavaScript 构建成功。`yt_dlp_fastapi` 已添加为 `services/yt-dlp-fastapi` submodule，废弃的 `docs/gateway-contract.md` 已删除，工作分支为 `feat/milestone-1-to-5`。

### 后续回归时优先看这几处

写完后做过一轮逐文件推演，预修了 6 处类型问题。若仍有报错，最可能在：

| 位置 | 可能原因 | 状态 |
| --- | --- | --- |
| `wechat/transport.ts` | `BodyInit` 在 @types/node 里不是全局名 | 已改为 `RequestInit['body']` |
| `wechat/client.ts` | `new Blob([Uint8Array])`：TS 7 + @types/node 26 改过 `Uint8Array` 的泛型参数 | 已通过复制为 `ArrayBuffer` 支撑的视图修复 |
| `image/normalize.ts` | sharp 的结构化类型与实际 API 有出入 | 已验证通过 |
| `cli.ts` | cac 变参命令 `<...files>` 的 action 签名 | 已验证通过 |
| `test/helpers/mock-wechat.ts` | 假 fetch 的参数类型推导 | 已验证通过 |

这类问题的共同根源：Node 的 fetch 相关类型来自 `@types/node`，而不是 DOM lib，全局可见的名字比浏览器少。遇到就换成从 `typeof fetch` 或 `RequestInit[...]` 推导，别直接写全局名。

## 2. 只有你能做

| 事项 | 为什么 | 不做的后果 |
| --- | --- | --- |
| 确认公众号「素材管理」「草稿箱」接口权限已开通 | 要登录公众平台后台 | 未认证个人订阅号调不通，整个包无法工作 |
| 确认 npm 上 `@bhwa233/astro-wechat` 可用 | 决定包名 | 改名越晚成本越高 |
| 代理机器的 HTTPS 域名与证书 | 你的机器 | 代理必须是 HTTPS，凭据会经过这条链路 |
| 用真实文章跑 `preview` 看排版 | 只有你知道好不好看 | 主题 CSS 大概率要调一轮 |
| 定哪些 AstroPaper 定时任务加 `wechat.enabled: true` | 内容策略 | — |

## 3. 需要真实账户实测的未核实项

这些目前都是保守默认值或带判别逻辑的猜测，实测比查文档准。建议在里程碑 2 的手动端到端测试里一并做掉。

- **微信字段确切上限**（标题、作者、摘要、正文大小）。现在 `constants.ts` 里标了 `UNVERIFIED`。
- **正文图片与永久素材的接受格式**。现在假定 jpg/png。
- **`draft/batchget` 在 `no_content: 1` 时是否仍返回 `content_source_url`**。这是协调路径匹配草稿的唯一依据；代码里有判别，字段缺失会立刻报错而不是静默扫到上限，但正确参数仍需确认。
- **微信仍会渲染为可点击锚点的链接目标**。现在 `CLICKABLE_LINK_HOSTS` 是空数组，所有外链都进参考列表。
- **接口每日配额的实际数值**。

## 4. ADR-0003 依赖核实

- `doocs/md` 是否发布了可编程调用的 core 包及其许可证。**不阻塞代码** —— 主题是独立 CSS 文件，能用就替换一个文件。
- `@resvg/resvg-js` 与 `sharp` 在目标 CI 架构上是否有预编译二进制。
- `yt_dlp_fastapi` 现有 Python 依赖是否与 `httpx` 冲突；以及它当前是否记录 access log（记了就是凭据泄露）。
- 是否存在未知的、以库形态发布的微信排版方案。

## 5. 转发代理接入

参考实现在 `services/wechat-proxy-reference/`，尚未接入实际服务。

- 复制 `wechat_proxy.py` 进 submodule 并挂载 router
- 配置 `WECHAT_PROXY_TOKEN`
- **部署后必须验证三件事**（该目录 README 有 curl 自检命令）：
  - 无令牌返回 401
  - 白名单外路径返回 403
  - token 接口原样透传微信响应（凭据错误时是带 `errcode` 的 HTTP 200）
- 检查 uvicorn access log、反向代理、APM 三处都不记录 query 与请求体

## 6. 有意未实现

不是遗漏，是范围决策。改主意时回到对应文档。

| 功能 | 决策出处 |
| --- | --- |
| 更新已创建的草稿 | 技术设计 §2.3 |
| 跨运行图片上传缓存 | 同上，与 update 路径绑定 |
| 远程图片下载（现在直接报错） | 里程碑 2 未覆盖 |
| MDX | 技术设计 §2.6 |
| 群发、多平台发布 | 同上 |
| 动图保留 | 平台不支持 |

## 7. 可做可不做

- `publish` 目前串行处理多篇文章。微信侧要求按账户串行，但本地渲染和图片规范化可以并行。文章不多时收益有限。
- Astro 集成只在 `astro:build:done` 做校验，没有 dev 模式预览。
- 没有 `.editorconfig` / lint 配置。

## 8. 已知不变量（改代码前必读）

见 [开发](development.md) 的「不变量」一节。八条，每条都有测试盯着，破坏了不会静默通过。其中三条是这轮审查中发现已被破坏并修复的：

- 草稿引用的封面素材一定不在孤儿列表里 —— 否则 `cleanup-orphans` 会删掉线上草稿在用的封面
- 所有 SVG 都走加固过的栅格化路径 —— `data:image/svg+xml` 曾绕过检查
- 台账读取失败必须中止 —— 曾把权限错误和文件损坏都当成「首次运行」，会给整个博客重建草稿
