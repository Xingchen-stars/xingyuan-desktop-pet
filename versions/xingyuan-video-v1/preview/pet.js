const videos = [
  document.querySelector('#pet-video-a'),
  document.querySelector('#pet-video-b'),
];
const error = document.querySelector('#load-error');

const actions = {
  idle: {
    label: '安静待机',
    src: '../edit/animations/generated-idle-v1/xingyuan-idle-alpha-v1.webm',
    loop: true,
  },
  active: {
    label: '活泼一下',
    src: '../edit/animations/generated-active-v1/xingyuan-active-alpha-v1.webm',
    loop: false,
    returnToIdle: true,
  },
  sleep: {
    label: '睡觉',
    src: '../edit/animations/generated-sleep-v1/xingyuan-sleep-alpha-v1.webm',
    loop: false,
    returnToIdle: false,
    nextAction: 'sleep-loop',
  },
  'sleep-loop': {
    label: '熟睡循环',
    src: '../edit/animations/generated-sleep-loop-v1/xingyuan-sleep-loop-alpha-v1.webm',
    loop: true,
  },
};

let activeVideo = videos[0];
let currentAction = 'idle';
let switchToken = 0;
const videoTokens = new WeakMap([[videos[0], 0], [videos[1], 0]]);
const lastVideoTimes = new WeakMap();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let autoActions = false;
let petVisible = false;
let nextAutoAt = Infinity;
let pointerInside = false;
let clickAnimation = null;

function planAutoAction() {
  nextAutoAt = Date.now() + 60000 + Math.random() * 60000;
}

function applyBehaviour(state) {
  autoActions = state?.autoActions === true;
  petVisible = state?.visible === true;
  planAutoAction();
}

async function playAction(actionName) {
  const action = actions[actionName] || actions.idle;
  const resolvedActionName = actions[actionName] ? actionName : 'idle';
  const token = ++switchToken;
  const nextVideo = activeVideo === videos[0] ? videos[1] : videos[0];

  error.hidden = true;
  videoTokens.set(nextVideo, token);
  nextVideo.loop = action.loop;
  nextVideo.src = action.src;
  nextVideo.currentTime = 0;

  try {
    await nextVideo.play();
  } catch {
    if (token === switchToken) error.hidden = false;
    return false;
  }

  if (token !== switchToken) {
    return false;
  }

  const previousVideo = activeVideo;
  const previousToken = videoTokens.get(previousVideo);
  nextVideo.classList.add('is-active');
  previousVideo.classList.remove('is-active');
  activeVideo = nextVideo;
  currentAction = resolvedActionName;
  window.xingyuanPet.reportAction(currentAction);
  lastVideoTimes.set(nextVideo, 0);
  planAutoAction();

  setTimeout(() => {
    if (previousVideo !== activeVideo && videoTokens.get(previousVideo) === previousToken) {
      previousVideo.pause();
      previousVideo.removeAttribute('src');
      previousVideo.load();
    }
  }, 220);

  return true;
}

document.querySelector('#close-button').addEventListener('click', () => {
  window.xingyuanPet.close();
});

document.querySelector('#minimize-button').addEventListener('click', () => {
  window.xingyuanPet.minimize();
});

document.querySelector('#menu-button').addEventListener('click', () => {
  window.xingyuanPet.menu();
});

for (const video of videos) {
  video.addEventListener('timeupdate', () => {
    const previous = lastVideoTimes.get(video) || 0;
    lastVideoTimes.set(video, video.currentTime);
    // Wait for a real idle loop boundary, never cut an idle clip halfway.
    if (video === activeVideo && videoTokens.get(video) === switchToken
      && currentAction === 'idle' && video.currentTime + 0.5 < previous
      && autoActions && petVisible && Date.now() >= nextAutoAt && !document.hidden
      && !reducedMotion.matches && !pointerInside && dragPointerId === null) {
      planAutoAction();
      playAction('active');
    }
  });

  video.addEventListener('error', () => {
    if (video === activeVideo || video.src) {
      error.hidden = false;
    }
  });

  video.addEventListener('ended', () => {
    if (video === activeVideo && videoTokens.get(video) === switchToken) {
      const next = actions[currentAction]?.nextAction;
      if (next) playAction(next);
      else if (actions[currentAction]?.returnToIdle) playAction('idle');
    }
  });
}

const stage = document.querySelector('.pet-stage');
const sprite = document.querySelector('.pet-sprite');
const hitTest = window.XingyuanHitTest.createTester(videos, document.querySelector('.window-controls'));
let dragPointerId = null;
let press = null;
let inputPointerId = null;

function releaseInput(event) {
  if (inputPointerId === null) return;
  if (event?.pointerId !== undefined && event.pointerId !== inputPointerId) return;
  inputPointerId = null;
  window.xingyuanPet.setInputBusy(false);
}

stage.addEventListener('pointerdown', event => {
  if (event.button !== 0 || inputPointerId !== null) return;
  const hit = hitTest(event.clientX, event.clientY);
  if (hit.body || hit.controls) {
    inputPointerId = event.pointerId;
    window.xingyuanPet.setInputBusy(true);
  }
}, true);
window.addEventListener('pointerup', releaseInput);
window.addEventListener('pointercancel', releaseInput);
window.addEventListener('blur', releaseInput);
stage.addEventListener('lostpointercapture', releaseInput);

function clickFeedback() {
  if (reducedMotion.matches) return;
  clickAnimation?.cancel();
  clickAnimation = sprite.animate([
    { transform: 'scale(1, 1)' },
    { transform: 'scale(1.025, 0.95)', offset: 0.3 },
    { transform: 'scale(0.99, 1.02)', offset: 0.7 },
    { transform: 'scale(1, 1)' },
  ], { duration: 340, easing: 'ease-out' });
}

function finishDrag(event, allowClick = false) {
  if (dragPointerId === null) {
    return;
  }
  if (event?.pointerId !== undefined && event.pointerId !== dragPointerId) return;

  const pointerId = dragPointerId;
  const wasDragging = press?.dragging;
  const wasClick = allowClick && press && !wasDragging && performance.now() - press.at < 600
    && Math.hypot(event.screenX - press.x, event.screenY - press.y) < 6;
  dragPointerId = null;
  press = null;
  if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  document.body.classList.remove('is-dragging');
  if (wasDragging) window.xingyuanPet.dragEnd();
  if (wasClick) clickFeedback();
}

stage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || dragPointerId !== null || event.target.closest('.window-controls')) {
    return;
  }
  if (!hitTest(event.clientX, event.clientY).body) return;

  dragPointerId = event.pointerId;
  press = { x: event.screenX, y: event.screenY, at: performance.now(), dragging: false,
    grabX: event.clientX / innerWidth, grabY: event.clientY / innerHeight };
  stage.setPointerCapture(event.pointerId);
  event.preventDefault();
});

stage.addEventListener('pointermove', event => {
  if (event.pointerId !== dragPointerId || !press || press.dragging) return;
  if (Math.hypot(event.screenX - press.x, event.screenY - press.y) >= 6) {
    press.dragging = true;
    clickAnimation?.cancel();
    document.body.classList.add('is-dragging');
    window.xingyuanPet.dragStart({ x: press.grabX, y: press.grabY });
  }
});

stage.addEventListener('pointerup', event => finishDrag(event, true));
stage.addEventListener('pointercancel', finishDrag);
stage.addEventListener('lostpointercapture', finishDrag);
window.addEventListener('blur', finishDrag);

window.xingyuanPet.onAction((action) => {
  playAction(action);
});

window.xingyuanPet.onHoverChanged((isInside) => {
  pointerInside = isInside;
  document.body.classList.toggle('is-pointer-inside', isInside);
});

window.xingyuanPet.onBehaviourChanged(applyBehaviour);
window.xingyuanPet.getBehaviour().then(applyBehaviour);
window.xingyuanPet.onPointerProbe(probe => {
  const hit = hitTest(probe.x * window.innerWidth, probe.y * window.innerHeight);
  window.xingyuanPet.pointerResult({ seq: probe.seq, ...hit });
});
let lastPointerMoveAt = -Infinity;
window.addEventListener('mousemove', event => {
  const now = performance.now();
  if (now - lastPointerMoveAt < 16) return;
  lastPointerMoveAt = now;
  const hit = hitTest(event.clientX, event.clientY);
  window.xingyuanPet.pointerMove({ x: event.clientX / innerWidth, y: event.clientY / innerHeight, ...hit });
}, { passive: true });

window.xingyuanPetRuntime = {
  playAction,
  currentAction: () => currentAction,
  hitTest,
};
