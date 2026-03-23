# OKX API 研究记录（2026-03-20）

来源：

- 官方中文接入文档：[https://my.okx.com/docs-v5/zh/](https://my.okx.com/docs-v5/zh/)
- 官方 WebSocket 订阅章节：[https://www.okx.com/docs-v5/zh/#overview-websocket-subscribe](https://www.okx.com/docs-v5/zh/#overview-websocket-subscribe)
- 官方技巧文档：[https://my.okx.com/docs-v5/trick_zh/](https://my.okx.com/docs-v5/trick_zh/)
- 官方更新日志：[https://my.okx.com/docs-v5/log_zh/](https://my.okx.com/docs-v5/log_zh/)

已下载到本地：

- [okx-docs-v5-zh.html](C:/Users/Administrator/Desktop/欧易开发/docs/okx/okx-docs-v5-zh.html)
- [okx-docs-v5-trick-zh.html](C:/Users/Administrator/Desktop/欧易开发/docs/okx/okx-docs-v5-trick-zh.html)
- [okx-docs-v5-log-zh.html](C:/Users/Administrator/Desktop/欧易开发/docs/okx/okx-docs-v5-log-zh.html)

## 1. 当前筛选工具最相关的接口

### 公共 REST

1. 获取永续合约清单

- 接口：`GET /api/v5/public/instruments`
- 关键参数：`instType=SWAP`
- 用途：拉取 OKX 永续合约全量列表，作为筛选 Universe。

2. 获取 K 线

- 接口：`GET /api/v5/market/candles`
- 关键参数：`instId`、`bar`、`before/after`、`limit`
- 文档显示的本项目直接可用周期：`15m / 1H / 2H / 4H`
- `limit` 最大 `300`
- 备注：官方文档未直接列出 `3H` bar，因此项目继续使用 `1H` 已收盘 K 线本地聚合 `3H`。

3. 获取全量行情

- 接口：`GET /api/v5/market/tickers`
- 关键参数：`instType=SWAP`
- 用途：后续可用来补充最新价、24h 数据、排序信息。

### 公共 WebSocket

1. 订阅协议

- 连接后发送：
  - `{\"id\":\"xxx\",\"op\":\"subscribe\",\"args\":[...]}`
- 取消订阅：
  - `{\"id\":\"xxx\",\"op\":\"unsubscribe\",\"args\":[...]}`

2. 保活

- 如果连接成功后 30 秒未订阅，或订阅后 30 秒内没有收到推送，连接可能被服务端断开。
- 建议在一段时间内未收到消息时发送字符串 `ping`，期待收到 `pong`。

3. 公共频道建议

- `instruments`
  - 用途：监听永续合约新增、下线、状态变化。
  - 推荐参数：`{\"channel\":\"instruments\",\"instType\":\"SWAP\"}`
- `tickers`
  - 用途：实时最新价、成交量等。
  - 推荐参数：按 `instId` 精确订阅，避免一次性订阅过多。
- K 线频道
  - 文档列出了频道名称模式，例如：`candle15m`、`candle1H`、`candle2H`、`candle4H`
  - 用途：替换当前 15 分钟轮询中的部分 REST 抓取，降低延迟
  - 备注：`3H` 仍建议本地聚合

### 私有 REST / 私有 WebSocket

这些是后续接入账户 API、自动提醒增强、未来自动交易时会用到的核心接口：

1. REST 私有鉴权

- 请求头需要：
  - `OK-ACCESS-KEY`
  - `OK-ACCESS-SIGN`
  - `OK-ACCESS-TIMESTAMP`
  - `OK-ACCESS-PASSPHRASE`
- 签名规则：
  - `timestamp + method + requestPath + body`
  - 使用 `HMAC SHA256`
  - 再 `Base64` 编码

2. WebSocket 私有登录

- 登录 `op=login`
- 参数包含：
  - `apiKey`
  - `passphrase`
  - `timestamp`
  - `sign`

3. 后续可能会接入的交易/账户接口

- `GET /api/v5/account/balance`
- `GET /api/v5/account/positions`
- `POST /api/v5/account/set-leverage`
- `POST /api/v5/trade/order`
- `GET /api/v5/trade/order`
- `GET /api/v5/trade/orders-pending`
- `WS / orders` 订单频道
- `WS / account` 账户频道
- `WS / positions` 持仓频道

## 2. 对当前项目的落地建议

### 现在就可以做的

- 继续用 REST `public/instruments + market/candles` 做主筛选
- 继续保留 `3H = 1H 聚合`
- 用公共 WebSocket 补充：
  - `instruments`
  - `tickers`
  - `candle15m / candle1H / candle2H / candle4H`

### 下一阶段推荐架构

1. 市场数据层

- 启动时 REST 全量拉取一次
- 正常运行后转为 WebSocket 增量更新
- 本地维护每个 `instId + timeframe` 的滚动 K 线缓存

2. 筛选引擎

- 每次收到新 K 线闭合后重算：
  - `MA5`
  - `MA20`
  - 收拢度
  - MA5 斜率
  - 价格是否上穿 MA5

3. 智能提醒层

- 新命中时调用 LLM 做二次摘要
- 再通过浏览器通知 / Webhook / 企业微信 / 钉钉 推送

4. 未来自动交易层

- 必须单独增加：
  - 下单白名单
  - 风控阈值
  - 杠杆限制
  - 持仓检查
  - 重复下单保护
  - 模拟盘联调

## 3. 密钥处理约定

- 真实 `OKX API Key / Secret / Passphrase` 和 `Qwen API Key` 不写入代码文件。
- 统一写入本地 `.env.local` 或 `.env`。
- 项目里只保留 [`.env.example`](C:/Users/Administrator/Desktop/欧易开发/.env.example) 模板。
- 如果之前发送的是正式可用密钥，建议你去 OKX 后台重新生成一套新的密钥后再给我接入。
