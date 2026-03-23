# Gate 永续合约多周期形态筛选助手

这是一个本地可运行的 Gate 永续合约筛选平台，用来做行情筛选、展示、监控和提醒。

系统当前只做以下事情：
- 扫描 Gate USDT 永续合约
- 按多周期规则筛选信号
- 在单页面统一表格里展示结果
- 展示 K 线、均线、AI 总览与历史分析
- 支持手动刷新、定时轮询、浏览器提醒、Webhook 提醒

系统当前明确不做：
- 自动交易
- 自动下单、撤单、止盈止损
- 账户资产管理
- 私有交易接口闭环

## 当前能力

- Gate 永续合约列表扫描
- 多周期筛选，包含原生周期与本地聚合周期
- 均线收拢、MA 抬头、上穿、斜率过滤
- 单页面统一结果表
- 行内 K 线缩略图与弹窗图表
- 首页 15 分钟 AI 总览
- LLM 历史分析页面
- 自选列表
- Webhook 去重提醒
- 15 分钟自动监控

## 技术栈

- 前端：React + TypeScript + Vite
- 后端：Express + TypeScript
- 图表：ECharts
- 实时行情：Gate WebSocket
- AI 摘要：Qwen OpenAI Compatible API

## 目录说明

```text
.
├─ src/                  前端页面与组件
├─ server/               后端服务、筛选引擎、LLM 历史与提醒逻辑
├─ shared/               前后端共享类型
├─ docs/                 PRD、API、部署说明等文档
├─ .env.example          环境变量模板
└─ README.md             项目说明
```

## 启动方式

### 1. 安装依赖

```bash
npm install
```

### 2. 准备环境变量

复制一份环境变量模板：

```bash
copy .env.example .env
```

如果你只想运行基础筛选功能，可以先不填 `QWEN_*`。

### 3. 开发模式

```bash
npm run dev
```

开发模式通常会启动：
- 前端开发服务：`http://localhost:5173`
- 后端服务：`http://localhost:8787`

### 4. 生产模式

```bash
npm run build
npm run start
```

推荐直接访问：

- 主页面：`http://localhost:8787`
- 健康检查：`http://localhost:8787/api/health`

## 环境变量

参考 [`.env.example`](C:/Users/Administrator/Desktop/欧易开发/.env.example)：

```env
GATE_API_BASE_URLS=https://fx-api.gateio.ws/api/v4,https://api.gateio.ws/api/v4
VITE_API_BASE_URL=http://localhost:8787
VITE_GATE_WS_URL=wss://fx-ws.gateio.ws/v4/ws/usdt
QWEN_API_KEY=
QWEN_BASE_URL=
QWEN_MODEL=qwen3.5-plus
```

说明：
- `GATE_API_BASE_URLS`：Gate 公共 REST 行情地址，可配置多个备用地址
- `VITE_API_BASE_URL`：前端请求后端的基础地址，推荐固定为 `http://localhost:8787`
- `VITE_GATE_WS_URL`：Gate 实时行情 WebSocket
- `QWEN_*`：可选，启用首页 AI 总览和单币摘要

## 主要页面

### 筛选面板

- 首页 AI 总览
- 筛选条件配置
- 统一结果表
- 图表弹窗
- 自选按钮

### LLM 历史分析

- 查看首页 AI 总览历史
- 查看单币种历史摘要
- 按类型筛选
- 按关键词搜索

## 主要接口

- `GET /api/health`
- `GET /api/snapshot`
- `GET /api/results`
- `GET /api/chart/:instId`
- `PUT /api/settings`
- `POST /api/scan/run`
- `POST /api/monitor/toggle`
- `GET /api/alerts`
- `GET /api/watchlist`
- `POST /api/watchlist/toggle`
- `GET /api/llm-history`

更详细的接口说明见：
- [API.md](C:/Users/Administrator/Desktop/欧易开发/docs/API.md)

## 数据持久化

运行时会在本地生成以下数据：

- `server/data/config.json`
- `server/data/runtime.json`
- `server/data/llm-history/`

这些属于本地运行缓存和历史记录，已经在 `.gitignore` 中排除，不会随源码一起提交。

## 测试与构建

运行测试：

```bash
npm test
```

构建前端与后端：

```bash
npm run build
```

## 文档

- [PRD.md](C:/Users/Administrator/Desktop/欧易开发/docs/PRD.md)
- [API.md](C:/Users/Administrator/Desktop/欧易开发/docs/API.md)
- [DEPLOY.md](C:/Users/Administrator/Desktop/欧易开发/docs/DEPLOY.md)
- [CODEX_EXECUTION_PROMPT.md](C:/Users/Administrator/Desktop/欧易开发/docs/CODEX_EXECUTION_PROMPT.md)
- [给Codex的可执行操作文件.md](C:/Users/Administrator/Desktop/欧易开发/docs/给Codex的可执行操作文件.md)
- [给Codex的一句话总提示词.md](C:/Users/Administrator/Desktop/欧易开发/docs/给Codex的一句话总提示词.md)

## 注意事项

- 当前版本主数据源是 Gate 公共行情接口
- 市值与排名来自第三方市场数据源，失败时会降级
- 如果开启 Qwen，请确保 `QWEN_API_KEY` 和 `QWEN_BASE_URL` 可用
- 请不要把 `.env`、API Key、Secret 提交到 Git 仓库
