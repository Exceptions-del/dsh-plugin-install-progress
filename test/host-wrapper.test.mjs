import { strict as assert } from 'node:assert'

const mod = await import(new URL('../index.js', import.meta.url))

const MARKER = 'plugin-install-progress'

function makeCtx(manager) {
  const events = []
  const cleanups = []
  const ctx = {
    pluginManager: manager,
    emit(name, payload) { events.push({ name, payload }) },
    effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); return dispose },
  }
  return { ctx, events, cleanups }
}

// 1. Agent-style call (no requestId) is bracketed with marker chunks.
{
  const calls = []
  const manager = {
    async installBundle(spec, options) {
      calls.push({ spec, options })
      return { application: 'applied', bundle: spec }
    },
  }
  const { ctx, events, cleanups } = makeCtx(manager)
  mod.apply(ctx)
  assert.equal(typeof manager.installBundle, 'function')
  const patched = manager.installBundle
  assert.notEqual(patched, Object.getPrototypeOf(manager).installBundle)
  const result = await manager.installBundle('@acme/thing@1.0.0', { enabled: true })
  assert.deepEqual(result, { application: 'applied', bundle: '@acme/thing@1.0.0' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].spec, '@acme/thing@1.0.0')
  assert.equal(calls[0].options.enabled, true)
  assert.match(calls[0].options.requestId, /^install-progress-/)
  assert.equal(events.length, 2)
  assert.equal(events[0].name, 'plugin-manager/install-log')
  assert.deepEqual(events[0].payload.argv, [MARKER])
  assert.equal(events[0].payload.requestId, calls[0].options.requestId)
  assert.deepEqual(JSON.parse(events[0].payload.text), { kind: 'start', spec: '@acme/thing@1.0.0' })
  assert.deepEqual(JSON.parse(events[1].payload.text), { kind: 'end', ok: true, application: 'applied' })
  assert.equal(events[1].payload.exitCode, 0)

  // Cleanup restores the original method.
  for (const dispose of cleanups) dispose()
  assert.equal(manager.installBundle, manager.installBundle) // unchanged reference check below
  assert.notEqual(manager.installBundle, patched)
}

// 2. A caller-supplied request id passes through untouched.
{
  const calls = []
  const manager = { async installBundle(spec, options) { calls.push(options); return { application: 'applied' } } }
  const { ctx, events } = makeCtx(manager)
  mod.apply(ctx)
  await manager.installBundle('@acme/thing', { requestId: 'page-owned' })
  assert.equal(calls[0].requestId, 'page-owned')
  assert.equal(events.length, 0)
}

// 3. Failure reports an end marker and rethrows.
{
  const manager = { async installBundle() { throw new Error('pnpm exploded\nsecond line') } }
  const { ctx, events } = makeCtx(manager)
  mod.apply(ctx)
  await assert.rejects(() => manager.installBundle('@acme/thing'), /pnpm exploded/)
  const end = JSON.parse(events.at(-1).payload.text)
  assert.equal(end.kind, 'end')
  assert.equal(end.ok, false)
  assert.equal(end.reason, 'pnpm exploded')
}

// 4. A refused installation result (application failed) is reported as failed.
{
  const manager = { async installBundle() { return { application: 'failed', error: { code: 'not-bundle' } } } }
  const { ctx, events } = makeCtx(manager)
  mod.apply(ctx)
  await manager.installBundle('@acme/plain')
  const end = JSON.parse(events.at(-1).payload.text)
  assert.deepEqual(end, { kind: 'end', ok: false, application: 'failed', code: 'not-bundle' })
  assert.equal(events.at(-1).payload.exitCode, 1)
}

// 4b. A package-manager kind and pending builds ride the end marker without
// colliding with the message envelope's own `kind`.
{
  const manager = {
    async installBundle() {
      return { application: 'failed', error: { code: 'operation-error' }, packageResult: { kind: 'build-blocked' }, pendingBuilds: ['esbuild', 'sharp'] }
    },
  }
  const { ctx, events } = makeCtx(manager)
  mod.apply(ctx)
  await manager.installBundle('@acme/scripts')
  const end = JSON.parse(events.at(-1).payload.text)
  assert.equal(end.kind, 'end')
  assert.equal(end.failure, 'build-blocked')
  assert.equal(end.pending, 2)
}

// 5. Patching the raw target behind a Cordis-style proxy works and does not double-wrap.
{
  const original = async function (spec, options) { return { application: 'applied', spec, options } }
  const target = { installBundle: original }
  const proxy = new Proxy(target, {
    get(obj, prop) { if (prop === Symbol.for('cordis.original')) return obj; return Reflect.get(obj, prop) },
    set(obj, prop, value) { return Reflect.set(obj, prop, value) },
  })
  const { ctx, events } = makeCtx(proxy)
  mod.apply(ctx)
  mod.apply(ctx)
  const result = await proxy.installBundle('@acme/proxied')
  assert.equal(result.application, 'applied')
  assert.equal(events.length, 2)
}

console.log('host wrapper: all checks passed')
