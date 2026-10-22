// Geometry is kept independent of Electron so monitor changes can be tested.
function clampBounds(bounds, workArea) {
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width));
  const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - bounds.height));
  return { ...bounds, x: Math.round(x), y: Math.round(y) };
}

function homeBounds(size, workArea) {
  return clampBounds({
    width: size, height: size,
    x: workArea.x + workArea.width - size - 28,
    y: workArea.y + workArea.height - size - 24,
  }, workArea);
}

function rememberPosition(bounds, display) {
  const work = display.workArea;
  const safe = clampBounds(bounds, work);
  return {
    displayId: display.id,
    ratioX: (safe.x - work.x) / Math.max(1, work.width - safe.width),
    ratioY: (safe.y - work.y) / Math.max(1, work.height - safe.height),
  };
}

function restoreBounds(position, size, displays, primaryDisplay) {
  const valid = position && typeof position === 'object'
    && Number.isFinite(position.displayId)
    && Number.isFinite(position.ratioX) && position.ratioX >= 0 && position.ratioX <= 1
    && Number.isFinite(position.ratioY) && position.ratioY >= 0 && position.ratioY <= 1;
  const display = valid && displays.find(item => item.id === position.displayId);
  if (!display) return homeBounds(size, primaryDisplay.workArea);
  const work = display.workArea;
  return clampBounds({
    width: size, height: size,
    x: work.x + position.ratioX * Math.max(0, work.width - size),
    y: work.y + position.ratioY * Math.max(0, work.height - size),
  }, work);
}

module.exports = { clampBounds, homeBounds, rememberPosition, restoreBounds };
