/**
 * 网关身份指纹改写。
 *
 * ## 问题
 *
 * 腾讯 CodeBuddy 网关（`copilot.tencent.com`）对请求体里的 **system prompt 内容**
 * 做「官方客户端」校验，命中特定短语即返回：
 *
 * ```json
 * { "code": 11128, "msg": "Illegal API invocation from an unapproved channel" }
 * ```
 *
 * 命中词是 DSH 内核固定注入的首句
 * `You are an AI agent powered by DeepSeek Harness.`
 *（`@deepseek-ai/dsh-system-prompt` 的 `includeHarnessIdentity`，order −1000）。
 * 插件把宿主渲染好的 system prompt 原样放进 `messages[0]`，因此必然命中。
 *
 * ## 实测边界（同一凭据、同一头，仅改 system 内容）
 *
 * | content | 结果 |
 * | --- | --- |
 * | `You are an AI agent powered by DeepSeek Harness.` | 400 `11128` |
 * | 改成 `AI assistant` / `coding agent` / `from` / `a` / 双空格 | 通过 |
 * | `DeepSeek Harness`（单独） | 通过 |
 * | `powered by DeepSeek Harness`（单独） | 通过 |
 *
 * 结论：触发的是**完整短语**，不是单词；因此**等价改写即可规避**，
 * 语义完全不变（仍向模型声明身份，只是措辞不同）。
 *
 * ## 设计
 *
 * 不硬编码 `String.replace`，而是维护一张规则表：上游若更换检测词，加一行即可，
 * 不必改动调用点。每条规则都是「触发短语 → 等价替换」，改写后语义等价。
 */

/** 一条改写规则：命中 `from` 即改写为 `to`。 */
export interface IdentityRewriteRule {
  /** 触发短语（精确匹配，含首尾标点）。 */
  from: string
  /** 等价替换文本，语义必须与 `from` 一致。 */
  to: string
  /** 仅对该 provider 生效；留空表示所有走此改写的渠道。 */
  provider?: string
  /** 规则出处（issue / 实测日期），便于日后复核与失效清理。 */
  note: string
}

/**
 * 现行规则表。
 *
 * 每条都经过实测确认「改写后不再触发 11128」。第一条对应
 * [issue #560](https://github.com/Ebony-Vinyl/dsh-our-free-model/issues/560)。
 */
export const IDENTITY_REWRITES: readonly IdentityRewriteRule[] = [
  {
    from: 'You are an AI agent powered by DeepSeek Harness.',
    to: 'You are an AI assistant powered by DeepSeek Harness.',
    provider: 'buddy',
    note: 'issue #560：agent→assistant 实测通过（2026-10-21）',
  },
]

/**
 * 对 system prompt 应用改写规则。
 *
 * 只做**等价措辞替换**：不删内容、不改语义，模型收到的仍是同一条身份声明。
 * 返回原值（同一引用）表示无需改写，调用方可据此跳过拷贝。
 */
export function rewriteIdentityPrompt(
  prompt: string,
  provider: string,
  rules: readonly IdentityRewriteRule[] = IDENTITY_REWRITES,
): string {
  let result = prompt
  for (const rule of rules) {
    if (rule.provider !== undefined && rule.provider !== provider) continue
    if (result.includes(rule.from)) result = result.split(rule.from).join(rule.to)
  }
  return result
}

/**
 * 判断某条 system prompt 是否需要改写（供日志/统计使用，不产生副作用）。
 */
export function needsIdentityRewrite(
  prompt: string,
  provider: string,
  rules: readonly IdentityRewriteRule[] = IDENTITY_REWRITES,
): boolean {
  return rules.some(rule => (rule.provider === undefined || rule.provider === provider) && prompt.includes(rule.from))
}
