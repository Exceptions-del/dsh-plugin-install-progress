/**
 * Host half of the progress card.
 *
 * Two capabilities share one browser surface:
 *
 * 1. Plugin installs. The installed plugin manager only streams
 *    `plugin-manager/install-state` / `install-log` for a caller-supplied request id,
 *    and the agent's `plugin_manager` tool does not supply one, so `installBundle` is
 *    wrapped to add an id and bracket the run with two marker chunks.
 * 2. Large downloads. The tools pipeline has no progress channel, so this plugin
 *    registers a `download_file` tool that streams the response body and reports bytes
 *    through the same forwarded event, under its own marker command line.
 *
 * The app forwards a fixed allowlist of Host events to the browser, and the installation
 * log is the only one that carries free-form streamed output keyed by a request id. Both
 * capabilities therefore ride `plugin-manager/install-log`; every other consumer filters
 * by its own request id, so these chunks reach only this plugin's card.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, open, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

/** `pluginManager` for installs, `tools` for the download tool. */
export const inject = ['pluginManager', 'tools']

/** Marker command lines identifying this plugin's own chunks. */
const INSTALL_MARKER = 'plugin-install-progress'
const DOWNLOAD_MARKER = 'download-progress'

/** Instance flags, kept off the public property namespace. */
const PATCHED = Symbol.for('dsh.plugin-install-progress.patched')

/** How often a running download reports its byte count. */
const DOWNLOAD_REPORT_MS = 150

/** A short, human-readable failure reason for a settled card. */
function reasonOf(error) {
  if (error === null || error === undefined) return 'unknown'
  const message = typeof error.message === 'string' ? error.message : String(error)
  return message.split('\n')[0].slice(0, 200)
}

/** Human byte count for the tool's model-facing result. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]}`
}

/**
 * Emit one marker chunk under a request id. Progress reporting is best effort: a throw
 * here never changes the underlying work.
 * @param ctx Host plugin context.
 * @param channel Marker command line identifying the payload grammar.
 * @param requestId Correlation id the browser follows.
 * @param payload Envelope: `{ kind: 'start' | 'progress' | 'end', ... }`.
 * @param exitCode Present on the chunk that ends the run.
 */
function report(ctx, channel, requestId, payload, exitCode) {
  try {
    ctx.emit('plugin-manager/install-log', {
      requestId,
      jobId: channel,
      argv: [channel],
      cwd: '',
      stream: 'stdout',
      text: JSON.stringify(payload),
      ...(exitCode === undefined ? {} : { exitCode }),
    })
  } catch {
    // The work proceeds; only the card misses this update.
  }
}

/**
 * Wrap `installBundle` so an agent-initiated install streams progress.
 * @param ctx Host plugin context.
 */
function patchInstall(ctx) {
  const proxy = ctx.pluginManager
  if (proxy === undefined || proxy === null) return
  // The Cordis service proxy wraps the raw instance; patch the instance itself so the
  // manager's own `this` (and any private field) stays the real object.
  const manager = proxy[Symbol.for('cordis.original')] ?? proxy
  if (typeof manager.installBundle !== 'function') return
  if (manager[PATCHED] === true) return
  const original = manager.installBundle

  const wrapped = function installBundleWithProgress(spec, options) {
    // A caller that named a request id already streams its own progress.
    if (options !== null && typeof options === 'object' && options.requestId !== undefined) {
      return original.call(manager, spec, options)
    }
    const requestId = `install-progress-${randomUUID()}`
    const settle = (payload, exitCode) => report(ctx, INSTALL_MARKER, requestId, { kind: 'end', ...payload }, exitCode)
    report(ctx, INSTALL_MARKER, requestId, { kind: 'start', spec: typeof spec === 'string' ? spec : String(spec) })
    let pending
    try {
      pending = original.call(manager, spec, { ...options, requestId })
    } catch (error) {
      settle({ ok: false, application: null, reason: reasonOf(error) }, 1)
      throw error
    }
    return Promise.resolve(pending).then((result) => {
      const application = result === null || result === undefined ? undefined : result.application
      const ok = application !== 'failed' && application !== 'cancelled'
      const pendingBuilds = result?.pendingBuilds
      settle({
        ok,
        application: application ?? null,
        // A failed run classifies its cause in packageResult.kind; the code alone is generic.
        ...(result?.packageResult?.kind === undefined ? {} : { failure: result.packageResult.kind }),
        ...(result?.error?.code === undefined ? {} : { code: result.error.code }),
        ...(Array.isArray(pendingBuilds) && pendingBuilds.length > 0 ? { pending: pendingBuilds.length } : {}),
      }, ok ? 0 : 1)
      return result
    }, (error) => {
      settle({ ok: false, application: null, reason: reasonOf(error) }, 1)
      throw error
    })
  }

  try {
    manager.installBundle = wrapped
    manager[PATCHED] = true
  } catch {
    // A service that refuses the property keeps its own behaviour; the card stays quiet.
    return
  }
  ctx.effect(() => () => {
    try {
      if (manager.installBundle === wrapped) manager.installBundle = original
      delete manager[PATCHED]
    } catch {
      // The manager is going away with this plugin; nothing to restore.
    }
  }, 'plugin-install-progress: restore installBundle')
}

/** Resolve the destination inside the session working directory. */
function destinationFor(cwd, url, requested) {
  const fallback = (() => {
    try {
      const name = basename(new URL(url).pathname)
      return name === '' || name === '/' ? 'download.bin' : name
    } catch {
      return 'download.bin'
    }
  })()
  const target = typeof requested === 'string' && requested.trim() !== ''
    ? resolve(cwd, requested.trim())
    : resolve(cwd, fallback)
  const inside = relative(cwd, target)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`destination must stay inside the session working directory (${cwd})`)
  }
  return target
}

/**
 * Build the `download_file` tool definition. It has no dependency on the tools package:
 * a raw JSON Schema and a plain definition object are what the registry stores.
 * @param ctx Host plugin context.
 */
export function createDownloadTool(ctx) {
  return {
    name: 'download_file',
    description: 'Download an http(s) URL into the session working directory while the progress card reports bytes received, percentage, throughput and elapsed time. Use this instead of a shell downloader for large files: curl, wget and PowerShell downloads do not expose progress to the UI. Redirects are followed, the partial file is removed on failure, and the destination must stay inside the working directory.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to download.' },
        path: {
          type: 'string',
          description: 'Destination file path, relative to the session working directory or absolute inside it. Defaults to the URL file name.',
        },
        overwrite: { type: 'boolean', description: 'Replace an existing file instead of failing. Defaults to false.' },
        expectedBytes: {
          type: 'number',
          description: 'Total size to report when the server sends no Content-Length.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const url = typeof args?.url === 'string' ? args.url.trim() : ''
      if (!/^https?:\/\//i.test(url)) throw new Error('url must be an absolute http(s) URL')
      const cwd = exec.agent?.session?.header?.cwd
      if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('download_file needs a session working directory')
      const target = destinationFor(cwd, url, typeof args?.path === 'string' ? args.path : undefined)
      const expected = Number(args?.expectedBytes ?? 0)
      let total = Number.isFinite(expected) && expected > 0 ? expected : 0
      const overwrite = args?.overwrite === true

      try {
        await stat(target)
        if (!overwrite) throw new Error(`file already exists: ${target}`)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }

      const requestId = `download-${randomUUID()}`
      const startedAt = Date.now()
      report(ctx, DOWNLOAD_MARKER, requestId, { kind: 'start', url, path: target })
      let received = 0
      try {
        const response = await fetch(url, { redirect: 'follow', signal: exec.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status} ${(response.statusText ?? '').trim()}`.trim())
        const length = Number(response.headers.get('content-length'))
        if (Number.isFinite(length) && length > 0) total = length
        report(ctx, DOWNLOAD_MARKER, requestId, { kind: 'progress', received, total })
        await mkdir(dirname(target), { recursive: true })
        const file = await open(target, 'w')
        try {
          const reader = response.body?.getReader()
          if (reader === undefined) throw new Error('the response has no body')
          let lastReport = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value === undefined) continue
            await file.write(value)
            received += value.byteLength
            const now = Date.now()
            if (now - lastReport >= DOWNLOAD_REPORT_MS) {
              lastReport = now
              report(ctx, DOWNLOAD_MARKER, requestId, { kind: 'progress', received, total })
            }
          }
        } finally {
          await file.close()
        }
        report(ctx, DOWNLOAD_MARKER, requestId, { kind: 'end', ok: true, received, total }, 0)
        const seconds = Math.max(0.001, (Date.now() - startedAt) / 1000)
        const rate = formatBytes(received / seconds)
        return `Downloaded ${formatBytes(received)} to ${target} in ${seconds.toFixed(1)}s (${rate}/s).`
      } catch (error) {
        await rm(target, { force: true }).catch(() => {})
        const cancelled = error?.name === 'AbortError' || exec.signal.aborted
        report(ctx, DOWNLOAD_MARKER, requestId, {
          kind: 'end', ok: false, received, total,
          reason: cancelled ? 'cancelled' : reasonOf(error),
        }, 1)
        throw error
      }
    },
  }
}

/**
 * Register both capabilities.
 * @param ctx Host plugin context.
 */
export function apply(ctx) {
  patchInstall(ctx)
  if (ctx.tools !== undefined && ctx.tools !== null) ctx.tools.register(createDownloadTool(ctx))
}
