const api = window.xingyuanPet;
const $ = selector => document.querySelector(selector);
const labels = { idle:'安静待机', active:'活泼一下', sleep:'进入睡眠', 'sleep-loop':'熟睡循环' };
const descriptions = { appearance:'调整到舒服的大小，让星渊按你的节奏陪伴。', actions:'现有四种动作，随时自由切换。', quota:'选择你关心的平台和显示方式。' };
const titles = { appearance:'外观与行为', actions:'动作', quota:'额度显示' };
let snapshot;
let sizeTimer;
let refreshing = false;
const clamp = value => Math.max(150, Math.min(520, Math.round(Number(value) || 260)));
function sizeFields(value) {
  const size = clamp(value);
  $('#size-slider').value = String(size);
  if (document.activeElement !== $('#size-number')) $('#size-number').value = String(size);
  $('#size-output').value = `${size} px`;
  document.querySelectorAll('[data-size]').forEach(button => button.classList.toggle('selected', Number(button.dataset.size) === size));
}
function updateRefresh() {
  const state = snapshot?.quota.state;
  const unsupported = snapshot?.quota.provider === 'workbuddy';
  $('#refresh-quota').disabled = !state || unsupported || refreshing || state.status === 'loading' || Date.now() < state.nextAllowedAt;
  $('#refresh-quota').textContent = unsupported ? '暂不支持' : refreshing || state?.status === 'loading' ? '查询中…' : '刷新';
}
function render(value) {
  if (!value || (snapshot && value.revision < snapshot.revision)) return;
  snapshot = value;
  $('#connection-error').hidden = true;
  if (!sizeTimer) sizeFields(value.petSize);
  $('#auto-actions').checked = value.autoActions;
  $('#visibility').textContent = value.visible ? '隐藏星渊' : '显示星渊';
  $('#current-action').textContent = labels[value.action] || '等待播放';
  document.querySelectorAll('[data-action]').forEach(button => {
    const selected = button.dataset.action === value.action;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('[name=provider]').forEach(input => { input.checked = input.value === value.quota.provider; });
  document.querySelectorAll('[name=quota-mode]').forEach(input => { input.checked = input.value === value.quota.mode; });
  const state = value.quota.state;
  const unsupported = value.quota.provider === 'workbuddy';
  $('#quota-status').textContent = unsupported ? '未接通' : {ready:'已接通 · 数据已更新',loading:'正在读取平台数据',idle:'等待查询',error:'暂不可用'}[state.status] || '等待查询';
  $('#quota-message').textContent = unsupported ? 'WorkBuddy 尚未接通安全的积分读取方式，请在其个人中心查看。' : state.status === 'ready' ? '可通过悬停或固定卡片查看各额度窗口的剩余比例。' : state.message || '只读查询，不发起模型对话。';
  $('#save-status').textContent = '偏好自动保存 · 关闭窗口不退出桌宠';
  updateRefresh();
}
async function perform(operation) {
  try {
    const value = await operation();
    if (!value) throw new Error('Invalid settings response');
    render(value);
  } catch {
    $('#connection-error').hidden = false;
    $('#save-status').textContent = '本次操作未确认成功';
  }
}
function applySize(value) {
  clearTimeout(sizeTimer); sizeTimer = null;
  const size = clamp(value); sizeFields(size);
  return perform(() => api.setSettings({petSize:size}));
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('main>section').forEach(section => { section.hidden = section.id !== button.dataset.tab; });
  document.querySelectorAll('[data-tab]').forEach(item => {
    item.classList.toggle('selected', item === button);
    if (item === button) item.setAttribute('aria-current','page'); else item.removeAttribute('aria-current');
  });
  $('#page-heading').textContent = titles[button.dataset.tab];
  $('#page-description').textContent = descriptions[button.dataset.tab];
}));
$('#size-slider').addEventListener('input', event => {
  clearTimeout(sizeTimer); sizeFields(event.target.value);
  sizeTimer = setTimeout(() => applySize(event.target.value), 65);
});
$('#size-slider').addEventListener('change', event => applySize(event.target.value));
$('#size-number').addEventListener('change', event => { event.target.value = String(clamp(event.target.value)); applySize(event.target.value); });
$('#smaller').addEventListener('click', () => applySize(Number($('#size-slider').value)-10));
$('#larger').addEventListener('click', () => applySize(Number($('#size-slider').value)+10));
$('#size-reset').addEventListener('click', () => applySize(260));
document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => applySize(button.dataset.size)));
$('#auto-actions').addEventListener('change', event => perform(() => api.setSettings({autoActions:event.target.checked})));
$('#visibility').addEventListener('click', () => perform(() => api.settingsCommand(snapshot?.visible ? 'hide' : 'show')));
$('#home').addEventListener('click', () => perform(() => api.settingsCommand('home')));
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => perform(() => api.settingsCommand('action',button.dataset.action))));
document.querySelectorAll('[name=provider]').forEach(input => input.addEventListener('change', () => perform(() => api.setSettings({quotaProvider:input.value}))));
document.querySelectorAll('[name=quota-mode]').forEach(input => input.addEventListener('change', () => perform(() => api.setSettings({quotaMode:input.value}))));
$('#refresh-quota').addEventListener('click', async () => {
  refreshing = true; updateRefresh();
  try { await perform(() => api.settingsCommand('refresh')); } finally { refreshing = false; updateRefresh(); }
});
$('#done').addEventListener('click', () => api.closeSettings());
window.addEventListener('keydown', event => { if (event.key === 'Escape') api.closeSettings(); });
api.onSettingsChanged(render);
perform(() => api.getSettings());
setInterval(updateRefresh,1000);
