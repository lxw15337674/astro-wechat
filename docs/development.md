# 开发

## 环境

Node.js 22 或更高。包是 ESM，源码为 TypeScript。

## 安装依赖

依赖版本已经由 pnpm 写入 `package.json` 和 `pnpm-lock.yaml`。

首次安装执行：

```bash
pnpm install
```

`@resvg/resvg-js` 与 `sharp` 是可选依赖：都是原生模块，缺少预编译二进制的平台上装不上。它们只在实际处理图片时才被动态导入，缺失时给出明确报错，渲染与预览之外的功能不受影响。**测试套件不需要它们**，所以装不上也能完整跑测试。

正因如此，代码里不能对这两个包做类型查询（`typeof import('sharp')`），否则没装成功的机器连 `typecheck` 都过不了。它们用结构化类型描述，见 `src/image/normalize.ts`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm test` | 运行测试 |
| `pnpm run test:watch` | 监听模式 |
| `pnpm run typecheck` | 只做类型检查，不产出 |
| `pnpm run build` | 编译到 `dist/` |

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

里程碑 1-5 的代码已完成并通过类型检查、141 项测试与构建。里程碑划分见技术设计第 13 节。

尚未做的见 [待办](todo.md)，主要是两类：代理日志审计，以及需要真实账户实测的未核实常量。
