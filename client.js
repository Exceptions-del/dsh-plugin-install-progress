/**
 * Browser half of the progress card.
 *
 * Two Host capabilities report through the one forwarded event this app exposes for
 * streamed output: plugin installs (`plugin-install-progress` marker chunks) and
 * `download_file` runs (`download-progress` marker chunks). Both become entries in one
 * store and render as a card above the message box, in `conversation.input.dock`.
 */
window.__ModuleLoader__.load({
  id: '@local/plugin-install-progress',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'pluginInstallProgress'
    /** Marker command lines the Host half writes its own chunks under. */
    const INSTALL_MARKER = 'plugin-install-progress'
    const DOWNLOAD_MARKER = 'download-progress'
    /** A settled card stays visible this long before it disappears. */
    const SETTLE_HOLD_MS = 3200
    /** A failed install shorter than this produced no visible work; it flashes nothing. */
    const MIN_VISIBLE_MS = 700
    /** A running entry with no event for this long is treated as abandoned. */
    const RUN_IDLE_MS = 3 * 60 * 1000

    const en = {
      'stage.start': 'Preparing installation',
      'stage.installing': 'Downloading and installing plugin',
      'stage.applying': 'Applying plugin changes',
      'stage.cancelling': 'Cancelling installation',
      'stage.done': 'Plugin installed',
      'stage.cancelled': 'Plugin installation cancelled',
      'stage.failed': 'Plugin installation failed',
      'stage.download': 'Downloading file',
      'stage.downloadDone': 'File downloaded',
      'stage.downloadFailed': 'File download failed',
      'meta.resolved': '{resolved} packages resolved',
      'meta.downloaded': '{downloaded} downloaded',
      'meta.attempt': 'source {index}/{total}',
      'meta.elapsed': '{elapsed}',
      'meta.transferred': '{received} / {total}',
      'meta.received': '{received}',
      'meta.rate': '{rate}/s',
      'meta.done': 'Installed',
      'meta.restart': 'Restart DSH to apply it',
      'meta.overridden': 'A higher layer overrides it',
      'meta.failed': 'The installation did not finish',
      'meta.cancelled': 'Nothing was changed',
      'meta.buildBlocked': 'Install scripts need approval',
      'meta.downloadFailed': 'The download did not finish',
      'dismiss': 'Hide progress',
      'more': '{count} more running',
    }

    const zh = {
      'stage.start': '准备安装插件',
      'stage.installing': '正在下载并安装插件',
      'stage.applying': '正在应用插件更改',
      'stage.cancelling': '正在取消安装',
      'stage.done': '插件安装完成',
      'stage.cancelled': '插件安装已取消',
      'stage.failed': '插件安装失败',
      'stage.download': '正在下载文件',
      'stage.downloadDone': '文件下载完成',
      'stage.downloadFailed': '文件下载失败',
      'meta.resolved': '已解析 {resolved} 个包',
      'meta.downloaded': '已下载 {downloaded} 个',
      'meta.attempt': '源 {index}/{total}',
      'meta.elapsed': '用时 {elapsed}',
      'meta.transferred': '{received} / {total}',
      'meta.received': '{received}',
      'meta.rate': '{rate}/s',
      'meta.done': '已安装',
      'meta.restart': '重启 DSH 后生效',
      'meta.overridden': '被更高优先级的层覆盖',
      'meta.failed': '安装未完成',
      'meta.cancelled': '未产生任何更改',
      'meta.buildBlocked': '需批准安装脚本后重试',
      'meta.downloadFailed': '下载未完成',
      'dismiss': '隐藏进度',
      'more': '另有 {count} 个进行中',
    }

    const STYLE = `
.dsh-install-progress {
  position: relative;
  box-sizing: border-box;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance, 0px) -
    var(--dsh-composer-side-clearance, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px) -
    var(--dsh-composer-dock-inset, 0px)
  );
  max-width: calc(var(--dsh-composer-card-max-width, 100%) - 4 * var(--dsh-composer-dock-inset, 0px));
  margin: 0 auto;
  display: grid;
  gap: 3px;
  padding: 7px 8px 10px 12px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-m, 10px);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.35;
}
.dsh-install-progress__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dsh-install-progress__icon {
  flex: none;
  display: inline-flex;
  color: var(--dsw-alias-brand-primary);
}
.dsh-install-progress__title {
  flex: none;
  font-weight: 500;
  white-space: nowrap;
}
.dsh-install-progress__spec {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsh-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
}
.dsh-install-progress__count {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
}
.dsh-install-progress__percent {
  flex: none;
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-brand-primary);
}
.dsh-install-progress__percent--done { color: var(--dsw-alias-state-success-primary); }
.dsh-install-progress__percent--failed { color: var(--dsw-alias-state-error-primary); }
.dsh-install-progress__dismiss {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.dsh-install-progress__dismiss:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-install-progress__meta {
  display: flex;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
}
.dsh-install-progress__meta > span {
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-install-progress__track {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-install-progress__fill {
  height: 100%;
  width: 0;
  background: var(--dsw-alias-brand-primary);
  transition: width 240ms ease;
}
.dsh-install-progress__fill--done { background: var(--dsw-alias-state-success-primary); }
.dsh-install-progress__fill--failed { background: var(--dsw-alias-state-error-primary); }
.dsh-install-progress__fill--cancelled { background: var(--dsw-alias-state-idle-primary); }
.dsh-install-progress__fill--indeterminate {
  width: 34%;
  transition: none;
  animation: dsh-install-progress-slide 1.5s ease-in-out infinite;
}
@keyframes dsh-install-progress-slide {
  from { transform: translateX(-110%); }
  to { transform: translateX(320%); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-install-progress__fill { transition: none; }
  .dsh-install-progress__fill--indeterminate {
    width: 100%;
    opacity: 0.35;
    animation: none;
  }
}
`

    /** Strip the ANSI escapes a captured pnpm run may still carry. */
    function stripAnsi(text) {
      return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    }

    const PROGRESS = /Progress:([^\r\n]*)/g

    /** Read the last pnpm package-progress line in one log chunk, if any. */
    function parsePackages(text) {
      const plain = stripAnsi(text)
      let match
      let found = null
      PROGRESS.lastIndex = 0
      while ((match = PROGRESS.exec(plain)) !== null) {
        const line = match[1]
        const resolved = /resolved\s+(\d+)/.exec(line)
        if (resolved === null) continue
        const reused = /reused\s+(\d+)/.exec(line)
        const downloaded = /downloaded\s+(\d+)/.exec(line)
        found = {
          resolved: Number(resolved[1]),
          reused: reused === null ? 0 : Number(reused[1]),
          downloaded: downloaded === null ? 0 : Number(downloaded[1]),
          done: /(?:^|,)\s*done\b/.test(line),
        }
      }
      return found
    }

    /** Turn package counts into a fraction, or null while nothing has settled yet. */
    function percentFromPackages(packages) {
      if (packages === null) return null
      const done = packages.reused + packages.downloaded
      if (packages.resolved < 2 || done <= 0) return null
      return Math.min(0.93, done / packages.resolved)
    }

    /** Human byte count for the card's meta line. */
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

    /** File name of a download target. */
    function fileNameOf(path) {
      if (typeof path !== 'string' || path === '') return ''
      const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
      return cut === -1 ? path : path.slice(cut + 1)
    }

    /** The live progress model: one map of entries and one immutable snapshot. */
    function createStore() {
      const entries = new Map()
      const listeners = new Set()
      let revision = 0
      let snapshot = { entries: [], revision }

      const publish = () => {
        revision += 1
        snapshot = {
          entries: [...entries.values()].sort((left, right) => right.startedAt - left.startedAt),
          revision,
        }
        for (const listener of [...listeners]) listener()
      }

      const subscribe = (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }

      const getSnapshot = () => snapshot

      /** Drop settled entries the card can no longer show, so a long session stays small. */
      const prune = () => {
        const cutoff = Date.now() - SETTLE_HOLD_MS - 60_000
        for (const [id, entry] of entries) {
          if (entry.endedAt !== 0 && entry.endedAt < cutoff) entries.delete(id)
        }
      }

      /** Insert one running entry of either kind. */
      const begin = (requestId, fields) => {
        if (entries.has(requestId)) return
        prune()
        const now = Date.now()
        entries.set(requestId, {
          requestId,
          phase: 'start',
          startedAt: now,
          lastEventAt: now,
          endedAt: 0,
          percent: null,
          sawWork: false,
          ok: false,
          dismissed: false,
          reason: null,
          code: null,
          failure: null,
          application: null,
          packages: null,
          attempt: null,
          received: 0,
          total: 0,
          ...fields,
        })
        publish()
      }

      const parseMarker = (chunk) => {
        try {
          const payload = JSON.parse(typeof chunk.text === 'string' ? chunk.text : '')
          return payload !== null && typeof payload === 'object' ? payload : null
        } catch {
          return null
        }
      }

      const startInstall = (requestId, payload) => {
        begin(requestId, {
          kind: 'install',
          spec: typeof payload.spec === 'string' ? payload.spec : '',
        })
      }

      const startDownload = (requestId, payload) => {
        begin(requestId, {
          kind: 'download',
          spec: fileNameOf(payload.path),
          url: typeof payload.url === 'string' ? payload.url : '',
          target: typeof payload.path === 'string' ? payload.path : '',
          sawWork: true,
        })
      }

      const finishInstall = (requestId, payload) => {
        const entry = entries.get(requestId)
        if (entry === undefined || entry.kind !== 'install' || entry.endedAt !== 0) return
        entry.endedAt = Date.now()
        entry.ok = payload.ok === true
        entry.application = typeof payload.application === 'string' ? payload.application : null
        entry.code = typeof payload.code === 'string' ? payload.code : null
        entry.failure = typeof payload.failure === 'string' ? payload.failure : null
        entry.reason = typeof payload.reason === 'string' ? payload.reason : null
        if (entry.ok) {
          entry.phase = 'done'
          entry.percent = 1
        } else if (entry.application === 'cancelled') {
          entry.phase = 'cancelled'
        } else {
          entry.phase = 'failed'
        }
        publish()
      }

      const progressDownload = (requestId, payload) => {
        const entry = entries.get(requestId)
        if (entry === undefined || entry.kind !== 'download' || entry.endedAt !== 0) return
        entry.lastEventAt = Date.now()
        const received = Number(payload.received)
        const total = Number(payload.total)
        if (Number.isFinite(received) && received >= 0) entry.received = received
        if (Number.isFinite(total) && total > 0) entry.total = total
        if (entry.total > 0) entry.percent = Math.min(1, entry.received / entry.total)
        publish()
      }

      const finishDownload = (requestId, payload) => {
        const entry = entries.get(requestId)
        if (entry === undefined || entry.kind !== 'download' || entry.endedAt !== 0) return
        entry.endedAt = Date.now()
        entry.lastEventAt = entry.endedAt
        entry.ok = payload.ok === true
        const received = Number(payload.received)
        const total = Number(payload.total)
        if (Number.isFinite(received) && received >= 0) entry.received = received
        if (Number.isFinite(total) && total > 0) entry.total = total
        entry.reason = typeof payload.reason === 'string' ? payload.reason : null
        if (entry.ok) {
          entry.phase = 'download-done'
          entry.percent = 1
        } else {
          entry.phase = 'download-failed'
        }
        publish()
      }

      const onLog = (chunk) => {
        if (chunk === null || typeof chunk !== 'object') return
        const requestId = chunk.requestId
        if (typeof requestId !== 'string') return
        const marker = Array.isArray(chunk.argv) ? chunk.argv[0] : undefined
        if (marker === INSTALL_MARKER) {
          const payload = parseMarker(chunk)
          if (payload === null) return
          if (payload.kind === 'start') startInstall(requestId, payload)
          else if (payload.kind === 'end') finishInstall(requestId, payload)
          return
        }
        if (marker === DOWNLOAD_MARKER) {
          const payload = parseMarker(chunk)
          if (payload === null) return
          if (payload.kind === 'start') startDownload(requestId, payload)
          else if (payload.kind === 'progress') progressDownload(requestId, payload)
          else if (payload.kind === 'end') finishDownload(requestId, payload)
          return
        }
        // Ordinary output belongs to a pnpm run this card follows; other installs are ignored.
        const entry = entries.get(requestId)
        if (entry === undefined || entry.kind !== 'install' || entry.endedAt !== 0) return
        const packages = parsePackages(typeof chunk.text === 'string' ? chunk.text : '')
        if (packages === null) return
        entry.packages = packages
        entry.lastEventAt = Date.now()
        // pnpm's `done` line means every package is linked; cached installs report few
        // reused packages, so it closes the gap before the applying phase.
        const next = packages.done
          ? Math.max(percentFromPackages(packages) ?? 0, 0.9)
          : percentFromPackages(packages)
        if (next !== null && (entry.percent === null || next > entry.percent)) entry.percent = next
        publish()
      }

      const onState = (progress) => {
        if (progress === null || typeof progress !== 'object') return
        const entry = entries.get(progress.requestId)
        if (entry === undefined || entry.kind !== 'install' || entry.dismissed || entry.endedAt !== 0) return
        entry.lastEventAt = Date.now()
        if (progress.phase === 'installing') {
          entry.phase = 'installing'
          entry.sawWork = true
          if (progress.attempt !== undefined && progress.attempt !== null) {
            entry.attempt = {
              index: Number(progress.attempt.index) || 0,
              total: Number(progress.attempt.total) || 0,
            }
          }
        } else if (progress.phase === 'cancelling') {
          entry.phase = 'cancelling'
        } else if (progress.phase === 'applying') {
          entry.phase = 'applying'
          entry.sawWork = true
          entry.percent = Math.max(entry.percent === null ? 0 : entry.percent, 0.94)
        }
        publish()
      }

      const dismiss = (requestId) => {
        const entry = entries.get(requestId)
        if (entry === undefined) return
        entry.dismissed = true
        publish()
      }

      /** Forget every entry: the connection generation that carried their events is gone. */
      const reset = () => {
        if (entries.size === 0) return
        entries.clear()
        publish()
      }

      return { subscribe, getSnapshot, onLog, onState, dismiss, reset }
    }

    /** Whether an entry should still own the card. */
    function isVisible(entry, now) {
      if (entry.dismissed) return false
      if (entry.endedAt !== 0) {
        const duration = entry.endedAt - entry.startedAt
        if (duration < MIN_VISIBLE_MS && !entry.sawWork) return false
        return now - entry.endedAt < SETTLE_HOLD_MS
      }
      return now - entry.lastEventAt < RUN_IDLE_MS
    }

    /** `mm:ss` for the elapsed part of the meta line. */
    function formatElapsed(milliseconds) {
      const total = Math.max(0, Math.floor(milliseconds / 1000))
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
    }

    /** Translate the entry's stage. */
    function stageKey(entry) {
      switch (entry.phase) {
        case 'start': return 'stage.start'
        case 'installing': return 'stage.installing'
        case 'cancelling': return 'stage.cancelling'
        case 'applying': return 'stage.applying'
        case 'done': return 'stage.done'
        case 'cancelled': return 'stage.cancelled'
        case 'download': return 'stage.download'
        case 'download-done': return 'stage.downloadDone'
        case 'download-failed': return 'stage.downloadFailed'
        default: return 'stage.failed'
      }
    }

    /** Fraction the track draws, or null for an indeterminate run. */
    function trackValue(entry) {
      let percent = entry.percent
      if (entry.phase === 'done' || entry.phase === 'download-done') percent = 1
      else if (percent === null && (entry.phase === 'failed' || entry.phase === 'cancelled' || entry.phase === 'download-failed')) {
        percent = 1
      }
      return percent
    }

    /** The meta line's parts, in reading order. */
    function metaParts(entry, t, elapsed, running) {
      const parts = []
      if (entry.kind === 'download') {
        if (entry.received > 0 || entry.total > 0) {
          parts.push(entry.total > 0
            ? t('meta.transferred', { received: formatBytes(entry.received), total: formatBytes(entry.total) })
            : t('meta.received', { received: formatBytes(entry.received) }))
        }
        const seconds = Math.max(0.001, ((running ? Date.now() : entry.endedAt) - entry.startedAt) / 1000)
        if (entry.received > 0) parts.push(t('meta.rate', { rate: formatBytes(entry.received / seconds) }))
        if (!running && !entry.ok) {
          const detail = entry.reason === null ? t('meta.downloadFailed') : `${t('meta.downloadFailed')} · ${entry.reason}`
          parts.unshift(detail)
        }
        parts.push(t('meta.elapsed', { elapsed }))
        return parts
      }
      if (running && entry.packages !== null) {
        if (entry.packages.resolved > 0) parts.push(t('meta.resolved', { resolved: entry.packages.resolved }))
        if (entry.packages.downloaded > 0) parts.push(t('meta.downloaded', { downloaded: entry.packages.downloaded }))
      }
      if (running && entry.attempt !== null && entry.attempt.total > 1) {
        parts.push(t('meta.attempt', { index: entry.attempt.index, total: entry.attempt.total }))
      }
      if (!running) {
        if (entry.phase === 'done') {
          parts.push(entry.application === 'restart-required'
            ? t('meta.restart')
            : entry.application === 'overridden' ? t('meta.overridden') : t('meta.done'))
        } else if (entry.phase === 'cancelled') {
          parts.push(t('meta.cancelled'))
        } else if (entry.failure === 'build-blocked') {
          parts.push(t('meta.buildBlocked'))
        } else {
          const detail = entry.failure !== null ? entry.failure : entry.code !== null ? entry.code : entry.reason
          parts.push(detail === null ? t('meta.failed') : `${t('meta.failed')} · ${detail}`)
        }
      }
      parts.push(t('meta.elapsed', { elapsed }))
      return parts
    }

    /** The single progress card above the message box. */
    function InstallProgressBar(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const store = props.store
      const [state, setState] = React.useState(store.getSnapshot)
      const [tick, refresh] = React.useState(0)

      React.useEffect(() => {
        setState(store.getSnapshot())
        return store.subscribe(() => { setState(store.getSnapshot()) })
      }, [store])

      const now = Date.now()
      const visible = state.entries.filter((entry) => isVisible(entry, now))

      // One timer while anything is on screen: it advances the elapsed label and
      // retires a card once its hold time is over or its run went silent.
      React.useEffect(() => {
        if (visible.length === 0) return undefined
        const timer = setInterval(() => { refresh((value) => value + 1) }, 500)
        return () => { clearInterval(timer) }
      }, [visible.length])

      void tick

      if (visible.length === 0) return null
      const entry = visible[0]
      const running = entry.endedAt === 0
      const percent = trackValue(entry)
      const determinate = percent !== null
      const elapsed = formatElapsed((running ? now : entry.endedAt) - entry.startedAt)
      const parts = metaParts(entry, t, elapsed, running)
      const alsoRunning = visible.filter((item) => item.endedAt === 0 && item !== entry).length
      const donePhase = entry.phase === 'done' || entry.phase === 'download-done'
      const failedPhase = entry.phase === 'failed' || entry.phase === 'download-failed'
      const percentText = determinate && (donePhase || entry.percent !== null)
        ? `${Math.round(percent * 100)}%`
        : ''
      const fillClass = [
        'dsh-install-progress__fill',
        donePhase ? 'dsh-install-progress__fill--done' : '',
        failedPhase ? 'dsh-install-progress__fill--failed' : '',
        entry.phase === 'cancelled' ? 'dsh-install-progress__fill--cancelled' : '',
        determinate ? '' : 'dsh-install-progress__fill--indeterminate',
      ].filter(Boolean).join(' ')
      const percentClass = [
        'dsh-install-progress__percent',
        donePhase ? 'dsh-install-progress__percent--done' : '',
        failedPhase ? 'dsh-install-progress__percent--failed' : '',
      ].filter(Boolean).join(' ')
      const showPercent = percentText !== '' && (donePhase || entry.percent !== null)

      return h('div', {
        className: 'dsh-install-progress',
        'data-phase': entry.phase,
        'data-kind': entry.kind,
        title: entry.kind === 'download' && entry.target !== ''
          ? `${entry.target}\n${parts.join(' · ')}`
          : parts.join(' · '),
      },
        h('div', { className: 'dsh-install-progress__head' },
          h('span', { className: 'dsh-install-progress__icon', 'aria-hidden': 'true' },
            h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none' },
              h('path', {
                d: 'M8 2v7m0 0 2.6-2.6M8 9 5.4 6.4',
                stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
              }),
              h('path', {
                d: 'M2.8 10.6v1.1a1.9 1.9 0 0 0 1.9 1.9h6.6a1.9 1.9 0 0 0 1.9-1.9v-1.1',
                stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
              }))),
          h('span', {
            className: 'dsh-install-progress__title',
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true',
          }, t(stageKey(entry))),
          entry.spec === ''
            ? null
            : h('span', { className: 'dsh-install-progress__spec' }, entry.spec),
          alsoRunning > 0
            ? h('span', { className: 'dsh-install-progress__count' }, t('more', { count: alsoRunning }))
            : null,
          showPercent ? h('span', { className: percentClass }, percentText) : null,
          h('button', {
            type: 'button',
            className: 'dsh-install-progress__dismiss',
            title: t('dismiss'),
            'aria-label': t('dismiss'),
            onClick: () => { store.dismiss(entry.requestId) },
          }, '\u00d7')),
        h('div', { className: 'dsh-install-progress__meta' },
          parts.map((part, index) => h('span', { key: String(index) }, part))),
        h('div', {
          className: 'dsh-install-progress__track',
          role: 'progressbar',
          'aria-label': t(stageKey(entry)),
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          ...(determinate ? { 'aria-valuenow': Math.round(percent * 100) } : { 'aria-busy': true }),
        }, h('div', {
          className: fillClass,
          style: determinate ? { width: `${Math.round(percent * 100)}%` } : undefined,
        })))
    }

    /**
     * Register the dictionary, the event subscriptions and the dock entry.
     * @param ctx Client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-install-progress: dictionaries')

      const style = document.createElement('style')
      style.setAttribute('data-plugin', '@local/plugin-install-progress')
      style.textContent = STYLE
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() }, 'plugin-install-progress: styles')

      const store = createStore()
      ctx.effect(() => {
        const disposers = []
        try {
          disposers.push(ctx.remote.$on('plugin-manager/install-state', (progress) => { store.onState(progress) }))
          disposers.push(ctx.remote.$on('plugin-manager/install-log', (chunk) => { store.onLog(chunk) }))
          disposers.push(ctx.on('connection/reset', () => { store.reset() }))
        } catch (error) {
          console.warn('plugin-install-progress: progress events are unavailable', error)
        }
        return () => {
          for (const dispose of disposers) {
            try { dispose() } catch { /* already withdrawn with the connection */ }
          }
        }
      }, 'plugin-install-progress: host progress events')

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'plugin-install-progress',
        order: 50,
        locale: NS,
        inject: () => ({ store }),
      }, InstallProgressBar))
    }

    return { inject: ['slots', 'locale', 'remote'], apply }
  },
})
