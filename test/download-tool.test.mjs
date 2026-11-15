import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mod = await import(new URL('../index.js', import.meta.url))

const CHUNK = 32 * 1024
const TOTAL = 2 * 1024 * 1024
const payload = Buffer.alloc(TOTAL, 7)

const server = createServer((request, response) => {
  if (request.url === '/big.bin') {
    response.writeHead(200, { 'content-length': String(payload.length), 'content-type': 'application/octet-stream' })
    let offset = 0
    const tick = () => {
      if (offset >= payload.length) {
        response.end()
        return
      }
      const chunk = payload.subarray(offset, offset + CHUNK)
      offset += chunk.length
      setTimeout(() => {
        if (response.destroyed) return
        response.write(chunk, () => setImmediate(tick))
      }, 8)
    }
    tick()
    return
  }
  response.writeHead(404, { 'content-length': '0' })
  response.end()
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

const cwd = await mkdtemp(join(tmpdir(), 'dsh-download-test-'))

function makeCtx() {
  const events = []
  const ctx = {
    emit(name, payload) {
      events.push({ name, payload })
      assert.equal(name, 'plugin-manager/install-log')
      assert.deepEqual(payload.argv, ['download-progress'])
      assert.equal(payload.jobId, 'download-progress')
    },
  }
  return { ctx, events }
}

function makeExec(signal) {
  return { agent: { session: { header: { cwd } } }, signal }
}

const controller = new AbortController()

// 1. A successful download streams markers, writes the exact bytes and reports progress.
{
  const { ctx, events } = makeCtx()
  const tool = mod.createDownloadTool(ctx)
  const result = await tool.execute({ url: `${origin}/big.bin`, path: 'nested/big.bin' }, makeExec(controller.signal))
  assert.match(result, /^Downloaded 2\.0 MB to /)
  const written = await readFile(join(cwd, 'nested', 'big.bin'))
  assert.equal(written.length, TOTAL)

  const parsed = events.map((event) => JSON.parse(event.payload.text))
  assert.equal(parsed[0].kind, 'start')
  assert.equal(parsed[0].path.endsWith('big.bin'), true)
  assert.equal(parsed[1].kind, 'progress')
  assert.equal(parsed[1].total, TOTAL)
  assert.equal(parsed[1].received, 0)
  const intermediate = parsed.filter((item) => item.kind === 'progress' && item.received > 0)
  assert.ok(intermediate.length >= 2, `expected streamed progress, got ${JSON.stringify(parsed)}`)
  const end = parsed.at(-1)
  assert.equal(end.kind, 'end')
  assert.equal(end.ok, true)
  assert.equal(end.received, TOTAL)
  assert.equal(events.at(-1).payload.exitCode, 0)
  assert.ok(events.every((event) => typeof event.payload.requestId === 'string'))
}

// 2. An existing file is refused before any network or file work.
{
  const { ctx, events } = makeCtx()
  const tool = mod.createDownloadTool(ctx)
  await assert.rejects(() => tool.execute({ url: `${origin}/big.bin`, path: 'nested/big.bin' }, makeExec(controller.signal)), /already exists/)
  assert.equal(events.length, 0)
}

// 3. The destination cannot leave the session working directory.
{
  const { ctx } = makeCtx()
  const tool = mod.createDownloadTool(ctx)
  await assert.rejects(
    () => tool.execute({ url: `${origin}/big.bin`, path: '../escape.bin' }, makeExec(controller.signal)),
    /inside the session working directory/,
  )
}

// 4. A failed response leaves no partial file and settles the card as failed.
{
  const { ctx, events } = makeCtx()
  const tool = mod.createDownloadTool(ctx)
  await assert.rejects(() => tool.execute({ url: `${origin}/missing.bin`, path: 'missing.bin' }, makeExec(controller.signal)), /HTTP 404/)
  await assert.rejects(() => stat(join(cwd, 'missing.bin')), { code: 'ENOENT' })
  const end = JSON.parse(events.at(-1).payload.text)
  assert.equal(end.kind, 'end')
  assert.equal(end.ok, false)
  assert.match(end.reason, /^HTTP 404/)
  assert.equal(events.at(-1).payload.exitCode, 1)
}

// 5. Overwrite replaces an existing file.
{
  const { ctx } = makeCtx()
  const tool = mod.createDownloadTool(ctx)
  const result = await tool.execute({ url: `${origin}/big.bin`, path: 'nested/big.bin', overwrite: true }, makeExec(controller.signal))
  assert.match(result, /^Downloaded 2\.0 MB/)
}

server.close()
await rm(cwd, { recursive: true, force: true })
console.log('download tool: all checks passed')
