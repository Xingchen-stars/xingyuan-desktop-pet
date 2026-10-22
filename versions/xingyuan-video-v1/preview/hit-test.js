(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XingyuanHitTest = api;
})(globalThis, function () {
  function contains(rect, x, y) {
    return Number.isFinite(x) && Number.isFinite(y) && x >= rect.left && y >= rect.top
      && x < rect.left + rect.width && y < rect.top + rect.height;
  }

  function sourcePoint(width, height, rect, x, y) {
    if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return null;
    const scale = Math.min(rect.width / width, rect.height / height);
    const content = { left: rect.left + (rect.width - width * scale) / 2,
      top: rect.top + (rect.height - height * scale) / 2, width: width * scale, height: height * scale };
    return contains(content, x, y) ? { x: (x - content.left) / scale, y: (y - content.top) / scale, scale } : null;
  }

  function alphaHit(pixels, opacity = 1) {
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] * opacity >= 24) return true;
    }
    return false;
  }

  function createTester(videos, controls) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 3;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    let warned = false;
    return function hitTest(x, y) {
      const style = getComputedStyle(controls);
      const onControls = Number(style.opacity) > 0.2 && contains(controls.getBoundingClientRect(), x, y);
      for (const video of videos) {
        const opacity = Number(getComputedStyle(video).opacity);
        if (video.readyState < 2 || opacity < 0.08) continue;
        const point = sourcePoint(video.videoWidth, video.videoHeight, video.getBoundingClientRect(), x, y);
        if (!point) continue;
        try {
          // Read a tiny patch, not a full-screen screenshot. A two-CSS-pixel
          // tolerance keeps fine fur/ears usable while holes remain click-through.
          const radius = 2 / point.scale;
          context.clearRect(0, 0, 3, 3);
          context.drawImage(video, point.x - radius, point.y - radius, radius * 2, radius * 2, 0, 0, 3, 3);
          if (alphaHit(context.getImageData(0, 0, 3, 3).data, opacity)) {
            return { body: true, controls: onControls };
          }
        } catch (error) {
          if (!warned) { console.warn('星渊透明命中检测不可用', error.name); warned = true; }
        }
      }
      return { body: false, controls: onControls };
    };
  }

  return { contains, sourcePoint, alphaHit, createTester };
});
