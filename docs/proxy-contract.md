# 转发代理契约

固定 IP 主机上的转发端点与 Node 侧微信客户端之间的接口。ADR-0005 决定了为什么存在这一层。

代理**不理解微信**。它不解析响应体、不认识 `errcode`、不持有微信凭据。所有微信协议知识都在 Node 侧，这正是相对 ADR-0004 的取舍所在。

实现位于 submodule `services/yt-dlp-fastapi`。

## 1. 转发规则

```
<方法> https://<代理主机>/wechat/<路径>?<查询串>
        │
        └──转发──▶ https://api.weixin.qq.com/<路径>?<查询串>
```

- 目标主机**固定为 `api.weixin.qq.com`**，写在代理配置里，绝不从请求中读取。
- 路径、查询串、请求体、`Content-Type` 原样透传。
- 上游的状态码、`Content-Type`、响应体原样返回。
- 不跟随重定向。上游若返回 3xx，把它当作响应交给调用方。

原样返回是关键：Node 侧的错误分类依赖看到真实的微信响应，包括 HTTP 200 里的 `errcode`。代理任何形式的「帮忙处理」都会破坏这一点。

## 2. 认证

```
Authorization: Bearer <WECHAT_PROXY_TOKEN>
```

常量时间比较。仅 HTTPS。

令牌与微信凭据分开配置，可独立轮换。

**代理访问权就是操作公众号的能力边界**：因为微信侧有 IP 白名单，即使同时拿到 AppSecret 和 access token，没有代理访问权也调不通。

## 3. 路径白名单

只放行同步草稿实际需要的路径。默认：

| 路径 | 用途 |
| --- | --- |
| `/cgi-bin/stable_token` | 获取 access token |
| `/cgi-bin/media/uploadimg` | 上传正文图片 |
| `/cgi-bin/material/add_material` | 上传封面为永久素材 |
| `/cgi-bin/draft/add` | 创建草稿 |
| `/cgi-bin/draft/batchget` | 按 source-URL 查找草稿 |
| `/cgi-bin/material/del_material` | 删除孤儿封面素材，默认关闭 |

白名单之外返回 `403`。

这条限制的价值在于泄露后的爆炸半径：白名单里没有群发接口，令牌泄露就变不成群发。删除素材的路径默认关闭，运维清理时临时打开。

方法只放行 `GET` 与 `POST`。

## 4. 限制与超时

| 项 | 取值 |
| --- | --- |
| 请求体上限 | 与微信对应接口一致，取最宽者 |
| 响应体上限 | 足够容纳草稿列表分页响应 |
| 连接与读取超时 | 与 Node 侧客户端的超时对齐 |

超时与体积上限必须与微信接口的真实限制对齐。定得比微信更严，会在这一层制造出微信本身不会返回的错误，让调用方按错误的原因去排查。

上游超时时返回 `504`，且**响应体为空**。Node 侧据此判定「结果不明」，不得重试写操作。

## 5. 日志

**绝不记录 query string 和请求体。**

微信把 `access_token` 放在 query 里，token 请求的 body 里有 AppSecret。代理虽然不存储凭据，但它看得见 —— 一行普通的 access log 就足以把两者落盘。

可以记录：时间、方法、路径（不含 query）、上游状态码、耗时、字节数。

## 6. 直连回退

未配置代理地址时，Node 客户端直连 `api.weixin.qq.com`。

用于已列入白名单的机器上本地调试，以及代理故障时的应急通道。CI 必须配置代理，托管 runner 直连必然失败。

## 7. 部署自检

部署后优先运行自动自检；它使用固定伪凭据，不会接触生产 AppSecret：

```bash
WECHAT_PROXY_URL=https://你的代理 \
WECHAT_PROXY_TOKEN=你的独立代理令牌 \
astro-wechat verify-proxy
```

命令会验证无认证返回 401、群发路径返回 403，以及伪凭据触发的微信错误仍以 HTTP 200 和 `errcode` 原样返回。需要逐项诊断时可使用等价 curl：

```bash
# 应当返回 401
curl -i https://你的代理/wechat/cgi-bin/stable_token

# 应当返回 403：群发接口不在白名单里
curl -i -H "Authorization: Bearer $WECHAT_PROXY_TOKEN" \
  https://你的代理/wechat/cgi-bin/message/mass/send

# 应当返回微信的真实响应
curl -i -H "Authorization: Bearer $WECHAT_PROXY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credential","appid":"x","secret":"y"}' \
  https://你的代理/wechat/cgi-bin/stable_token
```

第三条**必须是 HTTP 200 且 body 里有 `errcode`**。这说明代理原样透传，没有替调用方「处理」错误 —— 一旦它把 errcode 翻译成 HTTP 状态码，Node 侧的错误分类就全错了。

日志方面还要确认两处，它们不在本仓库和 submodule 的控制范围内：

- 前置的 Nginx / Caddy 是否记录完整 URL
- APM 或错误上报 SDK 是否采集 URL 与请求体

`access_token` 在 query 里，AppSecret 在 token 请求的 body 里，任一处记全就等于凭据落盘。

## 8. 变更流程

代理不理解微信，因此增加微信接口调用通常**不需要改代理代码**，只需要在路径白名单里加一行配置。

需要改代理实现的情况只有：转发语义变化、限制值调整、认证方式变化。这类改动要同时更新本文与 submodule 指针。
