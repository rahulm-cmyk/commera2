// One resolution-independent canvas scene powers both the catalogue and checkout.
const palette = { ink: '#23413e', teal: '#168678', mint: '#d6ede5', blue: '#367ca5', sky: '#dcecf3', coral: '#e88a73', pink: '#f6dce1', gold: '#e8bd62', white: '#ffffff' };
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => { n = clamp(n); return n * n * (3 - 2 * n); };
const phase = (t, a, b) => ease((t - a) / (b - a));
const mix = (a, b, t) => a + (b - a) * t;

function shape(c, points, color, stroke) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  if (color) { c.fillStyle = color; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
}
function round(c, x, y, w, h, r, color) {
  c.fillStyle = color; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill();
}
function line(c, points, color, width = 3) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
}
function ellipse(c, x, y, rx, ry, color) {
  c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
}
function shadow(c, x, y, size = 80, opacity = 1) {
  c.save(); c.globalAlpha *= opacity * .12;
  ellipse(c, x, y, size, 8, palette.ink); c.restore();
}
function check(c, x, y, size, progress = 1, color = palette.teal) {
  c.save(); c.translate(x, y); c.scale(size / 50, size / 50);
  ellipse(c, 0, 0, 50, 50, color);
  c.beginPath(); c.moveTo(-21, 0); c.lineTo(-5, 16); c.lineTo(24, -17);
  c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = palette.white;
  c.setLineDash([80]); c.lineDashOffset = 80 * (1 - progress); c.stroke(); c.restore();
}
function product(c, x, y, size, image) {
  c.save(); c.translate(x, y);
  if (image?.complete && image.naturalWidth) {
    const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
    c.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale, image.naturalWidth * scale, image.naturalHeight * scale);
  } else {
    c.scale(size / 72, size / 72);
    round(c, -22, -59, 44, 59, 10, palette.teal);
    round(c, -14, -73, 28, 17, 4, palette.ink);
    round(c, -22, -41, 44, 25, 2, palette.mint);
    line(c, [[-10, -29], [10, -29]], palette.teal, 3);
    round(c, -15, -53, 4, 9, 2, '#48a596');
  }
  c.restore();
}
function parcel(c, x, y, scale = 1, open = 0, accent = palette.teal, ribbon = false) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  shape(c, [[-44, -22], [17, -35], [49, -17], [-13, -3]], '#e7eee9');
  shape(c, [[-44, -22], [-13, -3], [-13, 55], [-44, 33]], '#bfd4cd');
  shape(c, [[-13, -3], [49, -17], [49, 40], [-13, 55]], '#f4f7f2');
  if (open > .01) {
    shape(c, [[-44, -22], [17, -35], [17 - 22 * open, -35 - 28 * open], [-44 - 22 * open, -22 - 28 * open]], '#d9e5df');
    shape(c, [[-13, -3], [49, -17], [49 + 27 * open, -17 - 20 * open], [-13 + 27 * open, -3 - 20 * open]], '#eef4ef');
  } else {
    shape(c, [[-21, -27], [-12, -29], [21, -11], [12, -9]], accent);
    shape(c, [[12, -9], [21, -11], [21, 47], [12, 50]], accent);
  }
  shape(c, [[29, 4], [41, 1], [41, 17], [29, 20]], '#d6e4dd');
  line(c, [[31, 9], [38, 7]], '#8ea9a0', 1.5);
  if (ribbon) {
    line(c, [[-13, 17], [49, 3]], accent, 9);
    c.strokeStyle = accent; c.lineWidth = 5;
    c.beginPath(); c.ellipse(0, -33, 18, 8, .5, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(29, -37, 18, 8, -.5, 0, Math.PI * 2); c.stroke();
  }
  c.restore();
}
function wheel(c, x, y, r, spin) {
  ellipse(c, x, y, r, r, palette.ink); ellipse(c, x, y, r - 6, r - 6, '#e1e9e8');
  c.save(); c.translate(x, y); c.rotate(spin);
  for (let n = 0; n < 4; n++) { c.rotate(Math.PI / 4); line(c, [[-r + 9, 0], [r - 9, 0]], '#93aaa6', 2); }
  ellipse(c, 0, 0, 4, 4, palette.ink); c.restore();
}
function scooter(c, x, y, spin, accent) {
  c.save(); c.translate(x, y);
  shadow(c, 0, 29, 117); wheel(c, -69, 4, 25, spin); wheel(c, 76, 4, 25, spin);
  line(c, [[-79, -5], [-38, 7], [38, 7], [61, -10]], palette.ink, 10);
  c.fillStyle = accent; c.beginPath(); c.moveTo(-104, -2); c.bezierCurveTo(-105, -66, -40, -69, -28, -20); c.lineTo(-17, -7); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(31, -1); c.bezierCurveTo(39, -17, 48, -52, 42, -78); c.lineTo(63, -79); c.bezierCurveTo(57, -40, 84, -31, 97, -7); c.closePath(); c.fill();
  line(c, [[50, -73], [40, -111], [18, -114]], palette.ink, 7);
  round(c, 22, -117, 42, 12, 5, accent); round(c, 57, -117, 9, 12, 3, palette.gold);
  line(c, [[39, -116], [31, -138]], palette.ink, 3); ellipse(c, 28, -141, 11, 6, palette.sky);
  round(c, -87, -64, 64, 12, 6, palette.ink);
  line(c, [[-93, -69], [-43, -69]], '#869c98', 5);
  round(c, -99, -32, 9, 15, 3, palette.coral);
  line(c, [[-76, -42], [-49, -42]], '#8ac4b6', 3);
  c.restore();
}
function van(c, x, y, spin, accent) {
  c.save(); c.translate(x, y); shadow(c, 0, 29, 140);
  round(c, -135, -110, 174, 118, 13, accent);
  shape(c, [[35, -89], [87, -89], [124, -45], [124, 7], [35, 7]], accent);
  shape(c, [[48, -79], [80, -79], [106, -47], [48, -47]], palette.sky);
  round(c, -130, -14, 255, 16, 4, '#d1e5e9');
  wheel(c, -81, 7, 25, spin); wheel(c, 80, 7, 25, spin);
  round(c, 114, -30, 12, 10, 3, palette.gold); round(c, 48, -33, 17, 5, 2, palette.ink);
  line(c, [[35, -82], [35, -22]], '#9bc5d7', 2);
  parcel(c, -48, -62, .48, 0, '#367ca5'); c.restore();
}
function bicycle(c, x, y, spin, accent) {
  c.save(); c.translate(x, y); shadow(c, 0, 40, 125);
  wheel(c, -76, 0, 37, spin); wheel(c, 83, 0, 37, spin);
  line(c, [[-76, 0], [-36, -58], [-4, 0], [-76, 0], [45, -61], [-4, 0]], accent, 7);
  line(c, [[83, 0], [45, -85], [24, -87]], palette.ink, 5);
  line(c, [[-36, -58], [-42, -80]], palette.ink, 5);
  round(c, -64, -85, 43, 8, 4, palette.ink);
  line(c, [[-103, -51], [-62, -51]], '#819d96', 5);
  line(c, [[-4, 0], [9, 10], [21, 10]], palette.ink, 3); c.restore();
}
function confetti(c, p, accent) {
  for (let i = 0; i < 26; i++) {
    const angle = i * 2.39996, spread = 55 + (i % 5) * 22;
    const x = 320 + Math.cos(angle) * spread * p, y = 156 + Math.sin(angle) * spread * p + 40 * p * p;
    c.save(); c.globalAlpha = clamp((1 - p) * 4); c.translate(x, y); c.rotate(angle + p * 5);
    round(c, -3, -5, 6, 10, 1, [accent, palette.coral, palette.gold, palette.blue][i % 4]); c.restore();
  }
}
function home(c, x, y, accent) {
  round(c, x - 48, y - 143, 105, 143, 2, palette.sky);
  shape(c, [[x - 65, y - 141], [x + 4, y - 204], [x + 74, y - 141]], accent);
  round(c, x - 22, y - 93, 48, 93, 4, '#ffffff');
  round(c, x - 12, y - 80, 28, 38, 3, palette.mint);
  ellipse(c, x + 14, y - 33, 3, 3, palette.gold);
  round(c, x - 30, y - 2, 66, 8, 2, '#acc3cf');
}

export function drawOrderScene(canvas, { style = 'scooter', progress = .55, accent = palette.teal, image } = {}) {
  const c = canvas.getContext('2d'); if (!c) return;
  const width = canvas.clientWidth || 640, height = width * 360 / 640;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  }
  c.setTransform(canvas.width / 640, 0, 0, canvas.height / 360, 0, 0);
  c.clearRect(0, 0, 640, 360);
  const t = clamp(progress), ending = phase(t, .82, .98);
  if (style === 'none') { check(c, 320, 173, 48, 1, accent); return; }
  c.save(); c.globalAlpha = 1 - ending;
  const moving = phase(t, .53, .83), spin = moving * 15;
  line(c, [[64, 293], [576, 293]], '#dbe5e1', 2);
  if (['scooter', 'van', 'bicycle'].includes(style)) {
    const enter = phase(t, .22, .44), load = phase(t, .37, .52);
    const x = mix(790, 333, enter) + moving * 520;
    c.save(); c.globalAlpha *= enter;
    if (style === 'scooter') scooter(c, x, 258, spin, accent);
    if (style === 'van') van(c, x, 258, spin, accent);
    if (style === 'bicycle') bicycle(c, x, 249, spin, accent);
    c.restore();
    const boxX = mix(320, x - (style === 'van' ? 55 : 78), load);
    const boxY = mix(210, style === 'van' ? 120 : 158, load) - Math.sin(load * Math.PI) * 40;
    if (style !== 'van' || load < .99) parcel(c, boxX, boxY, mix(1.25, .66, load), 1 - phase(t, .14, .26), accent);
    if (t < .21) product(c, 320, mix(117, 216, phase(t, 0, .19)), 69 * (1 - phase(t, .15, .21)), image);
    if (moving > 0) for (let i = 0; i < 3; i++) line(c, [[x - 185 - i * 17, 201 + i * 16], [x - 151 - i * 17, 201 + i * 16]], '#bbd5cb', 3);
  } else if (style === 'conveyor') {
    round(c, 125, 257, 390, 23, 11, '#bed4de');
    for (let i = 0; i < 12; i++) wheel(c, 144 + i * 32, 267, 8, spin);
    line(c, [[158, 279], [158, 292]], palette.ink, 6); line(c, [[479, 279], [479, 292]], palette.ink, 6);
    const x = mix(189, 324, phase(t, 0, .2)) + moving * 280;
    parcel(c, x, 207, 1, 1 - phase(t, .28, .4), accent);
    if (t < .36) product(c, x, mix(110, 204, phase(t, .1, .34)), 70 * (1 - phase(t, .3, .36)), image);
    round(c, 296, 89, 66, 17, 5, palette.ink);
    round(c, 322, 43, 13, 48 + Math.sin(phase(t, .24, .41) * Math.PI) * 52, 3, '#bbd3dd');
  } else if (style === 'gift' || style === 'celebration') {
    const ribbon = phase(t, .32, .55);
    shadow(c, 320, 287, 91);
    parcel(c, 319, 207 - Math.sin(ribbon * Math.PI) * 8, 1.5, 1 - phase(t, .16, .31), accent, ribbon > .45);
    if (t < .24) product(c, 320, mix(130, 215, phase(t, 0, .23)), 80 * (1 - phase(t, .18, .24)), image);
    if (style === 'celebration' && t > .4) confetti(c, phase(t, .4, .92), accent);
    if (style === 'gift' && ribbon > .5) {
      c.save(); c.globalAlpha = ribbon; round(c, 370, 210, 36, 24, 3, palette.pink); line(c, [[370, 210], [354, 195]], accent, 2); c.restore();
    }
  } else if (style === 'bag') {
    shadow(c, 320, 291, 86);
    c.strokeStyle = accent; c.lineWidth = 7; c.beginPath(); c.arc(320, 158, 31, Math.PI, 0); c.stroke();
    product(c, 320, mix(119, 244, phase(t, 0, .37)), 78, image);
    shape(c, [[247, 176], [386, 176], [402, 275], [245, 282]], '#ecd9cf');
    shape(c, [[386, 176], [402, 275], [371, 264], [370, 173]], '#d4b6a6');
    c.beginPath(); c.arc(308, 186, 27, 0, Math.PI); c.stroke();
    check(c, 308, 240, 18 * phase(t, .38, .6), 1, accent);
  } else if (style === 'express') {
    const fly = phase(t, .36, .84), x = 300 + fly * 410, y = 211 - fly * 146;
    shadow(c, 320 + fly * 220, 292, 87, 1 - fly);
    c.save(); c.translate(x, y); c.rotate(-fly * .3);
    if (fly > 0) {
      line(c, [[-70, 15], [-150 * fly - 70, 15]], palette.coral, 8);
      line(c, [[-61, 35], [-104 * fly - 61, 35]], palette.gold, 5);
    }
    parcel(c, 0, 0, 1.4, 1 - phase(t, .14, .27), accent); c.restore();
    if (t < .23) product(c, 300, mix(120, 212, phase(t, 0, .21)), 70 * (1 - phase(t, .17, .23)), image);
  } else if (style === 'doorstep') {
    home(c, 430, 284, accent);
    const arrival = phase(t, .3, .77), x = mix(200, 351, arrival);
    shadow(c, x, 283, 51); parcel(c, x, 233 - Math.sin(arrival * Math.PI) * 32, .86, 1 - phase(t, .1, .25), palette.teal);
    if (t < .22) product(c, 200, mix(130, 230, phase(t, 0, .21)), 63 * (1 - phase(t, .16, .22)), image);
    round(c, 502, 263, 26, 23, 3, palette.coral);
    line(c, [[515, 262], [515, 220]], palette.teal, 4);
    ellipse(c, 506, 227, 13, 7, '#a5c7ae'); ellipse(c, 524, 242, 13, 7, '#6da58b');
  } else if (style === 'receipt') {
    const reveal = phase(t, .03, .55);
    shadow(c, 320, 293, 88);
    round(c, 225, 91, 190, 192, 10, '#deeee7');
    round(c, 239, 105, 162, 9, 4, palette.ink);
    c.save(); c.beginPath(); c.rect(245, 110, 151, 176); c.clip();
    const y = mix(-54, 118, reveal);
    round(c, 250, y, 140, 158, 1, '#ffffff');
    check(c, 320, y + 34, 18, phase(t, .4, .62), accent);
    line(c, [[273, y + 78], [366, y + 78]], '#c6d9cf', 4);
    line(c, [[273, y + 96], [338, y + 96]], '#c6d9cf', 4);
    line(c, [[273, y + 122], [366, y + 122]], accent, 5);
    for (let i = 0; i < 10; i++) shape(c, [[250 + i * 14, y + 158], [257 + i * 14, y + 151], [264 + i * 14, y + 158]], '#deeee7');
    c.restore();
  }
  c.restore();
  if (ending > 0) {
    c.save(); c.globalAlpha = ending;
    const bounce = 1 + Math.sin(ending * Math.PI) * .12;
    ellipse(c, 320, 177, 71 * ending, 71 * ending, '#edf5f0');
    check(c, 320, 177, 51 * bounce * ending, phase(t, .86, .98), accent);
    c.restore();
  }
}

export function animateOrderScene(canvas, options, onProgress = () => {}) {
  let frame, stopped = false, start;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const stop = () => { stopped = true; cancelAnimationFrame(frame); reduced.removeEventListener('change', reduce); };
  const finish = () => { drawOrderScene(canvas, { ...options, progress: 1 }); onProgress(1); stop(); };
  const reduce = () => { if (reduced.matches) finish(); };
  function tick(now) {
    if (stopped) return;
    if (!canvas.isConnected || canvas.closest('[hidden]')) { stop(); return; }
    start ??= now;
    const progress = Math.min(1, (now - start) / options.durationMs);
    try { drawOrderScene(canvas, { ...options, progress }); onProgress(progress); }
    catch { finish(); return; }
    if (progress < 1) frame = requestAnimationFrame(tick); else stop();
  }
  reduced.addEventListener('change', reduce);
  if (reduced.matches) finish(); else frame = requestAnimationFrame(tick);
  return stop;
}
