# 转发代理参考实现

`wechat_proxy.py` 是 [转发代理契约](../../docs/proxy-contract.md) 的可直接使用的实现。

放在这里而不是直接放进 `services/yt-dlp-fastapi/`，是因为那个路径是 submodule 挂载点：目录非空会导致 `git submodule add` 失败。

## 接入

1. 把 `wechat_proxy.py` 复制进 `yt_dlp_fastapi` 仓库。
2. 挂载 router：

```python
from wechat_proxy import router as wechat_router

app.include_router(wechat_router)
```

3. 确认依赖里有 `httpx`。
4. 配置环境变量：

| 变量 | 说明 |
| --- | --- |
| `WECHAT_PROXY_TOKEN` | Bearer 令牌，与调用方的 `WECHAT_PROXY_TOKEN` 一致 |
| `WECHAT_PROXY_ALLOW_DELETE` | 设为 `true` 才放行删除素材，默认关闭 |

代理**不需要**微信凭据。

## 部署前必须确认的三件事

**目标主机不可配置。** `WECHAT_ORIGIN` 写死在代码里。若改成从请求头或参数读取，它立刻变成开放代理：别人可以借这台机器的 IP 攻击第三方，或访问内网服务。

**路径白名单要保持最小。** 因为微信侧有 IP 白名单，能访问到这个代理就等于能操作公众号。白名单里没有群发接口，所以令牌泄露不会变成群发。加路径前先问一句：这条路径泄露后最坏会发生什么。

**日志不能记 query 和请求体。** `access_token` 在 query 里，AppSecret 在 token 请求的 body 里。除了本模块自己的日志，还要检查：

- uvicorn 的 access log（默认会记录完整路径含 query）
- 前面的 Nginx / Caddy 反向代理
- 任何 APM 或错误上报 SDK

三者任意一个记全 URL，凭据就落盘了。

## 自检

部署后从本地验证，不要用生产账户：

```bash
# 应当返回 401
curl -i https://你的代理/wechat/cgi-bin/stable_token

# 应当返回 403
curl -i -H "Authorization: Bearer $WECHAT_PROXY_TOKEN" \
  https://你的代理/wechat/cgi-bin/message/mass/send

# 应当返回微信的真实响应（凭据错误时是带 errcode 的 HTTP 200）
curl -i -H "Authorization: Bearer $WECHAT_PROXY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credential","appid":"x","secret":"y"}' \
  https://你的代理/wechat/cgi-bin/stable_token
```

第三条返回 HTTP 200 且 body 里有 `errcode` 才算对 —— 这说明代理是原样透传的，没有替调用方「处理」错误。
