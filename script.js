'use strict';

const CONFIG = {
    cols: 130, rows: 65, charCellW: 12, charCellH: 12,
    diskParticles: 80000, photonParticles: 25000, horizonParticles: 20000,
    shadowRingParticles: 15000, starCount: 3000, planetCount: 5, asteroidCount: 12,
    rotationSpeedX: 0.00035, rotationSpeedY: 0.00025, timeSpeed: 0.01,
    starChar: '\u30FB',
    chars: '\u3000\u3001\u3002\u30FB\u309D\u309E\u3083\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u3042\u3044\u3046\u3048\u304A\u304B\u304D\u304F\u3051\u3053\u3055\u3057\u3059\u305B\u305D\u305F\u3061\u3064\u3066\u3068\u306A\u306B\u306C\u306D\u306E\u306F\u3072\u3075\u3078\u307B\u307E\u307F\u3080\u3081\u3082\u3084\u3086\u3088\u3089\u308A\u308B\u308C\u308D\u308F\u3092\u3093\u304C\u3056\u3060\u3070\u3071',
    hueDiskInner: 220, hueDiskOuter: 35, dopplerShift: 50,
    minZoom: 0.4, maxZoom: 2.5, keyboardRotSpeed: 0.02,
    autoHideOverlayDelay: 4000
};

const state = {
    time: 0, zoom: 1, targetZoom: 1,
    rotX: 0, rotY: 0, targetRotX: 0, targetRotY: 0,
    paused: false, focusing: false, focusTimer: 0,
    isDragging: false, lastMX: 0, lastMY: 0,
    frames: 0, lastFpsTime: 0, fps: 0, keys: {}
};

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const fpsEl = document.getElementById('fps');
const statusEl = document.getElementById('status');
const overlay = document.getElementById('overlay');
const tooltip = document.getElementById('tooltip');
let overlayTimer = null;
let W, H;

const planetProj = [];

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = CONFIG.cols * CONFIG.charCellW, ch = CONFIG.rows * CONFIG.charCellH;
    canvas.width = cw * dpr; canvas.height = ch * dpr;
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.textBaseline = 'top';
    W = CONFIG.cols; H = CONFIG.rows;
}
window.addEventListener('resize', resize); resize();

function showOverlay() {
    overlay.classList.remove('hidden');
    if (overlayTimer) clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => overlay.classList.add('hidden'), CONFIG.autoHideOverlayDelay);
}
showOverlay();
canvas.addEventListener('click', showOverlay);
canvas.addEventListener('touchstart', showOverlay, { passive: true });

function updateStatus() {
    const parts = [];
    if (state.paused) parts.push('PAUSED');
    if (state.focusing) parts.push('FOCUS');
    if (state.zoom !== 1) parts.push((state.zoom * 100).toFixed(0) + '%');
    statusEl.textContent = parts.join(' \u00B7 ');
}

function rotateX(p, a) {
    const s = Math.sin(a), c = Math.cos(a);
    return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
}
function rotateY(p, a) {
    const s = Math.sin(a), c = Math.cos(a);
    return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}
function project(p) {
    const z = p.z + 9, s = state.zoom;
    return { x: Math.floor(W / 2 + p.x / z * 95 * s), y: Math.floor(H / 2 + p.y / z * 50 * s), z };
}

function plot(buf, zb, x, y, z, b, hue) {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const idx = x + y * W;
    if (z < zb[idx]) {
        zb[idx] = z;
        const br = Math.pow(Math.max(0, b), 0.65);
        const ci = Math.min(CONFIG.chars.length - 1, Math.floor(br * (CONFIG.chars.length - 1)));
        buf[idx] = { ch: CONFIG.chars[ci], b: br, h: hue };
    }
}

function plotDisk(buf, zb, cx, cy, z, radius, getCell) {
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy++) {
        const yy = cy + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
            const xx = cx + dx; if (xx < 0 || xx >= W) continue;
            const dist = Math.sqrt(dx * dx + dy * dy); if (dist > radius) continue;
            const idx = xx + yy * W;
            if (z < zb[idx]) {
                const cell = getCell(dist / radius, dy);
                if (!cell || cell.b <= 0) continue;
                zb[idx] = z;
                const br = Math.pow(cell.b, 0.65);
                const ci = Math.min(CONFIG.chars.length - 1, Math.floor(br * (CONFIG.chars.length - 1)));
                buf[idx] = { ch: CONFIG.chars[ci], b: br, h: cell.h };
            }
        }
    }
}

function colorStr(b, h) {
    if (b <= 0) return '#000';
    const l = Math.min(98, Math.floor(b * 80 + 10));
    if (h == null) { const g = Math.floor(b * 250 + 5); return 'rgb(' + g + ',' + g + ',' + g + ')'; }
    return 'hsl(' + h + ',70%,' + l + '%)';
}

function genDisk() {
    const a = [];
    for (let i = 0; i < CONFIG.diskParticles; i++) a.push({ ang: Math.random() * 2 * Math.PI, baseRadius: 1.2 + Math.random() * 3, ry: Math.random() });
    return a;
}
function genPhotons() {
    const a = [];
    for (let i = 0; i < CONFIG.photonParticles; i++) a.push({ ang: Math.random() * 2 * Math.PI, ry: Math.random() });
    return a;
}
function genHorizon() {
    const a = [];
    for (let i = 0; i < CONFIG.horizonParticles; i++) a.push({ u: Math.random(), v: Math.random() });
    return a;
}
function genShadow() {
    const a = [];
    for (let i = 0; i < CONFIG.shadowRingParticles; i++) a.push({ ang: Math.random() * 2 * Math.PI, ry: Math.random(), r: 2 + Math.random() * 0.5 });
    return a;
}
function genStars() {
    const a = [];
    for (let i = 0; i < CONFIG.starCount; i++) {
        const theta = Math.random() * 2 * Math.PI, phi = Math.acos(2 * Math.random() - 1), r = 80 + Math.random() * 200;
        a.push({ x: r * Math.sin(phi) * Math.cos(theta), y: r * Math.sin(phi) * Math.sin(theta), z: r * Math.cos(phi), bright: 0.1 + Math.random() * 0.5, hue: Math.random() * 60 + 20 });
    }
    return a;
}
function genPlanets() {
    const colors = [20, 40, 200, 280, 340], radii = [8, 12, 18, 22, 28], speeds = [0.03, 0.02, 0.012, 0.008, 0.005], sizes = [1, 0.7, 0.6, 0.9, 1.1];
    const data = [];
    for (let i = 0; i < CONFIG.planetCount; i++) {
        const p = { ang: Math.random() * 2 * Math.PI, orbitRadius: radii[i], speed: speeds[i], size: sizes[i], hue: colors[i], incline: (Math.random() - 0.5) * 0.3, tilt: Math.random() * 2 * Math.PI, hasRing: i === 2 };
        if (p.hasRing) {
            const rp = [];
            const bands = [{ inner: 0.6, outer: 0.75, n: 10, b: 0.15 }, { inner: 0.8, outer: 1.1, n: 16, b: 0.25 }, { inner: 1.25, outer: 1.4, n: 12, b: 0.15 }];
            for (const band of bands) {
                for (let j = 0; j < band.n; j++) {
                    const ra = Math.random() * 2 * Math.PI, rr = band.inner + Math.random() * (band.outer - band.inner);
                    rp.push({ ox: rr * Math.cos(ra), oy: rr * 0.2 * Math.sin(ra), oz: rr * Math.cos(ra), b: band.b * (0.7 + Math.random() * 0.3), h: p.hue + (Math.random() - 0.5) * 20 });
                }
            }
            p.ringPts = rp;
        }
        data.push(p);
    }
    return data;
}
function genAsteroids() {
    const data = [];
    for (let i = 0; i < CONFIG.asteroidCount; i++) {
        const theta = Math.random() * 2 * Math.PI, phi = Math.acos(2 * Math.random() - 1), dist = 20 + Math.random() * 50, size = 0.6 + Math.random() * 1.4;
        const shape = [];
        for (let j = 0; j < 8 + Math.floor(Math.random() * 10); j++) {
            const a = Math.random() * 2 * Math.PI, r = 0.2 + Math.random() * 0.8;
            shape.push({ ox: Math.cos(a) * r + (Math.random() - 0.5) * 0.25, oy: Math.sin(a) * r + (Math.random() - 0.5) * 0.25, oz: (Math.random() - 0.5) * 0.4, b: 0.3 + Math.random() * 0.7 });
        }
        data.push({ x: dist * Math.sin(phi) * Math.cos(theta), y: dist * Math.sin(phi) * Math.sin(theta), z: dist * Math.cos(phi), rot: Math.random() * 2 * Math.PI, tumbleX: (Math.random() - 0.5) * 0.015, tumbleY: (Math.random() - 0.5) * 0.015, size, hue: 25 + Math.random() * 30, brightBase: 0.4 + Math.random() * 0.4, shape });
    }
    return data;
}

const diskData = genDisk();
const photonData = genPhotons();
const horizonData = genHorizon();
const shadowData = genShadow();
const starData = genStars();
const planetData = genPlanets();
const asteroidData = genAsteroids();

function render() {
    const buf = new Array(W * H);
    const zb = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) { buf[i] = { ch: '\u3000', b: 0, h: 0 }; zb[i] = 99999; }

    const ax = state.rotX, ay = state.rotY, t = state.time;

    for (let i = 0; i < horizonData.length; i++) {
        const h = horizonData[i];
        const theta = 2 * Math.PI * h.u, phi = Math.acos(2 * h.v - 1);
        let p = { x: 0.9 * Math.sin(phi) * Math.cos(theta), y: 0.9 * Math.sin(phi) * Math.sin(theta), z: 0.9 * Math.cos(phi) };
        p = rotateX(p, ax); p = rotateY(p, ay);
        const pr = project(p);
        if (pr.x >= 0 && pr.x < W && pr.y >= 0 && pr.y < H) {
            const idx = pr.x + pr.y * W;
            if (pr.z < zb[idx]) { zb[idx] = pr.z; buf[idx] = { ch: '\u3000', b: -1, h: 0 }; }
        }
    }

    for (let i = 0; i < photonData.length; i++) {
        const d = photonData[i];
        let p = { x: 0.95 * Math.cos(d.ang), y: (d.ry - 0.5) * 0.05, z: 0.95 * Math.sin(d.ang) };
        p = rotateX(p, ax); p = rotateY(p, ay);
        const pr = project(p);
        plot(buf, zb, pr.x, pr.y, pr.z, 1.2 + 0.2 * Math.sin(d.ang * 25 + t * 5), 190);
    }

    for (let i = 0; i < diskData.length; i++) {
        const d = diskData[i];
        const ang = d.ang, ripple = Math.sin(ang * 12 + t * 2) * 0.12, thickness = 0.35 + Math.sin(ang * 6 + t) * 0.15, radius = d.baseRadius + ripple;
        let p = { x: radius * Math.cos(ang), y: (d.ry - 0.5) * thickness, z: radius * Math.sin(ang) };
        const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
        const sR1 = 0.9, sR2 = 2.2;
        let sf = 1;
        if (dist < sR2) { const s = Math.max(0, (dist - sR1) / (sR2 - sR1)); sf = s * s * (3 - 2 * s); }
        const lens = 1 / (dist * dist + 0.08);
        p.x += p.x * lens * 0.8; p.y += p.y * lens * 0.8; p.z += p.z * lens * 0.4;
        p = rotateX(p, ax); p = rotateY(p, ay);
        const pr = project(p);
        let bright = 1 - (d.baseRadius - 1.2) / 3.2;
        bright *= 0.75 + 0.25 * Math.sin(ang * 20 + t * 4);
        bright *= 1 + 0.6 * Math.cos(ang - ay);
        bright *= 1 / (pr.z * 0.09);
        bright *= sf;
        const radiusNorm = (d.baseRadius - 1.2) / 3;
        let hue = CONFIG.hueDiskInner + (CONFIG.hueDiskOuter - CONFIG.hueDiskInner) * radiusNorm;
        hue += Math.cos(ang - ay) * CONFIG.dopplerShift;
        plot(buf, zb, pr.x, pr.y, pr.z, bright, hue);
    }

    for (let i = 0; i < shadowData.length; i++) {
        const d = shadowData[i];
        let p = { x: d.r * Math.cos(d.ang), y: (d.ry - 0.5) * 0.4, z: d.r * Math.sin(d.ang) };
        p = rotateX(p, ax); p = rotateY(p, ay);
        const pr = project(p);
        plot(buf, zb, pr.x, pr.y, pr.z, 0.25 + 0.1 * Math.sin(d.ang * 10 + t), 170);
    }

    planetProj.length = 0;
    for (let i = 0; i < planetData.length; i++) {
        const pl = planetData[i];
        const a = pl.ang + t * pl.speed, r = pl.orbitRadius;
        let p = { x: r * Math.cos(a), y: Math.sin(a * 2 + pl.tilt) * pl.incline * 2, z: r * Math.sin(a) };
        const ux = p.x, uy = p.y, uz = p.z;
        p = rotateX(p, ax); p = rotateY(p, ay);
        const pr = project(p);
        const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
        const bright = 2.5 / (dist * 0.05 + 1);
        planetProj.push({ x: pr.x, y: pr.y, hue: pl.hue, orbit: pl.orbitRadius, size: pl.size, hasRing: pl.hasRing, ox: ux, oy: uy, oz: uz });
        if (pr.z < 2 || pr.z > 99990) continue;
        const ps = Math.max(0.5, pl.size * 5 / (dist * 0.08 + 1));
        plotDisk(buf, zb, pr.x, pr.y, pr.z, ps, n => { const b = (1 - n * 0.5) * bright; return b > 0.01 ? { b, h: pl.hue } : null; });
        if (pl.hasRing && pl.ringPts) {
            const ringScale = pl.size * 8;
            const rs = Math.sin(t * 0.015), rc = Math.cos(t * 0.015);
            for (let j = 0; j < pl.ringPts.length; j++) {
                const rp = pl.ringPts[j];
                const ox = rp.ox * rc - rp.oz * rs, oz = rp.ox * rs + rp.oz * rc;
                const rr = { x: p.x + ringScale * ox, y: p.y + ringScale * rp.oy, z: p.z + ringScale * oz };
                const rpr = project(rr);
                if (rpr.z < 2 || rpr.z > 99990) continue;
                const rd = Math.sqrt(rr.x * rr.x + rr.y * rr.y + rr.z * rr.z);
                plot(buf, zb, rpr.x, rpr.y, rpr.z, rp.b * (1 / (rd * 0.05 + 1)), rp.h);
            }
        }
    }

    for (let i = 0; i < asteroidData.length; i++) {
        const ast = asteroidData[i];
        ast.rot += ast.tumbleX;
        const rot = ast.rot, s = Math.sin(rot), c = Math.cos(rot);
        for (let j = 0; j < ast.shape.length; j++) {
            const cell = ast.shape[j];
            const ox = cell.ox * c - cell.oy * s, oy = cell.ox * s + cell.oy * c;
            let ap = { x: ast.x + ox * ast.size, y: ast.y + oy * ast.size + cell.oz * ast.size, z: ast.z + cell.oz * ast.size };
            ap = rotateX(ap, ax); ap = rotateY(ap, ay);
            const apr = project(ap);
            if (apr.z < 2 || apr.z > 99990) continue;
            const dist = Math.sqrt(ap.x * ap.x + ap.y * ap.y + ap.z * ap.z);
            const b = ast.brightBase * cell.b * (3 / (dist * 0.04 + 1));
            plot(buf, zb, apr.x, apr.y, apr.z, b, ast.hue + ((i * 7 + j * 13) % 11) - 5);
        }
    }

    ctx.clearRect(0, 0, W * CONFIG.charCellW, H * CONFIG.charCellH);
    ctx.font = CONFIG.charCellW + "px 'MS Gothic','Yu Gothic','Noto Sans Mono CJK JP',Consolas,monospace";

    const starAngle = t * 0.003, starCos = Math.cos(starAngle), starSin = Math.sin(starAngle);
    for (let i = 0; i < starData.length; i++) {
        const s = starData[i];
        let p = { x: s.x * starCos - s.z * starSin, y: s.y, z: s.x * starSin + s.z * starCos };
        p = rotateX(p, ax); p = rotateY(p, ay);
        if (p.z <= 0) continue;
        const sx = Math.floor(W / 2 + p.x / (p.z + 9) * 95 * state.zoom);
        const sy = Math.floor(H / 2 + p.y / (p.z + 9) * 50 * state.zoom);
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
        const bright = s.bright / ((p.z + 9) * 0.025);
        if (bright > 0.01) {
            ctx.fillStyle = colorStr(bright, s.hue);
            ctx.fillText(CONFIG.starChar, sx * CONFIG.charCellW, sy * CONFIG.charCellH);
        }
    }

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const c = buf[x + y * W];
            if (c.b <= 0.01) continue;
            if (c.b < 0) { ctx.fillStyle = '#000'; ctx.fillRect(x * CONFIG.charCellW, y * CONFIG.charCellH, CONFIG.charCellW, CONFIG.charCellH); }
            else { ctx.fillStyle = colorStr(c.b, c.h); ctx.fillText(c.ch, x * CONFIG.charCellW, y * CONFIG.charCellH); }
        }
    }
}

function frame(time) {
    state.frames++;
    if (time - state.lastFpsTime >= 1000) {
        state.fps = state.frames; state.frames = 0; state.lastFpsTime = time;
        fpsEl.textContent = state.fps + ' FPS';
    }
    let kx = 0, ky = 0;
    if (state.keys['w'] || state.keys['ArrowUp']) kx = CONFIG.keyboardRotSpeed;
    if (state.keys['s'] || state.keys['ArrowDown']) kx = -CONFIG.keyboardRotSpeed;
    if (state.keys['a'] || state.keys['ArrowLeft']) ky = CONFIG.keyboardRotSpeed;
    if (state.keys['d'] || state.keys['ArrowRight']) ky = -CONFIG.keyboardRotSpeed;
    if (kx || ky) { state.targetRotX += kx; state.targetRotY += ky; }
    state.rotX += (state.targetRotX - state.rotX) * 0.08;
    state.rotY += (state.targetRotY - state.rotY) * 0.08;
    if (state.focusing) { state.focusTimer--; if (state.focusTimer <= 0) state.focusing = false; }
    if (!state.isDragging && !kx && !ky && !state.paused && !state.focusing) { state.targetRotX += CONFIG.rotationSpeedX; state.targetRotY += CONFIG.rotationSpeedY; }
    state.zoom += (state.targetZoom - state.zoom) * 0.1;
    render();
    if (!state.paused) state.time += CONFIG.timeSpeed;
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let lastMD = 0;

canvas.addEventListener('mousedown', e => { state.isDragging = true; state.lastMX = e.clientX; state.lastMY = e.clientY; });
window.addEventListener('mousemove', e => {
    if (!state.isDragging) return;
    const dx = e.clientX - state.lastMX, dy = e.clientY - state.lastMY;
    state.targetRotY -= dx * 0.005; state.targetRotX += dy * 0.005;
    state.lastMX = e.clientX; state.lastMY = e.clientY;
});
window.addEventListener('mouseup', () => { state.isDragging = false; });

canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / CONFIG.charCellW, my = (e.clientY - rect.top) / CONFIG.charCellH;
    let found = null;
    for (let i = 0; i < planetProj.length; i++) {
        const pp = planetProj[i], dx = mx - pp.x, dy = my - pp.y;
        if (dx * dx + dy * dy < 9) { found = pp; break; }
    }
    if (found) {
        const names = { 20: 'orange', 40: 'yellow', 200: 'cyan', 280: 'purple', 340: 'pink' };
        const name = names[found.hue] || ('hue ' + found.hue);
        const ring = found.hasRing ? ' \u00B7 ringed' : '';
        tooltip.textContent = name + ' planet \u00B7 r=' + found.orbit + ring;
        tooltip.style.display = 'block'; tooltip.style.left = (e.clientX + 12) + 'px'; tooltip.style.top = (e.clientY - 8) + 'px';
    } else { tooltip.style.display = 'none'; }
});

canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / CONFIG.charCellW, my = (e.clientY - rect.top) / CONFIG.charCellH;
    for (let i = 0; i < planetProj.length; i++) {
        const pp = planetProj[i], dx = mx - pp.x, dy = my - pp.y;
        if (dx * dx + dy * dy < 9) {
            const px = pp.ox, py = pp.oy, pz = pp.oz;
            state.targetRotX = Math.atan2(py, pz);
            state.targetRotY = Math.atan2(-px, Math.sqrt(py * py + pz * pz));
            state.focusing = true; state.focusTimer = 300; state.targetZoom = 2.5;
            showOverlay(); break;
        }
    }
});

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    state.targetZoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, state.targetZoom + delta));
    updateStatus(); showOverlay();
}, { passive: false });

window.addEventListener('keydown', e => {
    state.keys[e.key] = true;
    if (e.key === ' ' || e.key === 'Space') { e.preventDefault(); state.paused = !state.paused; updateStatus(); showOverlay(); }
    if (e.key === '=' || e.key === '+') { state.targetZoom = Math.min(CONFIG.maxZoom, state.targetZoom + 0.1); updateStatus(); showOverlay(); }
    if (e.key === '-') { state.targetZoom = Math.max(CONFIG.minZoom, state.targetZoom - 0.1); updateStatus(); showOverlay(); }
    if (e.key === '0') { state.targetZoom = 1; updateStatus(); showOverlay(); }
});
window.addEventListener('keyup', e => { state.keys[e.key] = false; });

canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { state.isDragging = true; state.lastMX = e.touches[0].clientX; state.lastMY = e.touches[0].clientY; }
    else if (e.touches.length === 2) { const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY; lastMD = Math.sqrt(dx * dx + dy * dy); }
}, { passive: true });
canvas.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && state.isDragging) {
        e.preventDefault();
        const dx = e.touches[0].clientX - state.lastMX, dy = e.touches[0].clientY - state.lastMY;
        state.targetRotY -= dx * 0.005; state.targetRotX += dy * 0.005;
        state.lastMX = e.touches[0].clientX; state.lastMY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        state.targetZoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, state.targetZoom + (dist - lastMD) * 0.005));
        lastMD = dist; updateStatus();
    }
}, { passive: false });
canvas.addEventListener('touchend', () => { state.isDragging = false; }, { passive: true });
