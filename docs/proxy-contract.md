# 转发代理契约

固定 IP 主机上的通用转发端点与 Node 微信客户端之间的接口。ADR-0005 说明了为什么存在这一层。

代理**不理解微信**。它不解析响应体、不认识 `errcode`、不持有微信凭据。微信协议知识全部留在 Node 侧。代理独立部署，本仓库只通过 `WECHAT_PROXY_URL` 与 `WECHAT_PROXY_TOKEN` 使用它。

## 1. 请求协议

所有代理请求的外层方法固定为：

```text
POST https://<代理主机>/v2/proxy
```

控制信息通过请求头传递：

```http
Authorization: Bearer <WECHAT_PROXY_TOKEN>
X-Proxy-Target: https://api.weixin.qq.com/<路径>?<查询串>
X-Proxy-Method: GET|POST
Content-Type: <上游 Content-Type，可选>
```

外层 body 就是上游 body 的原始字节，可以是 JSON、multipart 或二进制。`Content-Type`、`Content-Encoding`、`Accept`、`Accept-Language` 和 `User-Agent` 会直接传给上游；额外上游头使用 `X-Proxy-Upstream-<名称>`。代理认证头绝不会转发。

代理不跟随重定向。上游状态码、安全响应头和原始响应体直接返回，并增加：

```http
X-Proxy-Result: upstream
```

代理自身产生的转发失败返回 JSON `detail` 与稳定的 `error_code`；认证失败返回 `detail`。两者都标记：

```http
X-Proxy-Result: proxy-error
```

这个标记让 Node 侧能区分「代理拒绝」和「微信返回 401/403」。微信 HTTP 200 中的非零 `errcode` 仍由 Node 解析。

## 2. 认证与部署变量

`astro-wechat` 使用变量名 `WECHAT_PROXY_TOKEN`；当前通用服务端用 `API_AUTH_TOKEN` 校验。部署时两者填入同一个令牌值：

```text
astro-wechat: WECHAT_PROXY_TOKEN ──Bearer──▶ 服务端: API_AUTH_TOKEN
```

它与 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 是不同凭据，但与该服务的其他受保护 API 共用。轮换 `API_AUTH_TOKEN` 时必须同步更新调用方的 `WECHAT_PROXY_TOKEN`。只允许通过 HTTPS 公网地址调用代理。

## 3. 目标策略

`/v2/proxy` 是通用协议，部署实例通过环境变量收紧能力：

```dotenv
PROXY_V2_ALLOWED_HOSTS=api.weixin.qq.com
PROXY_V2_ALLOWED_METHODS=GET,POST
PROXY_V2_ALLOWED_SCHEMES=https
PROXY_V2_ALLOWED_PORTS=443
```

主机使用精确匹配，不支持通配符。目标还必须解析到公网地址，带认证信息、fragment、内网、回环、链路本地地址的 URL 会被拒绝。策略以外返回 `403`，方法不允许返回 `405`。

这里限制的是主机、协议、端口和方法，**不是微信路径白名单**。因此令牌与微信凭据同时泄露时，可以调用该主机上的其他微信接口。需要更窄的发布能力边界时，应改用 ADR-0004 的业务网关方案，而不是把微信知识塞进通用代理。

## 4. 限制、超时与结果不明

服务端通过以下变量限制资源：

| 变量 | 默认值 |
| --- | ---: |
| `PROXY_V2_MAX_REQUEST_BYTES` | 25 MiB |
| `PROXY_V2_MAX_RESPONSE_BYTES` | 25 MiB |
| `PROXY_V2_TIMEOUT_SECONDS` | 30 秒 |

请求体超限返回 `413/request_too_large`；响应体超限返回 `502/response_too_large`；连接失败返回 `502/upstream_unreachable`；超时返回 `504/upstream_timeout`。

非幂等微信写入遇到后三类失败时，上游可能已经执行。Node 侧会报告「结果不明」且不自动重试，必须先与微信协调远程状态。

## 5. 日志

**绝不记录 `X-Proxy-Target` 完整值和请求体。** 微信把 `access_token` 放在目标 query 中，token 请求体里有 AppSecret。反向代理、应用访问日志和 APM 都必须遵守这一点。

可以记录：时间、代理端点、上游主机、上游方法、状态码、耗时和字节数。日志中的上游 URL 必须去掉 query。

## 6. 直连回退

未配置 `WECHAT_PROXY_URL` 时，Node 客户端直连 `api.weixin.qq.com`。这用于已列入微信 IP 白名单的机器本地调试，也是一条应急通道。GitHub 托管 runner 必须配置代理。

## 7. 部署自检

自检使用伪微信凭据，不接触生产 AppSecret：

```bash
WECHAT_PROXY_URL=https://你的代理 \
WECHAT_PROXY_TOKEN=服务端的API_AUTH_TOKEN \
astro-wechat verify-proxy
```

命令验证三件事：缺少认证返回 401；策略外目标返回 403；伪凭据触发的微信错误仍以 HTTP 200 和非零 `errcode` 原样返回。

等价的逐项请求都发往 `/v2/proxy`：

```bash
# 缺少认证，应为 401
curl -i -X POST https://你的代理/v2/proxy \
  -H 'X-Proxy-Target: https://api.weixin.qq.com/cgi-bin/stable_token' \
  -H 'X-Proxy-Method: GET'

# 策略外主机，应为 403
curl -i -X POST https://你的代理/v2/proxy \
  -H "Authorization: Bearer $WECHAT_PROXY_TOKEN" \
  -H 'X-Proxy-Target: https://example.com/' \
  -H 'X-Proxy-Method: GET'

# 微信真实响应，应为 HTTP 200 且 body 含非零 errcode
curl -i -X POST https://你的代理/v2/proxy \
  -H "Authorization: Bearer $WECHAT_PROXY_TOKEN" \
  -H 'X-Proxy-Target: https://api.weixin.qq.com/cgi-bin/stable_token' \
  -H 'X-Proxy-Method: POST' \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credential","appid":"x","secret":"y"}'
```

## 8. 变更流程

增加微信接口调用通常不需要改代理代码。只有新增主机、协议、端口或方法时才调整 `PROXY_V2_*` 策略；转发语义、限制或认证变化则必须同时发布代理服务并更新本文。
