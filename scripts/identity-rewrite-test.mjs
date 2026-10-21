/**
 * 网关身份指纹改写的回归。
 *
 * 只验证**规则匹配与等价性**，不发网络请求：触发词边界来自 issue #560 的实测，
 * 这里固化的是"改写发生了且语义等价"，不重复验证上游是否仍在校验（那属于线上探测）。
 */
import assert from 'node:assert/strict'

const { IDENTITY_REWRITES, rewriteIdentityPrompt, needsIdentityRewrite } =
  await import('../vendor/channel-pack/pack.js')

let checks = 0
async function check(name, run) { await run(); checks++; console.log(`ok  ${name}`) }

const DSH_OPENER = 'You are an AI agent powered by DeepSeek Harness.'

try {
  await check('DSH 固定首句在 buddy 渠道被等价改写', async () => {
    const out = rewriteIdentityPrompt(DSH_OPENER, 'buddy')
    assert.notEqual(out, DSH_OPENER, '必须发生改写，否则上游会 400')
    // 等价性：仍然声明身份、仍提到 DeepSeek Harness，只是措辞不同
    assert.match(out, /DeepSeek Harness/)
    assert.doesNotMatch(out, /AI agent powered by DeepSeek Harness/, '触发短语必须消失')
  })

  await check('改写对其它渠道不生效（不误伤 workbuddy 等）', async () => {
    assert.equal(rewriteIdentityPrompt(DSH_OPENER, 'workbuddy'), DSH_OPENER)
    assert.equal(rewriteIdentityPrompt(DSH_OPENER, 'cline'), DSH_OPENER)
  })

  await check('未命中触发词时原样返回（同一引用，零拷贝）', async () => {
    const plain = 'You are a helpful assistant.'
    assert.equal(rewriteIdentityPrompt(plain, 'buddy'), plain)
    // 单词级不触发：单独出现 DeepSeek Harness 不算
    const partial = 'This project uses DeepSeek Harness internally.'
    assert.equal(rewriteIdentityPrompt(partial, 'buddy'), partial)
  })

  await check('长 system prompt 中的触发句被替换，其余内容完整保留', async () => {
    const full = [
      DSH_OPENER,
      '',
      'You are a coding agent operating in a workspace.',
      'Working directory: /tmp/project',
      DSH_OPENER,
    ].join('\n')
    const out = rewriteIdentityPrompt(full, 'buddy')
    assert.doesNotMatch(out, /AI agent powered by DeepSeek Harness/)
    assert.match(out, /You are a coding agent operating in a workspace/, '无关内容不得改动')
    assert.match(out, /Working directory: \/tmp\/project/, '无关内容不得改动')
    // 两处出现都应被替换（split/join 语义）
    assert.equal(out.split('You are an AI assistant powered by DeepSeek Harness.').length - 1, 2)
  })

  await check('needsIdentityRewrite 与改写结果一致', async () => {
    assert.equal(needsIdentityRewrite(DSH_OPENER, 'buddy'), true)
    assert.equal(needsIdentityRewrite(DSH_OPENER, 'workbuddy'), false)
    assert.equal(needsIdentityRewrite('You are a helpful assistant.', 'buddy'), false)
  })

  await check('规则表结构完整，可被外部审计与扩展', async () => {
    assert.ok(Array.isArray(IDENTITY_REWRITES) && IDENTITY_REWRITES.length > 0)
    for (const rule of IDENTITY_REWRITES) {
      assert.equal(typeof rule.from, 'string')
      assert.equal(typeof rule.to, 'string')
      assert.equal(typeof rule.note, 'string', '每条规则都要留下出处，便于上游改判后清理')
      assert.notEqual(rule.from, rule.to, '触发词与替换词相同会导致死循环式误改')
    }
  })
} finally {
  console.log(`identity-rewrite: ${checks}/${checks} 项通过`)
}
