# 部署说明

## 本地开发

前端：

```bash
npm run dev:client
```

后端：

```bash
npm run dev:server
```

或同时启动：

```bash
npm run dev
```

## 生产构建

```bash
npm run build
npm run start
```

## 环境变量

参考：

- [`.env.example`](C:/Users/Administrator/Desktop/欧易开发/.env.example)

当前版本无需 OKX API Key 即可运行，因为只使用 OKX 公共行情接口。

## 后续接入 Qwen

当前版本未启用 LLM 分析。若后续提供 `Qwen` 接口，可新增：

- `QWEN_API_KEY`
- `QWEN_BASE_URL`
- `QWEN_MODEL`

用于：

- 命中结果二次摘要
- 风险提示文本
- 推送消息优化
