const slider = document.querySelector('#size-slider');
const number = document.querySelector('#size-number');
const output = document.querySelector('#size-output');

function clamp(value) {
  return Math.max(150, Math.min(520, Math.round(Number(value) || 260)));
}

function updateFields(value) {
  const size = clamp(value);
  slider.value = String(size);
  number.value = String(size);
  output.value = `${size} px`;
  return size;
}

async function apply(value) {
  const size = updateFields(value);
  const saved = await window.xingyuanPet.setSize(size);
  updateFields(saved);
}

slider.addEventListener('input', () => apply(slider.value));
number.addEventListener('change', () => apply(number.value));
document.querySelector('#smaller').addEventListener('click', () => apply(Number(slider.value) - 10));
document.querySelector('#larger').addEventListener('click', () => apply(Number(slider.value) + 10));
document.querySelector('#reset').addEventListener('click', () => apply(260));
document.querySelector('#done').addEventListener('click', () => window.xingyuanPet.closeSizePanel());

window.xingyuanPet.onSizeChanged(updateFields);
window.xingyuanPet.getSize().then(updateFields);
