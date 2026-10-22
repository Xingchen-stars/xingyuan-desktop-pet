const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PROVIDERS = ['codex', 'workbuddy'];
const MODES = ['hover', 'pinned', 'off'];
const REFRESH_MS = 60_000;
const MANUAL_COOLDOWN_MS = 15_000;

class QuotaError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function normalizeCodex(response) {
  const source = response?.rateLimitsByLimitId;
  const entries = source && Object.keys(source).length
    ? Object.entries(source) : [['codex', response?.rateLimits]];
  const buckets = entries.filter(([, value]) => value && typeof value === 'object').map(([id, value]) => {
    const windows = ['primary', 'secondary'].flatMap((slot) => {
      const item = value[slot];
      // null and missing are unavailable, never zero usage or unlimited quota.
      if (!item || typeof item.usedPercent !== 'number' || !Number.isFinite(item.usedPercent)) return [];
      const duration = typeof item.windowDurationMins === 'number' && Number.isFinite(item.windowDurationMins) && item.windowDurationMins > 0
        ? item.windowDurationMins : null;
      return [{
        slot,
        durationMins: duration,
        remainingPercent: Math.max(0, Math.min(100, 100 - item.usedPercent)),
        resetsAt: typeof item.resetsAt === 'number' && Number.isFinite(item.resetsAt) && item.resetsAt > 0 ? item.resetsAt : null,
      }];
    });
    return { id, name: typeof value.limitName === 'string' ? value.limitName : '', windows };
  }).filter((bucket) => bucket.windows.length);
  if (!buckets.length) throw new QuotaError('no-data', '平台暂未返回可用额度数据');
  return { kind: 'windows', buckets };
}

function codexExecutable() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new QuotaError('not-installed', '未找到 Codex，请先安装并登录 Codex');
  return found;
}

// The official local app-server owns authentication. Never copy auth.json,
// tokens, account identities, raw stderr or upstream responses to the UI/log.
// A fresh process per refresh also avoids holding an old login indefinitely.
function readCodex({ executable, timeoutMs = 30_000, spawnProcess = spawn, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let completed = false;
    let buffer = '';
    let sawAccessDenied = false;
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    let timer;
    const finish = (error, result) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (child) { child.stdin?.end(); child.kill(); }
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new QuotaError('cancelled', '查询已停止'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      child = spawnProcess(executable || codexExecutable(), ['app-server', '--stdio'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
      });
    } catch (error) { finish(error); return; }
    timer = setTimeout(() => finish(new QuotaError('timeout', '查询超时，请检查网络后重试')), timeoutMs);
    const send = (message) => {
      if (!completed && child.stdin?.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    child.stdin.on('error', () => finish(new QuotaError('connection', 'Codex 查询进程连接中断')));
    child.on('error', () => finish(new QuotaError('launch', 'Codex 查询进程未能启动')));
    child.on('exit', () => finish(new QuotaError('connection', sawAccessDenied
      ? 'Codex 查询被系统权限限制，请从桌面正常启动星渊后重试' : 'Codex 查询进程提前退出，请重试')));
    child.stderr.on('data', (chunk) => {
      sawAccessDenied ||= /access.{0,20}denied|拒绝访问|os error 5/i.test(chunk.toString());
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 1_000_000) return finish(new QuotaError('protocol', 'Codex 返回的数据格式异常'));
      let newline;
      while (!completed && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (![1, 2, 3].includes(message.id)) continue;
        if (message.error) {
          const auth = /auth|login|sign.?in|401/i.test(String(message.error.message || ''));
          return finish(new QuotaError(auth ? 'login-required' : 'fetch-error', auth
            ? '请先在 Codex 中登录 ChatGPT 账号，再点刷新' : 'Codex 暂时无法查询额度，请稍后重试'));
        }
        if (message.id === 1) {
          send({ method: 'initialized', params: {} });
          send({ method: 'account/read', id: 2, params: { refreshToken: false } });
        } else if (message.id === 2) {
          if (message.result?.account?.type !== 'chatgpt') {
            return finish(new QuotaError('login-required', '需要在 Codex 中登录 ChatGPT 账号；API Key 用量不属于此额度'));
          }
          send({ method: 'account/rateLimits/read', id: 3 });
        } else {
          try { finish(null, normalizeCodex(message.result)); } catch (error) { finish(error); }
        }
      }
    });
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'xingyuan_quota', title: '星渊额度面板', version: '0.3.0' } } });
  });
}

function readWorkBuddy() {
  // An internal billing route was found, but no supported authentication bridge
  // is verified. Do not decrypt private credentials, scrape chats, or invent a balance.
  throw new QuotaError('not-connected', 'WorkBuddy 尚未接通安全的积分读取方式，暂不显示余额。请在 WorkBuddy 个人中心查看。');
}

class QuotaService {
  constructor({ provider = 'codex', read = { codex: readCodex, workbuddy: readWorkBuddy }, onChange = () => {}, now = Date.now } = {}) {
    this.provider = PROVIDERS.includes(provider) ? provider : 'codex';
    this.read = read; this.onChange = onChange; this.now = now;
    this.states = {}; this.inflight = {}; this.controllers = new Set(); this.disposed = false;
  }
  state(provider = this.provider) {
    return this.states[provider] || { provider, status: 'idle', data: null, updatedAt: null, attemptedAt: null, nextAllowedAt: 0 };
  }
  select(provider) {
    if (!PROVIDERS.includes(provider)) return this.state();
    this.provider = provider; this.onChange(); return this.state();
  }
  refresh(manual = false) {
    const provider = this.provider;
    if (this.disposed) return Promise.resolve(this.state());
    if (this.inflight[provider]) return this.inflight[provider];
    const before = this.state(provider), now = this.now();
    if (now < before.nextAllowedAt || (!manual && before.attemptedAt && now - before.attemptedAt < REFRESH_MS)) {
      return Promise.resolve(before);
    }
    const controller = new AbortController(); this.controllers.add(controller);
    this.states[provider] = { ...before, status: 'loading', data: null, attemptedAt: now, nextAllowedAt: now + MANUAL_COOLDOWN_MS };
    this.onChange();
    const promise = Promise.resolve().then(() => this.read[provider]({ signal: controller.signal })).then((data) => {
      this.states[provider] = { ...this.state(provider), status: 'ready', data, message: '', code: '', failures: 0, updatedAt: this.now() };
    }).catch((error) => {
      const failures = (before.failures || 0) + 1;
      this.states[provider] = {
        ...this.state(provider), status: 'error', data: null,
        code: error instanceof QuotaError ? error.code : 'fetch-error',
        message: error instanceof QuotaError ? error.message : '暂时无法读取，请稍后重试',
        failures, nextAllowedAt: now + (error.code === 'not-connected' ? REFRESH_MS : Math.min(300_000, REFRESH_MS * 2 ** (failures - 1))),
      };
    }).finally(() => {
      delete this.inflight[provider]; this.controllers.delete(controller);
      if (!this.disposed) this.onChange();
    }).then(() => this.state(provider));
    this.inflight[provider] = promise;
    return promise;
  }
  dispose() {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
  }
}

module.exports = { QuotaError, QuotaService, normalizeCodex, readCodex, PROVIDERS, MODES };
