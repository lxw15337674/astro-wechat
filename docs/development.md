# 开发

## 环境

Node.js 22 或更高。包是 ESM，源码为 TypeScript。

## 安装依赖

`package.json` 中**尚未写入依赖版本**。这是刻意的：写作时无法联网核实各包的当前版本，凭记忆写死版本范围只会安装失败或锁到过时版本。

首次安装执行：

```bash
pnpm add markdown-it markdown-it-footnote gray-matter cheerio juice sanitize-html cac
pnpm add -O @resvg/resvg-js sharp
pnpm add -D typescript vitest @types/node @types/markdown-it @types/sanitize-html
```

由包管理器写入实际版本，然后核对 ADR-0003「待核实」一节的各项，并把结论写回该文档。

`@resvg/resvg-js` 与 `sharp` 是可选依赖：都是原生模块，缺少预编译二进制的平台上装不上。它们只在实际处理图片时才被动态导入，缺失时给出明确报错，渲染与预览之外的功能不受影响。测试套件不需要它们。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm test` | 运行测试 |
| `npm run test:watch` | 监听模式 |
| `npm run typecheck` | 只做类型检查，不产出 |
| `npm run build` | 编译到 `dist/` |

## 目录结构

```
src/
  constants.ts        微信平台限制，唯一来源
  errors.ts           六类错误与警告收集器
  types.ts            领域模型
  eligibility.ts      同步资格判定
  pipeline.ts         load → adapt → render → sync 的组合入口
  index.ts            核心默认导出
  integration.ts      Astro 集成与 schema 片段（只校验，不发布）
  cli.ts              CLI 入口
  project/            项目发现与配置
  source/             文章加载、frontmatter 适配、字段校验
  assets/             资源路径解析与内容身份
  render/             Markdown → 微信 HTML 流水线
    themes/           主题 CSS，可替换资产
  image/              SVG 栅格化与图片规范化
  wechat/             微信客户端、token、错误分类、代理出口
  state/              草稿身份台账
  sync/               创建决策、协调、孤儿清理
  git/                变更文件发现
  preview/            本地独立 HTML 预览
test/
  helpers/            临时 Astro 项目与假 fetch
services/
  wechat-proxy-reference/  转发代理参考实现，待复制进 submodule
  yt-dlp-fastapi/          转发代理（git submodule，不属于 npm 包）
examples/
  github-workflow.yml      CI job 示例
```

## 渲染流水线的顺序不可随意调整

`src/render/index.ts` 的六个步骤有硬性约束：

1. Markdown → HTML
2. 出站链接改写（必须在主题之前，生成的参考列表才会被一并主题化）
3. 应用主题
4. CSS 内联（微信不支持外部样式表，跳过这步文章就是无样式的）
5. 净化
6. 图片改写为内容哈希占位符（必须在净化之后，否则占位符 URL 会被净化器判为可疑）

内容哈希在第 6 步之后、任何上传之前计算。**把哈希挪到上传之后会让「未变更零上传」失效**，`test/render-pipeline.test.ts` 里有一条断言专门防这个回归。

## 不变量

改代码前先知道这几条，它们各自有测试盯着，破坏了不会静默通过：

| 不变量 | 破坏后的后果 | 测试 |
| --- | --- | --- |
| 内容哈希在上传前计算 | 「未变更零上传」失效，每次运行都先传完图再决定跳过 | `render-pipeline.test.ts` |
| 已同步文章重复运行零请求 | CI 每次都白跑一遍上传 | `synchronize.test.ts` |
| 创建草稿超时绝不重试 | 草稿箱出现重复文章 | `wechat-client.test.ts` |
| 分页扫描到上限时报错而非返回 null | 上层理解成「没发过」，重复创建 | `wechat-client.test.ts` |
| 封面上传不重试 | 永久素材配额泄漏且不可回收 | `wechat-client.test.ts` |
| pending 记录先于任何微信调用写入 | 结果不明的运行无法被识别，下次直接重建 | `synchronize.test.ts` |
| 配额错误不进重试循环 | 更快耗尽额度，且把一个可读的错误变成一串乱码 | `wechat-client.test.ts` |
| 草稿引用的封面素材一定不在孤儿列表里 | `cleanup-orphans` 会删掉线上草稿正在用的封面 | `synchronize.test.ts` |
| 所有 SVG 都走加固过的栅格化路径 | `data:image/svg+xml` 绕过检查，XXE 与远程引用重新可达 | `normalize.test.ts` |
| 台账读取失败必须中止，只有文件不存在才算首次运行 | 空台账让每篇文章都像新的，下次发布给整个博客重建草稿 | `state-store.test.ts` |

最后一条容易写错的方式是把清除条件写成「刚上传过才清」。不变量是**草稿引用的素材**不是孤儿，跟这次有没有上传无关；复用封面时同样要清。

## 里程碑

里程碑 1（读取与预览）、2（创建草稿）、3（重复预防）的代码已完成，4（Astro 与 CI 集成）除工作流示例外已完成。里程碑划分见技术设计第 13 节。

尚未做的：转发代理接入实际服务（参考实现在 `services/wechat-proxy-reference/`）、真实账户端到端验证、里程碑 5 的发布流程。
