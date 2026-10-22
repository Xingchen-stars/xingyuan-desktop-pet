const api = window.xingyuanPet;
const provider = document.querySelector('#provider');
const pin = document.querySelector('#pin');
const refresh = document.querySelector('#refresh');
const content = document.querySelector('#content');
const status = document.querySelector('#status');
let snapshot;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function windowLabel(minutes, slot) {
  if (!minutes) return slot === 'primary' ? '当前额度窗口' : '另一额度窗口';
  if (minutes === 10080) return '周额度';
  if (minutes % 1440 === 0) return `${minutes / 1440} 天额度`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时额度`;
  return `${minutes} 分钟额度`;
}
function resetLabel(seconds) {
  if (!seconds) return '平台未提供重置时间';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '平台未提供重置时间';
  if (date.getTime() <= Date.now()) return '已到重置时间，等待平台更新';
  return `${date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} 重置`;
}
function updateClock() {
  if (!snapshot) return;
  refresh.disabled = snapshot.state.status === 'loading' || Date.now() < snapshot.state.nextAllowedAt;
  refresh.textContent = snapshot.state.status === 'loading' ? '查询中…' : '刷新';
}
function render(value) {
  snapshot = value;
  const state = value.state;
  provider.value = value.provider;
  pin.checked = value.mode === 'pinned';
  status.className = `status ${state.status}`;
  status.textContent = { ready: '已更新', loading: '查询中', error: state.code === 'not-connected' ? '未接通' : '暂不可用', idle: '等待查询' }[state.status];
  content.setAttribute('aria-busy', String(state.status === 'loading'));
  content.replaceChildren();
  if (state.status === 'ready' && state.data?.kind === 'windows') {
    for (const bucket of state.data.buckets) {
      if (state.data.buckets.length > 1) content.append(element('p', 'bucket', bucket.name || bucket.id));
      for (const window of bucket.windows) {
        const metric = element('div', `metric${window.remainingPercent <= 20 ? ' low' : ''}`);
        const head = element('div', 'metric-head');
        head.append(element('span', '', windowLabel(window.durationMins, window.slot)), element('span', 'value', `${Math.round(window.remainingPercent)}%`));
        const progress = element('progress');
        progress.max = 100; progress.value = window.remainingPercent;
        progress.setAttribute('aria-label', `${windowLabel(window.durationMins, window.slot)}剩余`);
        metric.append(head, progress, element('p', 'reset', `剩余 · ${resetLabel(window.resetsAt)}`));
        content.append(metric);
      }
    }
  } else {
    content.append(element('span', 'empty-mark', state.status === 'loading' ? '…' : '—'));
    content.append(element('p', 'message', state.message || (state.status === 'loading' ? '正在读取平台数据，不会发起模型对话。' : '等待首次查询')));
  }
  const last = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : null;
  document.querySelector('#updated').textContent = last
    ? `${state.status === 'ready' ? '更新时间' : '上次成功'} ${last}${state.status !== 'ready' ? ' · 旧数值已隐藏' : ''}`
    : '尚未获取真实数据';
  updateClock();
}
async function perform(fn) {
  try { render(await fn()); } catch {
    status.className = 'status error'; status.textContent = '连接中断';
    content.replaceChildren(element('p', 'message', '面板连接中断，请从星渊菜单重新打开。'));
  }
}
provider.addEventListener('change', () => perform(() => api.setQuota({ provider: provider.value })));
pin.addEventListener('change', () => perform(() => api.setQuota({ mode: pin.checked ? 'pinned' : 'hover' })));
refresh.addEventListener('click', () => perform(() => api.refreshQuota()));
document.querySelector('#dismiss').addEventListener('click', () => perform(() => api.setQuota({ mode: 'off' })));
api.onQuotaChanged(render);
perform(() => api.getQuota());
setInterval(updateClock, 1000);
