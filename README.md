# opencode-glm-balance

在 [OpenCode](https://opencode.ai) TUI 侧边栏显示智谱 GLM Coding Plan 套餐余额的插件。

## 功能

- 显示套餐等级（Lite / Pro / Max）
- 5 小时窗口、每周窗口的剩余额度进度条与百分比
- 两个窗口的重置倒计时
- 仅当前模型为 GLM 时显示，切换模型自动显隐
- 每 5 分钟自动刷新，倒计时每 30 秒更新
- 命令面板"刷新 GLM 套餐余额"或 `/glm-balance` 手动刷新

## 显示效果

```
GLM LITE 套餐
5h ████████░░ 剩84%
周 ████████░░ 剩75%
5h重置 50分钟
周重置 1天20小时
```

## 安装

将本仓库克隆到 OpenCode 全局插件目录（目录名保持 `glm-balance`）：

```sh
git clone git@github.com:wddqing/opencode-glm-balance.git \
  ~/.config/opencode/plugins/glm-balance
```

重启 OpenCode 后生效。插件通过全局插件目录自动发现加载，无需修改 `cli.json`。

## API Key 配置

按以下优先级自动获取，通常无需任何配置：

1. 环境变量 `GLM_API_KEY` / `ZHIPU_API_KEY` / `BIGMODEL_API_KEY`
2. 自动扫描全局 `~/.config/opencode/opencode.json(c)` 中 `baseURL` 含 `bigmodel.cn` / `z.ai` 的供应商 `apiKey`

## 数据来源

智谱开放平台用量接口（与官方 glm-plan-usage 插件一致）：

```
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
Authorization: <apiKey>
```

同时兼容新版积分套餐（`CREDIT_LIMIT`）与旧版套餐（`TOKENS_LIMIT`）。接口异常时侧边栏显示灰色错误信息，不影响 TUI 使用。

## 平台支持

目前支持国内 BigModel（open.bigmodel.cn）。国际版 Z.ai 端点结构相同，可自行修改 `tui.tsx` 中的 `QUOTA_URL`。
