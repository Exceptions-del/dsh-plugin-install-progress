import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const MARKER = 'plugin-install-progress'
const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

const style = { setAttribute() {}, textContent: '', remove() {} }
const document = { createElement: () => style, head: { appendChild() {} } }

let captured
const window = { __ModuleLoader__: { load: (options) => { captured = options } } }

vm.runInNewContext(code, {
  window,
  document,
  require: () => React,
  console,
  setInterval: () => 0,
  clearInterval: () => {},
  Date,
  JSON,
  Math,
  String,
  Number,
  Array,
  Object,
})

assert.ok(captured, 'client bundle registers a factory')
assert.equal(captured.id, '@local/plugin-install-progress')

const plugin = captured.factory(() => React)
assert.equal(JSON.stringify(plugin.inject), JSON.stringify(['slots', 'locale', 'remote']))

const handlers = {}
const clientHandlers = {}
const dictionaries = []
const registrations = []

const ctx = {
  effect(fn) { const dispose = fn(); return dispose },
  on(name, listener) { clientHandlers[name] = listener; return () => { delete clientHandlers[name] } },
  locale: { register(ns, dicts) { dictionaries.push({ ns, dicts }) } },
  remote: { $on(name, listener) { handlers[name] = listener; return () => { delete handlers[name] } } },
  slots: {
    inject(name, factory) { factory() },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  },
}

plugin.apply(ctx)

assert.equal(dictionaries.length, 1)
assert.equal(dictionaries[0].ns, 'pluginInstallProgress')
assert.ok(dictionaries[0].dicts.zh && dictionaries[0].dicts.en, 'both baseline dictionaries are registered')
assert.equal(registrations.length, 1)
const registration = registrations[0]
assert.equal(registration.options.name, 'conversation.input.dock')
assert.equal(registration.options.id, 'plugin-install-progress')
assert.equal(registration.options.locale, 'pluginInstallProgress')
const store = registration.options.inject().store
assert.ok(store, 'the registration injects the progress store')
assert.equal(typeof handlers['plugin-manager/install-log'], 'function')
assert.equal(typeof handlers['plugin-manager/install-state'], 'function')
assert.equal(typeof clientHandlers['connection/reset'], 'function')

const snapshot = () => store.getSnapshot()
const entry = (id) => snapshot().entries.find((item) => item.requestId === id)

// Nothing is shown for installs this plugin did not mark.
handlers['plugin-manager/install-log']({
  requestId: 'page-owned',
  argv: ['pnpm', 'add'],
  text: 'Progress: resolved 9, reused 9, downloaded 0',
})
assert.equal(snapshot().entries.length, 0)

// The Host marker opens one entry with its spec.
handlers['plugin-manager/install-log']({
  requestId: 'r1',
  jobId: MARKER,
  argv: [MARKER],
  text: JSON.stringify({ kind: 'start', spec: '@acme/example@2.0.0' }),
})
assert.equal(entry('r1').spec, '@acme/example@2.0.0')
assert.equal(entry('r1').phase, 'start')
assert.equal(entry('r1').percent, null)

handlers['plugin-manager/install-state']({
  requestId: 'r1',
  phase: 'installing',
  attempt: { registry: 'https://registry.npmjs.org/', index: 1, total: 2 },
})
assert.equal(entry('r1').phase, 'installing')
assert.equal(JSON.stringify(entry('r1').attempt), JSON.stringify({ index: 1, total: 2 }))
assert.equal(entry('r1').percent, null)

// pnpm package progress becomes a fraction that never walks backwards.
handlers['plugin-manager/install-log']({
  requestId: 'r1',
  argv: ['pnpm', 'add', '@acme/example@2.0.0'],
  text: 'Progress: resolved 10, reused 6, downloaded 2, added 0',
})
assert.equal(entry('r1').packages.resolved, 10)
assert.ok(Math.abs(entry('r1').percent - 0.8) < 1e-9)

handlers['plugin-manager/install-log']({
  requestId: 'r1',
  argv: ['pnpm', 'add', '@acme/example@2.0.0'],
  text: '\u001b[90mProgress: resolved 4, reused 1, downloaded 1, added 0\u001b[39m',
})
assert.ok(entry('r1').percent >= 0.8, 'a smaller later line cannot rewind the bar')

handlers['plugin-manager/install-log']({
  requestId: 'r1',
  argv: ['pnpm', 'add', '@acme/example@2.0.0'],
  text: 'Progress: resolved 12, reused 8, downloaded 4, added 6',
})
assert.equal(entry('r1').percent, 0.93, 'download completion is capped below applying')

// A cached install reports few reused packages; pnpm's `done` line still closes the
// gap instead of leaving the bar at the ratio.
handlers['plugin-manager/install-log']({
  requestId: 'r4',
  argv: [MARKER],
  text: JSON.stringify({ kind: 'start', spec: '@acme/cached' }),
})
handlers['plugin-manager/install-state']({ requestId: 'r4', phase: 'installing' })
handlers['plugin-manager/install-log']({
  requestId: 'r4',
  argv: ['pnpm', 'add'],
  text: 'Progress: resolved 201, reused 4, downloaded 0, added 4',
})
assert.ok(entry('r4').percent < 0.05)
handlers['plugin-manager/install-log']({
  requestId: 'r4',
  argv: ['pnpm', 'add'],
  text: 'Progress: resolved 201, reused 4, downloaded 0, added 4, done\nDone in 913ms using pnpm v11.28.5',
})
assert.equal(entry('r4').percent, 0.9)

handlers['plugin-manager/install-state']({ requestId: 'r1', phase: 'applying' })
assert.equal(entry('r1').phase, 'applying')
assert.equal(entry('r1').percent, 0.94)

handlers['plugin-manager/install-log']({
  requestId: 'r1',
  jobId: MARKER,
  argv: [MARKER],
  text: JSON.stringify({ kind: 'end', ok: true, application: 'applied' }),
  exitCode: 0,
})
assert.equal(entry('r1').phase, 'done')
assert.equal(entry('r1').percent, 1)
assert.equal(entry('r1').ok, true)

// A failed run keeps its last known fraction and reports the code.
handlers['plugin-manager/install-log']({
  requestId: 'r2',
  argv: [MARKER],
  text: JSON.stringify({ kind: 'start', spec: '@acme/broken' }),
})
handlers['plugin-manager/install-state']({ requestId: 'r2', phase: 'installing' })
handlers['plugin-manager/install-log']({
  requestId: 'r2',
  argv: ['pnpm', 'add'],
  text: 'Progress: resolved 6, reused 3, downloaded 1, added 0',
})
handlers['plugin-manager/install-log']({
  requestId: 'r2',
  argv: [MARKER],
  text: JSON.stringify({ kind: 'end', ok: false, application: 'failed', code: 'not-bundle' }),
  exitCode: 1,
})
assert.equal(entry('r2').phase, 'failed')
assert.ok(Math.abs(entry('r2').percent - 4 / 6) < 1e-9)
assert.equal(entry('r2').code, 'not-bundle')

// A package-manager failure kind is kept, and build-blocked is its own cause.
handlers['plugin-manager/install-log']({
  requestId: 'r5',
  argv: [MARKER],
  text: JSON.stringify({ kind: 'start', spec: '@acme/scripts' }),
})
handlers['plugin-manager/install-state']({ requestId: 'r5', phase: 'installing' })
handlers['plugin-manager/install-log']({
  requestId: 'r5',
  argv: [MARKER],
  text: JSON.stringify({ kind: 'end', ok: false, application: 'failed', code: 'operation-error', failure: 'build-blocked', pending: 2 }),
  exitCode: 1,
})
assert.equal(entry('r5').failure, 'build-blocked')
assert.equal(entry('r5').phase, 'failed')

// A cancelled application is its own state.
handlers['plugin-manager/install-log']({
  requestId: 'r3',
  argv: [MARKER],
  text: JSON.stringify({ kind: 'start', spec: '@acme/slow' }),
})
handlers['plugin-manager/install-state']({ requestId: 'r3', phase: 'cancelling' })
assert.equal(entry('r3').phase, 'cancelling')
handlers['plugin-manager/install-log']({
  requestId: 'r3',
  argv: [MARKER],
  text: JSON.stringify({ kind: 'end', ok: false, application: 'cancelled' }),
  exitCode: 1,
})
assert.equal(entry('r3').phase, 'cancelled')

// Downloads reuse the same forwarded event under their own marker.
handlers['plugin-manager/install-log']({
  requestId: 'd1',
  argv: ['download-progress'],
  text: JSON.stringify({ kind: 'start', url: 'https://example.com/files/big.bin', path: 'C:\\work\\downloads\\big.bin' }),
})
assert.equal(entry('d1').kind, 'download')
assert.equal(entry('d1').spec, 'big.bin')
assert.equal(entry('d1').phase, 'start')
assert.equal(entry('d1').received, 0)

handlers['plugin-manager/install-log']({
  requestId: 'd1',
  argv: ['download-progress'],
  text: JSON.stringify({ kind: 'progress', received: 500, total: 2000 }),
})
assert.equal(entry('d1').percent, 0.25)
handlers['plugin-manager/install-log']({
  requestId: 'd1',
  argv: ['download-progress'],
  text: JSON.stringify({ kind: 'progress', received: 2000, total: 2000 }),
})
assert.equal(entry('d1').percent, 1)
handlers['plugin-manager/install-log']({
  requestId: 'd1',
  argv: ['download-progress'],
  text: JSON.stringify({ kind: 'end', ok: true, received: 2000, total: 2000 }),
  exitCode: 0,
})
assert.equal(entry('d1').phase, 'download-done')
assert.equal(entry('d1').percent, 1)
assert.equal(entry('d1').ok, true)

handlers['plugin-manager/install-log']({
  requestId: 'd2',
  argv: ['download-progress'],
  text: JSON.stringify({ kind: 'start', url: 'https://example.com/missing.bin', path: 'C:\\work\\missing.bin' }),
})
handlers['plugin-manager/install-log']({
  requestId: 'd2',
  argv: ['download-progress'],
  text: JSON.stringify({ kind: 'end', ok: false, received: 0, total: 0, reason: 'HTTP 404 Not Found' }),
  exitCode: 1,
})
assert.equal(entry('d2').phase, 'download-failed')
assert.equal(entry('d2').reason, 'HTTP 404 Not Found')

// Dismissing hides it from the model.
store.dismiss('r1')
assert.equal(entry('r1').dismissed, true)

// A connection reset drops every tracked install.
assert.ok(snapshot().entries.length > 0)
clientHandlers['connection/reset']()
assert.equal(snapshot().entries.length, 0)

// A normalizing check on the dictionaries: every key exists in both languages.
const zhKeys = Object.keys(dictionaries[0].dicts.zh).sort()
const enKeys = Object.keys(dictionaries[0].dicts.en).sort()
assert.equal(JSON.stringify(zhKeys), JSON.stringify(enKeys))

console.log('client model: all checks passed')
