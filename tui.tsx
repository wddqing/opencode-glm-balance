// GLM 套餐余额侧边栏插件
// 数据来源: GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
// 认证方式: Authorization: <apiKey>(裸值,不带 Bearer 前缀)
// API Key 获取优先级:
//   1. 环境变量 GLM_API_KEY / ZHIPU_API_KEY / BIGMODEL_API_KEY
//   2. 自动扫描全局 opencode.json(c) 中 baseURL 含 bigmodel.cn / z.ai 的供应商 apiKey
// 显示内容: 套餐等级、5 小时窗口剩余、每周窗口剩余、重置倒计时
// 显示条件: 仅当当前选择的模型为 GLM(glm-* 或 zhipu/zai/bigmodel 供应商)时渲染,切换模型时自动显隐
// 命令: /glm-balance 或命令面板中的"刷新 GLM 套餐余额"可手动刷新

import { Plugin } from "@opencode/plugin/tui"
import { Show, createSignal } from "solid-js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type Limit = {
  type?: string
  unit?: number
  number?: number
  usage?: number
  currentValue?: number
  remaining?: number
  percentage?: number
  nextResetTime?: number
}

type QuotaState = {
  level: string
  h5?: Limit
  week?: Limit
  fetchedAt: number
}

const QUOTA_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
const REFRESH_MS = 5 * 60 * 1000
const TICK_MS = 30 * 1000
const REQUEST_TIMEOUT_MS = 10 * 1000
const BAR_LENGTH = 10

function apiKeyFromGlobalConfig(): string | undefined {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    try {
      const file = path.join(base, "opencode", name)
      if (!fs.existsSync(file)) continue
      const raw = fs.readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "")
      const cfg = JSON.parse(raw)
      for (const provider of Object.values(cfg?.provider ?? {})) {
        const options = (provider as any)?.options ?? {}
        const baseURL = String(options.baseURL ?? "")
        const apiKey = options.apiKey
        const isGLM = baseURL.includes("bigmodel.cn") || baseURL.includes("z.ai")
        if (isGLM && typeof apiKey === "string" && apiKey.length > 0) return apiKey
      }
    } catch {
      // 单个配置文件解析失败时继续尝试下一个
    }
  }
  return undefined
}

function resolveApiKey(): string | undefined {
  return (
    process.env.GLM_API_KEY ||
    process.env.ZHIPU_API_KEY ||
    process.env.BIGMODEL_API_KEY ||
    apiKeyFromGlobalConfig()
  )
}

// 从 limits 中识别 5 小时窗口与每周窗口。
// 新版积分套餐: CREDIT_LIMIT,unit=3 为小时窗、unit=6 为周窗;
// 旧版套餐: TOKENS_LIMIT 按 nextResetTime 升序,最近一次为 5 小时窗,其后为周窗。
function pickWindows(limits: Limit[]): { h5?: Limit; week?: Limit } {
  const byReset = [...limits].sort(
    (a, b) => (a.nextResetTime ?? Number.POSITIVE_INFINITY) - (b.nextResetTime ?? Number.POSITIVE_INFINITY),
  )
  const credit = byReset.filter((l) => l.type === "CREDIT_LIMIT")
  const tokens = byReset.filter((l) => l.type === "TOKENS_LIMIT")
  const h5 = credit.find((l) => l.unit === 3) ?? credit[0] ?? tokens[0]
  const week = credit.find((l) => l.unit === 6) ?? credit.find((l) => l !== h5) ?? tokens[1]
  return { h5, week }
}

async function fetchQuota(apiKey: string): Promise<QuotaState> {
  const res = await fetch(QUOTA_URL, {
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      "Accept-Language": "en-US,en",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body: any = await res.json()
  if (!body?.data) throw new Error(String(body?.msg ?? "响应缺少 data 字段"))
  const limits: Limit[] = Array.isArray(body.data.limits) ? body.data.limits : []
  return {
    level: String(body.data.level ?? "plan"),
    ...pickWindows(limits),
    fetchedAt: Date.now(),
  }
}

// 已用百分比,percentage 缺失时用 currentValue/usage 兜底计算
function usedPercent(limit?: Limit): number {
  if (!limit) return 0
  if (typeof limit.percentage === "number") return limit.percentage
  if (limit.usage && limit.usage > 0) return Math.round(((limit.currentValue ?? 0) / limit.usage) * 100)
  return 0
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function bar(leftPercent: number): string {
  const filled = Math.round((clampPercent(leftPercent) / 100) * BAR_LENGTH)
  return "█".repeat(filled) + "░".repeat(BAR_LENGTH - filled)
}

function formatCountdown(targetMs?: number, nowMs = Date.now()): string {
  if (!targetMs) return ""
  const diff = targetMs - nowMs
  if (diff <= 0) return "即将重置"
  const minutes = Math.floor(diff / 60000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}天${hours}小时`
  if (hours > 0) return `${hours}小时${mins}分`
  return `${mins}分钟`
}

export default Plugin.define({
  id: "glm.balance",
  async setup(context) {
    const [quota, setQuota] = createSignal<QuotaState | null>(null)
    const [error, setError] = createSignal<string | null>(null)
    const [now, setNow] = createSignal(Date.now())

    const apiKey = resolveApiKey()

    // 当前模型是否为 GLM;ui.model.current() 在 Solid 响应式作用域中读取,切换模型时自动更新
    const isGLMModel = (): boolean => {
      const model: any = (context.ui as any)?.model?.current?.()
      if (!model) return false
      const providerID = String(model.providerID ?? "")
      const modelID = String(model.modelID ?? model.id ?? "")
      return /glm/i.test(modelID) || /zhipu|zai|bigmodel/i.test(providerID)
    }

    async function refresh() {
      if (!apiKey) {
        setError("未找到 GLM API Key,可设置环境变量 GLM_API_KEY")
        return
      }
      try {
        setQuota(await fetchQuota(apiKey))
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    await refresh()
    const refreshTimer = setInterval(refresh, REFRESH_MS)
    const tickTimer = setInterval(() => setNow(Date.now()), TICK_MS)

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "glm.balance.refresh",
          title: "刷新 GLM 套餐余额",
          palette: true,
          slash: { name: "glm-balance" },
          run: () => refresh(),
        },
      ],
    }))

    const textTokens: any = (context.theme as any)?.text ?? {}
    const baseColor = () => textTokens.base
    const mutedColor = () => textTokens.muted ?? textTokens.base

    const unregister = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <Show when={isGLMModel()}>
          <Show
            when={quota()}
            fallback={
              <Show when={error()}>
                <text fg={mutedColor()}>GLM 余额: {error()}</text>
              </Show>
            }
          >
          <box flexDirection="column">
            <text fg={baseColor()}>GLM {(quota()?.level ?? "plan").toUpperCase()} 套餐</text>
            <Show when={quota()?.h5}>
              <text fg={mutedColor()}>
                {`5h ${bar(100 - usedPercent(quota()?.h5))} 剩${100 - usedPercent(quota()?.h5)}%`}
              </text>
            </Show>
            <Show when={quota()?.week}>
              <text fg={mutedColor()}>
                {`周 ${bar(100 - usedPercent(quota()?.week))} 剩${100 - usedPercent(quota()?.week)}%`}
              </text>
            </Show>
            <Show when={quota()?.h5?.nextResetTime}>
              <text fg={mutedColor()}>{`5h重置 ${formatCountdown(quota()?.h5?.nextResetTime, now())}`}</text>
            </Show>
            <Show when={quota()?.week?.nextResetTime}>
              <text fg={mutedColor()}>{`周重置 ${formatCountdown(quota()?.week?.nextResetTime, now())}`}</text>
            </Show>
          </box>
          </Show>
        </Show>
      ),
    })

    return () => {
      unregister()
      clearInterval(refreshTimer)
      clearInterval(tickTimer)
    }
  },
})
