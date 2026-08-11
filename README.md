# astro-wechat

将 Astro Markdown 同步到微信公众号草稿箱。

## 当前状态

核心功能已实现并已发布 npm 包；真实公众号端到端验证仍待完成。

| 能力 | 状态 |
| --- | --- |
| Markdown 读取、frontmatter 适配、字段校验 | 已实现 |
| 资源解析、SVG 栅格化、图片规范化 | 已实现 |
| 微信 HTML 渲染、外链转参考列表、本地预览 | 已实现 |
| 微信客户端：token、图片、封面、草稿、查找 | 已实现 |
| 草稿身份台账、两阶段写入、结果不明协调 | 已实现 |
| CLI：inspect / preview / list / publish / publish-changed / cleanup-orphans | 已实现 |
| 转发代理 | 已部署并完成协议自检 |
| 真实账户端到端验证 | 未做 |
| npm 发布 | `0.1.0` 已发布 |

## npm 包

- npm 包：`@lxw15337674/astro-wechat`（当前版本 `0.1.0`）
- CLI 命令：`astro-wechat`
- 运行时：Node.js 22+、ESM、TypeScript
- 初始 Astro 目标版本：当前稳定大版本，并在发布前评估其前一个大版本

该包计划提供三个入口：

1. 一个与框架无关、供编程方式使用的核心库，作为默认导出。
2. 一个用于本地环境和 CI 中显式预览及草稿同步的 CLI。
3. 一个用于内容发现、校验和预览支持的 Astro 集成，位于独立子路径，确保非 Astro 使用者不会加载它。

发布始终是显式操作。执行 `astro build` 绝不能创建或更新微信公众号草稿。

## 使用

### 在文章里开启同步

默认不发布。必须在 frontmatter 里显式声明：

```yaml
---
title: 文章标题
description: 用作微信摘要
author: 作者名
ogImage: /images/cover.png
draft: false
tags: [tech]
wechat:
  enabled: true          # 不写就不会同步
  title: 公众号专用标题    # 可选，覆盖 title
  digest: 公众号专用摘要    # 可选
---
```

`draft: true` 的文章永远不会被同步，配置也覆盖不了，只有显式 CLI 标志可以。

### 项目配置

在 Astro 项目根目录放 `astro-wechat.config.mjs`：

```js
export default {
  contentDir: 'src/data/blog',
  siteUrl: 'https://example.com',   // 用于推导 canonical URL
  permalinkPattern: '/posts/:slug/',
  defaultAuthor: '作者名',
  defaultCover: '/images/default-cover.png',
  theme: 'default',
  ledgerPath: '.astro-wechat/ledger.json',
}
```

**`siteUrl` 值得配。** 没有它，文章就没有 canonical URL，草稿身份无法从微信侧恢复；一旦台账丢失或某次同步结果不明，就只能人工去草稿箱确认。

### 命令

```bash
astro-wechat inspect <文件>          # 看规范化后的元数据与校验结果
astro-wechat preview <文件>          # 生成本地 HTML 预览
astro-wechat list                    # 列出所有文章及同步资格
astro-wechat publish <文件...>       # 同步到草稿箱
astro-wechat publish-changed         # 同步 Git 变更的文章
astro-wechat cleanup-orphans         # 列出孤儿封面素材，加 --yes 才删除
astro-wechat verify-proxy            # 验证已部署代理的认证 / 目标策略 / 原样透传
```

`publish` 和 `publish-changed` 支持 `--dry-run`：完整走到创建决策，报告会跳过还是会新建，但不写入。所有命令支持 `--json`。

代理部署后可在不使用真实微信凭据的情况下自检：

```bash
WECHAT_PROXY_URL=https://proxy.example.com \
WECHAT_PROXY_TOKEN=服务端API_AUTH_TOKEN \
astro-wechat verify-proxy
```

### 环境变量

```bash
WECHAT_APP_ID=...
WECHAT_APP_SECRET=...
WECHAT_PROXY_URL=https://你的代理      # CI 必需；本地在白名单机器上可省略
WECHAT_PROXY_TOKEN=...
```

省略代理地址时直连微信，用于已列入 IP 白名单的机器。

### 台账必须提交

`.astro-wechat/ledger.json` 记录哪些文章已经同步过。**不要 gitignore 它** —— 丢了它，下次运行会把所有文章当新文章重新创建。同目录下的 `preview/` 才是可丢弃的。

## 文档

- [待办](docs/todo.md)
- [技术设计](docs/technical-design.md)
- [CI 集成](docs/ci-integration.md)
- [转发代理契约](docs/proxy-contract.md)
- [开发](docs/development.md)
- [ADR-0001：包的形态](docs/decisions/0001-package-shape.md)
- [ADR-0002：草稿身份与持久化状态](docs/decisions/0002-draft-identity-and-state.md)
- [ADR-0003：依赖选型](docs/decisions/0003-dependencies.md)
- [ADR-0004：由 Python 发布网关代发微信请求](docs/decisions/0004-publishing-gateway.md)（已被 ADR-0005 取代）
- [ADR-0005：用固定 IP 主机上的转发代理满足微信 IP 白名单](docs/decisions/0005-forwarding-proxy.md)

## 架构

微信接口受 IP 白名单约束，GitHub 托管 runner 的出口 IP 不固定，因此微信请求不从 CI 直接发出，而是经固定 IP 主机上的转发代理：

```text
Astro 仓库 (CI, 托管 runner)              固定 IP 主机
  解析 / 渲染 / 图片规范化
  微信协议、错误分类、重试      ──HTTPS──▶  转发代理  ──▶  微信公众平台
  内容哈希 / 草稿身份台账          令牌      不理解微信
```

**代理只做转发**，不解析响应、不认识 `errcode`、不持有凭据。微信协议实现全部在 Node，因此只有一套契约测试。代价是微信凭据存在于 CI —— 取舍见 ADR-0005。

调用使用通用 `POST /v2/proxy` 协议，部署策略只放行 `api.weixin.qq.com`、HTTPS 443 和 GET/POST；服务端没有微信专用路由。

未配置代理地址时客户端直连微信，用于已列入白名单的机器上本地调试。

代理是独立部署的外部服务，不属于本仓库或 npm 包。调用方只需配置
`WECHAT_PROXY_URL` 与 `WECHAT_PROXY_TOKEN`；克隆、构建和测试本项目都不需要代理源码。

## 初始范围

首个版本计划支持：

- 带有 YAML frontmatter 的 Astro Markdown 文章
- 兼容 AstroPaper 的元数据和公共资源
- 本地与远程正文图片
- PNG、JPEG、WebP、GIF 和 SVG 源资源
- 兼容微信的内联 HTML 渲染；由于微信不会将外部链接渲染为可点击锚点，外部链接会转换为参考列表
- 本地 HTML 预览
- 创建草稿，并保证同一篇文章不会重复创建
- 非交互式 CI 用法

首个版本**不更新**已创建的草稿：定时生成的文章同步一次即定稿，已发布内容改动请在公众号后台编辑。源文章在同步后被改动时，CLI 会给出 drift 警告而不是静默跳过。更新路径的接口已预留，详见技术设计第 2.3 节。

首个版本不会支持 MDX 执行、群发、文章生成、托管式管理界面或多平台发布。由于平台不接受动态的正文图片，动态 GIF 和 WebP 正文图片会缩减为第一帧。
