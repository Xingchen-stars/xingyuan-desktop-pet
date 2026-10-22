const { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } = require('electron');
const fs = require('fs');
const path = require('path');
const { QuotaService, PROVIDERS, MODES } = require('./quota.cjs');
const { clampBounds, homeBounds, rememberPosition, restoreBounds } = require('./geometry.cjs');

const captureArg = process.argv.find((arg) => arg.startsWith('--capture='));
const capturePath = captureArg ? path.resolve(captureArg.slice('--capture='.length)) : null;
const captureDelayArg = process.argv.find((arg) => arg.startsWith('--capture-delay='));
const captureDelayMs = captureDelayArg
  ? Math.max(200, Math.min(15000, Number(captureDelayArg.slice('--capture-delay='.length)) || 1200))
  : 1200;
const verifyArg = process.argv.find((arg) => arg.startsWith('--verify-app='));
const verifyPath = verifyArg ? path.resolve(verifyArg.slice('--verify-app='.length)) : null;
const actionArg = process.argv.find((arg) => arg.startsWith('--action='));
const captureAction = actionArg ? actionArg.slice('--action='.length) : 'idle';
const defaultPetSize = 260;
const minPetSize = 150;
const maxPetSize = 520;
const trayTooltip = '星渊桌宠';
// On Windows, the floating level can be demoted behind a non-topmost taskbar.
// Keep the pet above normal apps; geometry still excludes the taskbar work area.
const topmostLevel = process.platform === 'win32' ? 'screen-saver' : 'floating';
const testUserDataArg = process.argv.find((arg) => arg.startsWith('--test-user-data='));

app.setName('星渊桌宠');
app.setAppUserModelId('com.xingyuan.desktop-pet');

// Windows layered transparent windows can expose the hidden RGB plane of an
// alpha WebM when Chromium promotes the video to a hardware overlay. Software
// compositing keeps the video alpha, DOM controls and DWM window in one layer.
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
}

if (testUserDataArg) {
  app.setPath('userData', path.resolve(testUserDataArg.slice('--test-user-data='.length)));
} else if (capturePath || verifyPath) {
  app.setPath('userData', path.join(app.getPath('temp'), `xingyuan-video-pet-v1-test-${process.pid}`));
}

const settingsPath = path.join(app.getPath('userData'), 'xingyuan-settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};

function clampPetSize(value) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) {
    return defaultPetSize;
  }
  return Math.max(minPetSize, Math.min(maxPetSize, numeric));
}

function loadPetSize() {
  try {
    return clampPetSize(settings.petSize);
  } catch {
    return defaultPetSize;
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  settings = { ...settings, petSize, petPosition, autoActions, quotaProvider: quotaService.provider, quotaMode };
  const temporary = `${settingsPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, settingsPath);
}

if (!capturePath && !verifyPath && !app.requestSingleInstanceLock()) {
  app.quit();
}

let petWindow = null;
let sizeWindow = null;
let settingsWindow = null;
let settingsLoaded = false;
let settingsRevision = 0;
let currentAction = 'idle';
const actionNames = ['idle', 'active', 'sleep', 'sleep-loop'];
let quotaWindow = null;
let quotaLoaded = false;
let quotaTimer = null;
let quotaMode = MODES.includes(settings.quotaMode) ? settings.quotaMode : 'hover';
let lastQuotaHoverAt = 0;
const quotaService = new QuotaService({ provider: settings.quotaProvider, onChange: broadcastQuota });
let tray = null;
let isQuitting = false;
let petSize = loadPetSize();
let dragTimer = null;
let dragOffset = null;
let hoverTimer = null;
let lastHoverState = null;
let petPosition = settings.petPosition;
let autoActions = typeof settings.autoActions === 'boolean' ? settings.autoActions : true;
let positionSaveTimer = null;
let inputBusy = false;
let menuOpen = false;
let windowInteractive = null;
let pointerProbe = null;
let pointerSeq = 0;
let lastBodyHoverAt = 0;

function isPetSender(event) {
  return petWindow && !petWindow.isDestroyed() && event.sender === petWindow.webContents
    && event.senderFrame === petWindow.webContents.mainFrame;
}

function setWindowInteractive(hit) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const next = petWindow.isVisible() && Boolean(hit || inputBusy || dragOffset || menuOpen);
  if (next === windowInteractive) return;
  windowInteractive = next;
  petWindow.setIgnoreMouseEvents(!next, { forward: true });
  if (next) {
    petWindow.moveTop();
    petWindow.setAlwaysOnTop(true, topmostLevel);
  }
}

function updatePetHover(hit) {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (hit) lastBodyHoverAt = Date.now();
  const visible = petWindow.isVisible() && Boolean(hit || inputBusy || dragOffset || menuOpen
    || Date.now() - lastBodyHoverAt < 300);
  if (visible !== lastHoverState) {
    lastHoverState = visible;
    petWindow.webContents.send('xingyuan-pet:hover-changed', visible);
  }
  if (hit || inputBusy || menuOpen) lastQuotaHoverAt = Date.now();
}

function getPetBounds() {
  return restoreBounds(petPosition, petSize, screen.getAllDisplays(), screen.getPrimaryDisplay());
}

function savePosition() {
  clearTimeout(positionSaveTimer);
  if (!petWindow || petWindow.isDestroyed() || capturePath || verifyPath) return;
  const bounds = petWindow.getBounds();
  petPosition = rememberPosition(bounds, screen.getDisplayMatching(bounds));
  saveSettings();
}

function keepPetOnScreen() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const safe = clampBounds({ ...bounds, width: petSize, height: petSize }, screen.getDisplayMatching(bounds).workArea);
  if (safe.x !== bounds.x || safe.y !== bounds.y || safe.width !== bounds.width || safe.height !== bounds.height) {
    petWindow.setBounds(safe, false);
  }
}

function resetPetPosition() {
  endWindowDrag();
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  petWindow.setBounds(homeBounds(petSize, screen.getPrimaryDisplay().workArea), false);
  savePosition();
  showPetWindow();
}

function setAutoActions(enabled) {
  autoActions = Boolean(enabled);
  if (!capturePath && !verifyPath) saveSettings();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('xingyuan-pet:behaviour-changed', behaviourSnapshot());
  }
  refreshTrayMenu();
  broadcastSettings();
}

function behaviourSnapshot() {
  return { autoActions, visible: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) };
}

function desktopMenuItems() {
  return [
    { label: '自主小动作', type: 'checkbox', checked: autoActions, click: item => setAutoActions(item.checked) },
    { label: '回到初始位置', click: resetPetPosition },
  ];
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu());
  }
}

function setPetSize(value, persist = true) {
  petSize = clampPetSize(value);

  if (petWindow && !petWindow.isDestroyed()) {
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const targetX = Math.max(workArea.x, Math.min(bounds.x + bounds.width - petSize, workArea.x + workArea.width - petSize));
    const targetY = Math.max(workArea.y, Math.min(bounds.y + bounds.height - petSize, workArea.y + workArea.height - petSize));
    petWindow.setBounds({ x: Math.round(targetX), y: Math.round(targetY), width: petSize, height: petSize }, true);
  }

  if (persist && !capturePath && !verifyPath) {
    saveSettings();
  }

  if (sizeWindow && !sizeWindow.isDestroyed()) {
    sizeWindow.webContents.send('xingyuan-pet:size-changed', petSize);
  }
  refreshTrayMenu();
  broadcastSettings();
  return petSize;
}

function endWindowDrag() {
  const wasDragging = Boolean(dragTimer);
  dragOffset = null;
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  if (wasDragging) {
    keepPetOnScreen();
    savePosition();
  }
}

function stopHoverTracking() {
  if (hoverTimer) {
    clearInterval(hoverTimer);
    hoverTimer = null;
  }
  lastHoverState = null;
  pointerProbe = null;
}

function startHoverTracking() {
  stopHoverTracking();
  hoverTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }
    const point = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    const isInside = petWindow.isVisible()
      && point.x >= bounds.x
      && point.x < bounds.x + bounds.width
      && point.y >= bounds.y
      && point.y < bounds.y + bounds.height;
    if (isInside) {
      const seq = ++pointerSeq;
      pointerProbe = { seq, point, bounds, at: Date.now() };
      petWindow.webContents.send('xingyuan-pet:pointer-probe', {
        seq, x: (point.x - bounds.x) / bounds.width, y: (point.y - bounds.y) / bounds.height,
      });
    } else {
      pointerProbe = null;
      setWindowInteractive(false);
      updatePetHover(false);
    }
    const panelBounds = quotaWindow && !quotaWindow.isDestroyed() && quotaWindow.isVisible() ? quotaWindow.getBounds() : null;
    const inPanel = panelBounds && point.x >= panelBounds.x && point.x < panelBounds.x + panelBounds.width
      && point.y >= panelBounds.y && point.y < panelBounds.y + panelBounds.height;
    if (inPanel) lastQuotaHoverAt = Date.now();
    syncQuotaVisibility();
  }, 50);
}

function beginWindowDrag(grab) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  endWindowDrag();
  const cursor = screen.getCursorScreenPoint();
  const bounds = petWindow.getBounds();
  const validGrab = grab && Number.isFinite(grab.x) && Number.isFinite(grab.y)
    && grab.x >= 0 && grab.x < 1 && grab.y >= 0 && grab.y < 1;
  dragOffset = validGrab ? { x: grab.x * bounds.width, y: grab.y * bounds.height }
    : { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  const moveDraggedWindow = () => {
    if (!dragOffset || !petWindow || petWindow.isDestroyed()) {
      endWindowDrag();
      return;
    }
    const point = screen.getCursorScreenPoint();
    petWindow.setBounds({
      x: Math.round(point.x - dragOffset.x), y: Math.round(point.y - dragOffset.y),
      width: petSize, height: petSize,
    }, false);
  };
  // Apply the threshold-crossing movement immediately, even if the pointer is
  // released before the first 16 ms timer tick.
  moveDraggedWindow();
  dragTimer = setInterval(moveDraggedWindow, 16);
}

function sendAction(action) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.webContents.send('xingyuan-pet:action', action);
}

function showPetWindow() {
  if (!petWindow || petWindow.isDestroyed()) {
    createPetWindow();
    return;
  }

  if (petWindow.isMinimized()) {
    petWindow.restore();
  }

  keepPetOnScreen();
  petWindow.show();
  petWindow.moveTop();
  petWindow.setAlwaysOnTop(true, topmostLevel);
  petWindow.focus();
  syncQuotaVisibility();
}

function hidePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
  if (quotaWindow && !quotaWindow.isDestroyed()) quotaWindow.hide();
}

function quotaSnapshot() {
  return { provider: quotaService.provider, mode: quotaMode, state: quotaService.state() };
}

function broadcastQuota() {
  if (quotaWindow && !quotaWindow.isDestroyed() && quotaLoaded) {
    quotaWindow.webContents.send('xingyuan-pet:quota-changed', quotaSnapshot());
  }
  broadcastSettings();
}

function settingsSnapshot() {
  return { revision: settingsRevision, petSize, autoActions, action: currentAction,
    visible: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
    quota: quotaSnapshot() };
}

function broadcastSettings() {
  settingsRevision++;
  if (settingsLoaded && settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('xingyuan-pet:settings-changed', settingsSnapshot());
  }
}

function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show(); settingsWindow.focus(); broadcastSettings();
    return;
  }
  const work = screen.getDisplayMatching(petWindow.getBounds()).workArea;
  settingsLoaded = false;
  settingsWindow = new BrowserWindow({
    width: Math.min(780, work.width), height: Math.min(720, work.height),
    minWidth: Math.min(600, work.width), minHeight: Math.min(480, work.height),
    title: '星渊桌宠 · 设置', backgroundColor: '#101526', show: false,
    maximizable: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'pet-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.setAlwaysOnTop(true, topmostLevel);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', event => event.preventDefault());
  settingsWindow.webContents.once('did-finish-load', () => { settingsLoaded = true; broadcastSettings(); });
  settingsWindow.once('ready-to-show', () => { settingsWindow.show(); settingsWindow.focus(); });
  settingsWindow.on('closed', () => { settingsWindow = null; settingsLoaded = false; });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
}

function positionQuotaWindow() {
  if (!petWindow || petWindow.isDestroyed() || !quotaWindow || quotaWindow.isDestroyed()) return;
  const pet = petWindow.getBounds();
  const work = screen.getDisplayMatching(pet).workArea;
  const width = Math.min(310, work.width), height = Math.min(410, work.height);
  let x = pet.x - width - 8;
  if (x < work.x) x = pet.x + pet.width + 8;
  x = Math.max(work.x, Math.min(x, work.x + work.width - width));
  const y = Math.max(work.y, Math.min(pet.y + pet.height - height, work.y + work.height - height));
  quotaWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}

function ensureQuotaWindow() {
  if (quotaWindow && !quotaWindow.isDestroyed()) return;
  quotaLoaded = false;
  quotaWindow = new BrowserWindow({
    width: 310, height: 410, title: '', frame: false, transparent: true,
    thickFrame: false, resizable: false, maximizable: false, minimizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'pet-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  quotaWindow.setMenuBarVisibility(false);
  quotaWindow.setAlwaysOnTop(true, topmostLevel);
  quotaWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  quotaWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  quotaWindow.webContents.once('did-finish-load', () => {
    quotaLoaded = true; broadcastQuota(); syncQuotaVisibility();
  });
  quotaWindow.on('closed', () => { quotaWindow = null; quotaLoaded = false; });
  quotaWindow.loadFile(path.join(__dirname, 'quota.html'));
  positionQuotaWindow();
}

function syncQuotaVisibility() {
  const visible = petWindow && !petWindow.isDestroyed() && petWindow.isVisible()
    && quotaMode !== 'off' && (quotaMode === 'pinned' || Date.now() - lastQuotaHoverAt < 450);
  if (visible && !capturePath && !verifyPath) {
    ensureQuotaWindow();
    if (quotaLoaded && !quotaWindow.isVisible()) {
      positionQuotaWindow(); quotaWindow.showInactive(); quotaService.refresh();
    }
  } else if (quotaWindow && !quotaWindow.isDestroyed() && quotaWindow.isVisible()) {
    quotaWindow.hide();
  }
}

function setQuotaOptions(options) {
  if (!options || typeof options !== 'object') return quotaSnapshot();
  if (PROVIDERS.includes(options.provider)) quotaService.select(options.provider);
  if (MODES.includes(options.mode)) quotaMode = options.mode;
  if (!capturePath && !verifyPath) saveSettings();
  syncQuotaVisibility(); broadcastQuota(); refreshTrayMenu();
  if (quotaMode !== 'off') quotaService.refresh();
  return quotaSnapshot();
}

function quotaMenuItems() {
  return [
    { label: '查看额度与积分', click: () => { showPetWindow(); setQuotaOptions({ mode: 'pinned' }); } },
    { label: '额度平台', submenu: PROVIDERS.map((provider) => ({
      label: provider === 'codex' ? 'Codex · 额度' : 'WorkBuddy · 积分（未接通）',
      type: 'radio', checked: quotaService.provider === provider,
      click: () => setQuotaOptions({ provider }),
    })) },
    { label: '额度显示方式', submenu: [
      { label: '鼠标移入时显示', type: 'radio', checked: quotaMode === 'hover', click: () => setQuotaOptions({ mode: 'hover' }) },
      { label: '固定显示', type: 'radio', checked: quotaMode === 'pinned', click: () => setQuotaOptions({ mode: 'pinned' }) },
      { label: '关闭额度显示', type: 'radio', checked: quotaMode === 'off', click: () => setQuotaOptions({ mode: 'off' }) },
    ] },
  ];
}

function showSizeWindow() {
  if (sizeWindow && !sizeWindow.isDestroyed()) {
    sizeWindow.show();
    sizeWindow.focus();
    sizeWindow.webContents.send('xingyuan-pet:size-changed', petSize);
    return;
  }

  sizeWindow = new BrowserWindow({
    width: 430,
    height: 330,
    title: '星渊桌宠大小',
    resizable: false,
    maximizable: false,
    minimizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  sizeWindow.setMenuBarVisibility(false);
  sizeWindow.loadFile(path.join(__dirname, 'size.html'));
  sizeWindow.on('closed', () => {
    sizeWindow = null;
  });
}

function sizePresetMenu() {
  return [180, 220, 260, 320, 360, 420].map((size) => ({
    label: `${size} px`,
    type: 'radio',
    checked: petSize === size,
    click: () => setPetSize(size),
  }));
}

function showActionMenu() {
  if (!petWindow || petWindow.isDestroyed() || menuOpen) {
    return;
  }

  const menu = Menu.buildFromTemplate([
    { label: '设置…', click: showSettingsWindow },
    { type: 'separator' },
    { label: '安静待机', click: () => sendAction('idle') },
    { label: '活泼一下', click: () => sendAction('active') },
    { label: '进入睡眠', click: () => sendAction('sleep') },
    { label: '熟睡循环', click: () => sendAction('sleep-loop') },
    { type: 'separator' },
    { label: `调整大小（${petSize} px）…`, click: showSizeWindow },
    { label: '常用大小', submenu: sizePresetMenu() },
    ...desktopMenuItems(),
    { type: 'separator' },
    ...quotaMenuItems(),
    { type: 'separator' },
    { label: '隐藏到后台', click: hidePetWindow },
    { label: '退出应用', click: () => app.quit() },
  ]);
  menuOpen = true;
  setWindowInteractive(true);
  menu.popup({ window: petWindow, callback: () => {
    menuOpen = false;
    setWindowInteractive(false);
  } });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '设置…', click: showSettingsWindow },
    { type: 'separator' },
    { label: '显示星渊', click: showPetWindow },
    { label: '隐藏星渊', click: hidePetWindow },
    { type: 'separator' },
    { label: '安静待机', click: () => sendAction('idle') },
    { label: '活泼一下', click: () => sendAction('active') },
    { label: '进入睡眠', click: () => sendAction('sleep') },
    { label: '熟睡循环', click: () => sendAction('sleep-loop') },
    { type: 'separator' },
    { label: `调整大小（${petSize} px）…`, click: showSizeWindow },
    { label: '常用大小', submenu: sizePresetMenu() },
    ...desktopMenuItems(),
    { type: 'separator' },
    ...quotaMenuItems(),
    { type: 'separator' },
    { label: '退出星渊桌宠', click: () => app.quit() },
  ]);
}

function createTray() {
  if (capturePath || tray) {
    return;
  }

  const iconPath = path.join(__dirname, '..', 'reference', 'xingyuan-animation-master-v1.png');
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32, quality: 'best' });
  if (trayIcon.isEmpty()) {
    throw new Error(`Tray icon could not be loaded: ${iconPath}`);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip(trayTooltip);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showPetWindow);
  tray.on('double-click', showPetWindow);
}

app.on('second-instance', () => {
  showPetWindow();
});

function createPetWindow() {
  const initialBounds = getPetBounds();

  petWindow = new BrowserWindow({
    ...initialBounds,
    title: '',
    transparent: true,
    frame: false,
    useContentSize: true,
    thickFrame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  petWindow.setAlwaysOnTop(true, topmostLevel);
  windowInteractive = null;
  setWindowInteractive(false);
  petWindow.setMenuBarVisibility(false);
  petWindow.setTitle('');
  petWindow.loadFile(path.join(__dirname, 'index.html'));
  petWindow.webContents.on('context-menu', showActionMenu);

  petWindow.once('ready-to-show', () => {
    petWindow.show();
    // Windows may round a newly created transparent window during its first
    // per-monitor DPI transition. Reapply the requested outer bounds once shown.
    petWindow.setBounds(initialBounds, false);
    petWindow.moveTop();
    petWindow.setAlwaysOnTop(true, topmostLevel);
  });

  petWindow.webContents.once('did-finish-load', async () => {
    petWindow.webContents.send('xingyuan-pet:behaviour-changed', behaviourSnapshot());
    await petWindow.webContents.executeJavaScript(`window.xingyuanPetRuntime.playAction(${JSON.stringify(captureAction)})`);
    startHoverTracking();

    if (capturePath) {
      setTimeout(async () => {
        const image = await petWindow.webContents.capturePage();
        fs.mkdirSync(path.dirname(capturePath), { recursive: true });
        fs.writeFileSync(capturePath, image.toPNG());
        app.quit();
      }, captureDelayMs);
    }
  });

  petWindow.on('closed', () => {
    endWindowDrag();
    stopHoverTracking();
    petWindow = null;
  });
  petWindow.on('move', () => {
    positionQuotaWindow();
    clearTimeout(positionSaveTimer);
    positionSaveTimer = setTimeout(savePosition, 300);
  });
  petWindow.on('resize', positionQuotaWindow);
  petWindow.on('show', () => {
    petWindow.webContents.send('xingyuan-pet:behaviour-changed', behaviourSnapshot());
    broadcastSettings();
  });
  petWindow.on('hide', () => {
    inputBusy = false;
    endWindowDrag();
    setWindowInteractive(false);
    petWindow.webContents.send('xingyuan-pet:behaviour-changed', behaviourSnapshot());
    if (quotaWindow && !quotaWindow.isDestroyed()) quotaWindow.hide();
    broadcastSettings();
  });
  petWindow.on('blur', () => { inputBusy = false; endWindowDrag(); });

  petWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hidePetWindow();
    }
  });
}

ipcMain.on('xingyuan-pet:close', () => app.quit());
ipcMain.on('xingyuan-pet:minimize', hidePetWindow);
ipcMain.on('xingyuan-pet:drag-start', (event, grab) => {
  if (isPetSender(event)) {
    beginWindowDrag(grab);
  }
});
ipcMain.on('xingyuan-pet:drag-end', (event) => {
  if (petWindow && event.sender === petWindow.webContents) {
    endWindowDrag();
  }
});
ipcMain.on('xingyuan-pet:input-busy', (event, busy) => {
  if (!isPetSender(event) || typeof busy !== 'boolean') return;
  inputBusy = busy;
  setWindowInteractive(false);
});
ipcMain.on('xingyuan-pet:pointer-result', (event, result) => {
  if (!isPetSender(event) || !result || typeof result.body !== 'boolean' || typeof result.controls !== 'boolean') return;
  const probe = pointerProbe;
  if (!probe || result.seq !== probe.seq || Date.now() - probe.at > 200) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = petWindow.getBounds();
  if (Math.hypot(cursor.x - probe.point.x, cursor.y - probe.point.y) > 4
    || bounds.x !== probe.bounds.x || bounds.y !== probe.bounds.y
    || bounds.width !== probe.bounds.width || bounds.height !== probe.bounds.height) return;
  const hit = result.body || result.controls;
  setWindowInteractive(hit);
  updatePetHover(hit);
  syncQuotaVisibility();
});
// Forwarded mousemove gives the first entry a fast path; polling remains the
// fallback for stationary pointers while the animated silhouette changes.
ipcMain.on('xingyuan-pet:pointer-move', (event, result) => {
  if (!isPetSender(event) || !result || !petWindow.isVisible()
    || typeof result.body !== 'boolean' || typeof result.controls !== 'boolean'
    || !Number.isFinite(result.x) || !Number.isFinite(result.y)
    || result.x < 0 || result.x >= 1 || result.y < 0 || result.y >= 1) return;
  const bounds = petWindow.getBounds();
  const cursor = screen.getCursorScreenPoint();
  if (Math.hypot(cursor.x - bounds.x - result.x * bounds.width,
    cursor.y - bounds.y - result.y * bounds.height) > 4) return;
  const hit = result.body || result.controls;
  setWindowInteractive(hit);
  updatePetHover(hit);
  syncQuotaVisibility();
});
ipcMain.on('xingyuan-pet:menu', (event) => {
  if (petWindow && event.sender === petWindow.webContents) {
    showActionMenu();
  }
});
ipcMain.on('xingyuan-pet:action-state', (event, action) => {
  if (!isPetSender(event) || !actionNames.includes(action)) return;
  currentAction = action; broadcastSettings();
});
function isSettingsSender(event) {
  return settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents
    && event.senderFrame === settingsWindow.webContents.mainFrame;
}
ipcMain.handle('xingyuan-pet:settings-get', event => isSettingsSender(event) ? settingsSnapshot() : null);
ipcMain.handle('xingyuan-pet:settings-set', (event, patch) => {
  if (!isSettingsSender(event) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const keys = Object.keys(patch);
  if (keys.some(key => !['petSize', 'autoActions', 'quotaProvider', 'quotaMode'].includes(key))
    || ('petSize' in patch && !Number.isFinite(patch.petSize))
    || ('autoActions' in patch && typeof patch.autoActions !== 'boolean')
    || ('quotaProvider' in patch && !PROVIDERS.includes(patch.quotaProvider))
    || ('quotaMode' in patch && !MODES.includes(patch.quotaMode))) return null;
  if ('petSize' in patch) setPetSize(patch.petSize);
  if ('autoActions' in patch) setAutoActions(patch.autoActions);
  if ('quotaProvider' in patch || 'quotaMode' in patch) {
    setQuotaOptions({ provider: patch.quotaProvider, mode: patch.quotaMode });
  }
  return settingsSnapshot();
});
ipcMain.handle('xingyuan-pet:settings-command', async (event, command, value) => {
  if (!isSettingsSender(event)) return null;
  if (command === 'show') showPetWindow();
  else if (command === 'hide') hidePetWindow();
  else if (command === 'home') resetPetPosition();
  else if (command === 'action' && actionNames.includes(value)) { showPetWindow(); sendAction(value); }
  else if (command === 'refresh') await quotaService.refresh(true);
  else return null;
  return settingsSnapshot();
});
ipcMain.on('xingyuan-pet:settings-close', event => {
  if (isSettingsSender(event)) settingsWindow.close();
});
ipcMain.handle('xingyuan-pet:get-size', () => petSize);
ipcMain.handle('xingyuan-pet:get-behaviour', event => {
  return petWindow && event.sender === petWindow.webContents
    && event.senderFrame === petWindow.webContents.mainFrame ? behaviourSnapshot() : null;
});
ipcMain.handle('xingyuan-pet:set-size', (event, value) => {
  if (
    (petWindow && event.sender === petWindow.webContents) ||
    (sizeWindow && event.sender === sizeWindow.webContents)
  ) {
    return setPetSize(value);
  }
  return petSize;
});
ipcMain.on('xingyuan-pet:size-panel-close', (event) => {
  if (sizeWindow && event.sender === sizeWindow.webContents) {
    sizeWindow.close();
  }
});

function isQuotaSender(event) {
  return [petWindow, quotaWindow].some((window) => window && !window.isDestroyed()
    && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
}
ipcMain.handle('xingyuan-pet:quota-get', (event) => isQuotaSender(event) ? quotaSnapshot() : null);
ipcMain.handle('xingyuan-pet:quota-set', (event, options) => isQuotaSender(event) ? setQuotaOptions(options) : null);
ipcMain.handle('xingyuan-pet:quota-refresh', async (event) => {
  if (!isQuotaSender(event)) return null;
  await quotaService.refresh(true);
  return quotaSnapshot();
});

app.whenReady().then(() => {
  createPetWindow();
  createTray();
  const recoverPosition = () => { keepPetOnScreen(); savePosition(); };
  screen.on('display-removed', recoverPosition);
  screen.on('display-metrics-changed', recoverPosition);
  if (!capturePath && !verifyPath) {
    quotaTimer = setInterval(() => {
      if (quotaMode !== 'off' && petWindow?.isVisible()) quotaService.refresh();
    }, 5000);
    if (quotaMode !== 'off') quotaService.refresh();
  }

  if (verifyPath) {
    setTimeout(async () => {
      let rendererBeforeHover = null;
      let rendererAfterHover = null;
      let verificationError = null;

      try {
        rendererBeforeHover = await petWindow.webContents.executeJavaScript(`(() => {
          const controls = document.querySelector('.window-controls');
          return {
            controlsFound: Boolean(controls),
            controlsOpacity: controls ? getComputedStyle(controls).opacity : null,
            currentAction: window.xingyuanPetRuntime.currentAction(),
          };
        })()`);
        petWindow.webContents.sendInputEvent({ type: 'mouseMove', x: Math.max(1, petSize - 24), y: 24 });
        await new Promise((resolve) => setTimeout(resolve, 250));
        rendererAfterHover = await petWindow.webContents.executeJavaScript(`(() => {
          const controls = document.querySelector('.window-controls');
          return {
            controlsFound: Boolean(controls),
            controlsOpacity: controls ? getComputedStyle(controls).opacity : null,
          };
        })()`);
      } catch (error) {
        verificationError = String(error && error.stack ? error.stack : error);
      }

      const initialPetSize = petSize;
      const resizedPetSize = setPetSize(320, false);
      const resizedWindowBounds = petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : null;
      showSizeWindow();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const verification = {
        appName: app.getName(),
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        executable: process.execPath,
        trayCreated: Boolean(tray && !tray.isDestroyed()),
        trayTooltip: tray && !tray.isDestroyed() ? trayTooltip : null,
        hardwareAccelerationDisabledRequested: process.platform === 'win32',
        gpuFeatureStatus: app.getGPUFeatureStatus(),
        initialPetSize,
        resizedPetSize,
        resizedWindowBounds,
        sizePanelCreated: Boolean(sizeWindow && !sizeWindow.isDestroyed()),
        sizePanelTitle: sizeWindow && !sizeWindow.isDestroyed() ? sizeWindow.getTitle() : null,
        sleepAssetExists: fs.existsSync(path.join(__dirname, '..', 'edit', 'animations', 'generated-sleep-v1', 'xingyuan-sleep-alpha-v1.webm')),
        sleepLoopAssetExists: fs.existsSync(path.join(__dirname, '..', 'edit', 'animations', 'generated-sleep-loop-v1', 'xingyuan-sleep-loop-alpha-v1.webm')),
        windowCreated: Boolean(petWindow && !petWindow.isDestroyed()),
        windowTitle: petWindow && !petWindow.isDestroyed() ? petWindow.getTitle() : null,
        windowVisible: petWindow && !petWindow.isDestroyed() ? petWindow.isVisible() : false,
        rendererBeforeHover,
        rendererAfterHover,
        verificationError,
      };
      fs.mkdirSync(path.dirname(verifyPath), { recursive: true });
      fs.writeFileSync(verifyPath, `${JSON.stringify(verification, null, 2)}\n`, 'utf8');
      app.quit();
    }, 1500);
  }
});
app.on('before-quit', () => {
  isQuitting = true;
  endWindowDrag();
  savePosition();
  clearTimeout(positionSaveTimer);
  stopHoverTracking();
  clearInterval(quotaTimer);
  quotaService.dispose();
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
});
app.on('window-all-closed', () => {
  if (capturePath || verifyPath) {
    app.quit();
  }
});
