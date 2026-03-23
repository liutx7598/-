# API 文档

## 已实现接口

### 健康检查

- `GET /api/health`

### 仪表盘快照

- `GET /api/snapshot`

返回：

- 当前配置
- 当前命中结果
- 统计信息
- 监控状态
- LLM 是否启用

### 结果列表

- `GET /api/results`

查询参数：

- `page`
- `pageSize`
- `keyword`
- `bars=15m,1H,2H,3H,4H`
- `onlyMatched=true|false`
- `sortBy`
- `sortOrder=asc|desc`

### 单个图表

- `GET /api/chart/{instId}?bar=15m&limit=80`

### 获取配置

- `GET /api/config`
- `GET /api/settings`

### 更新配置

- `PUT /api/config`
- `PUT /api/settings`

### 手动扫描

- `POST /api/refresh`
- `POST /api/scan/run`

### 监控开关

- `POST /api/monitor/toggle`

请求体：

```json
{
  "enabled": true
}
```

### 提醒

- `GET /api/alerts`
- `POST /api/alerts/test`
