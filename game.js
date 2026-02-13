const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const BASE_WIDTH = 960;
const BASE_HEIGHT = 540;
const FIXED_DT = 1 / 60;
const TRACK_HALF_WIDTH = 56;
const LAP_TARGET = 3;
const MAX_FORWARD_SPEED = 450;
const MAX_REVERSE_SPEED = -120;

const keysDown = new Set();

const centerline = [
  { x: 184, y: 156 },
  { x: 334, y: 98 },
  { x: 520, y: 108 },
  { x: 740, y: 178 },
  { x: 818, y: 302 },
  { x: 702, y: 430 },
  { x: 482, y: 474 },
  { x: 260, y: 424 },
  { x: 134, y: 300 },
];

function makeTrack(points) {
  const segments = [];
  let totalLength = 0;
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    segments.push({
      p0,
      p1,
      dx,
      dy,
      len,
      nx: len > 0 ? -dy / len : 0,
      ny: len > 0 ? dx / len : 0,
      tx: len > 0 ? dx / len : 1,
      ty: len > 0 ? dy / len : 0,
      startS: totalLength,
      endS: totalLength + len,
    });
    totalLength += len;
  }
  return { points, segments, totalLength };
}

const track = makeTrack(centerline);
const startS = 18;
const startPose = poseAtS(startS);

const terrainPolys = [
  {
    color: "#adc6d6",
    pts: [
      [0, 300],
      [132, 220],
      [250, 330],
      [0, 390],
    ],
  },
  {
    color: "#8fb0c3",
    pts: [
      [248, 300],
      [398, 194],
      [572, 316],
      [418, 372],
    ],
  },
  {
    color: "#7a9eb3",
    pts: [
      [510, 276],
      [722, 178],
      [888, 320],
      [712, 380],
    ],
  },
  {
    color: "#97b7ca",
    pts: [
      [676, 366],
      [886, 282],
      [960, 430],
      [796, 520],
    ],
  },
  {
    color: "#aac2d1",
    pts: [
      [128, 408],
      [312, 342],
      [436, 462],
      [238, 540],
      [22, 504],
    ],
  },
];

const state = {
  mode: "menu",
  raceClock: 0,
  lapStartClock: 0,
  bestLap: null,
  lastLap: null,
  lapsCompleted: 0,
  nextLapAt: 0,
  offTrack: false,
  car: {
    x: startPose.x,
    y: startPose.y,
    angle: startPose.angle,
    speed: 0,
    trackS: startS,
    totalProgress: startS,
    segmentIndex: startPose.segmentIndex,
  },
};

let accumulator = 0;
let lastTimestamp = performance.now();

resizeCanvas();
resetRace("menu");
requestAnimationFrame(frame);

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", onKeyDown, { passive: false });
window.addEventListener("keyup", onKeyUp);

document.addEventListener("fullscreenchange", () => {
  resizeCanvas();
});

function onKeyDown(event) {
  keysDown.add(event.code);

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
    event.preventDefault();
  }

  if (event.repeat) {
    return;
  }

  if (event.code === "KeyF") {
    toggleFullscreen();
    return;
  }

  if (state.mode === "menu" && (event.code === "Enter" || event.code === "Space")) {
    resetRace("racing");
    return;
  }

  if (state.mode === "finished" && (event.code === "Enter" || event.code === "Space")) {
    resetRace("racing");
    return;
  }

  if (state.mode === "racing" && (event.code === "Space" || event.code === "KeyR")) {
    resetRace("racing");
  }
}

function onKeyUp(event) {
  keysDown.delete(event.code);
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }
  if (canvas.requestFullscreen) {
    canvas.requestFullscreen();
  }
}

function isDown(...codes) {
  for (const code of codes) {
    if (keysDown.has(code)) {
      return true;
    }
  }
  return false;
}

function resizeCanvas() {
  const margin = 24;
  const maxW = Math.max(320, window.innerWidth - margin);
  const maxH = Math.max(240, window.innerHeight - margin);
  const scale = Math.min(maxW / BASE_WIDTH, maxH / BASE_HEIGHT);
  canvas.style.width = `${Math.floor(BASE_WIDTH * scale)}px`;
  canvas.style.height = `${Math.floor(BASE_HEIGHT * scale)}px`;
}

function frame(timestamp) {
  const dt = Math.min(0.1, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;
  accumulator += dt;

  while (accumulator >= FIXED_DT) {
    update(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  render();
  requestAnimationFrame(frame);
}

function update(dt) {
  if (state.mode !== "racing") {
    return;
  }

  const car = state.car;

  let throttle = 0;
  if (isDown("ArrowUp", "KeyW", "Enter")) {
    throttle += 1;
  }
  if (isDown("ArrowDown", "KeyS")) {
    throttle -= 0.8;
  }

  let steer = 0;
  if (isDown("ArrowLeft", "KeyA")) {
    steer -= 1;
  }
  if (isDown("ArrowRight", "KeyD", "KeyB")) {
    steer += 1;
  }

  car.speed += throttle * 310 * dt;
  const rollingDrag = throttle === 0 ? 1.95 : 0.48;
  car.speed *= Math.exp(-rollingDrag * dt);
  car.speed = clamp(car.speed, MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);

  const speedRatio = Math.min(1, Math.abs(car.speed) / 280);
  const steerRate = (2.55 - speedRatio * 1.4) * (car.speed >= 0 ? 1 : -1);
  car.angle += steer * steerRate * dt;

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;

  let nearest = nearestTrackPoint(car.x, car.y, car.segmentIndex, 2);
  const offDistance = nearest.dist - TRACK_HALF_WIDTH;
  state.offTrack = offDistance > 0;

  if (offDistance > 0) {
    car.speed *= Math.exp(-Math.min(2.8, 1.1 + offDistance / 24) * dt);
  }

  if (offDistance > 72) {
    const hardNearest = nearestTrackPoint(car.x, car.y, car.segmentIndex, 4);
    car.x = hardNearest.x;
    car.y = hardNearest.y;
    car.angle = Math.atan2(hardNearest.ty, hardNearest.tx);
    car.speed = Math.min(car.speed, 96);
    nearest = hardNearest;
  }

  const tangentAngle = Math.atan2(nearest.ty, nearest.tx);
  const alignmentError = normalizeAngle(tangentAngle - car.angle);
  const assistStrength = state.offTrack ? 0.4 : 1.4;
  const assistScale = Math.min(1, Math.abs(car.speed) / 220);
  car.angle += clamp(alignmentError, -1, 1) * assistStrength * assistScale * dt;

  let deltaS = nearest.s - car.trackS;
  if (deltaS > track.totalLength / 2) {
    deltaS -= track.totalLength;
  } else if (deltaS < -track.totalLength / 2) {
    deltaS += track.totalLength;
  }

  car.totalProgress += deltaS;
  car.trackS = nearest.s;
  car.segmentIndex = nearest.segmentIndex;

  state.raceClock += dt;
  if (car.totalProgress >= state.nextLapAt && car.speed > 36) {
    completeLap();
  }
}

function completeLap() {
  const lapTime = state.raceClock - state.lapStartClock;
  state.lastLap = lapTime;
  state.bestLap = state.bestLap == null ? lapTime : Math.min(state.bestLap, lapTime);
  state.lapsCompleted += 1;
  state.lapStartClock = state.raceClock;
  state.nextLapAt += track.totalLength;

  if (state.lapsCompleted >= LAP_TARGET) {
    state.mode = "finished";
    state.car.speed = 0;
  }
}

function resetRace(mode = "racing") {
  const pose = poseAtS(startS);
  state.mode = mode;
  state.raceClock = 0;
  state.lapStartClock = 0;
  state.lastLap = null;
  state.lapsCompleted = 0;
  state.nextLapAt = startS + track.totalLength;
  state.offTrack = false;
  state.car.x = pose.x;
  state.car.y = pose.y;
  state.car.angle = pose.angle;
  state.car.speed = 0;
  state.car.trackS = startS;
  state.car.totalProgress = startS;
  state.car.segmentIndex = pose.segmentIndex;
}

function render() {
  ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
  drawBackground();
  drawTerrain();
  drawTrack();
  drawFinishLine();
  drawCar();
  if (state.mode !== "menu") {
    drawHUD();
  }

  if (state.mode === "menu") {
    drawMenuOverlay();
  }

  if (state.mode === "finished") {
    drawFinishOverlay();
  }
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
  sky.addColorStop(0, "#7db8e2");
  sky.addColorStop(0.62, "#d0e2ef");
  sky.addColorStop(0.63, "#90b88f");
  sky.addColorStop(1, "#6b9a68");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
}

function drawTerrain() {
  for (const poly of terrainPolys) {
    ctx.beginPath();
    ctx.moveTo(poly.pts[0][0], poly.pts[0][1]);
    for (let i = 1; i < poly.pts.length; i++) {
      ctx.lineTo(poly.pts[i][0], poly.pts[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = poly.color;
    ctx.fill();
  }
}

function drawTrack() {
  for (let i = 0; i < track.segments.length; i++) {
    const seg = track.segments[i];
    const shade = i % 2 === 0 ? "#2d3238" : "#333940";

    const ax = seg.p0.x + seg.nx * TRACK_HALF_WIDTH;
    const ay = seg.p0.y + seg.ny * TRACK_HALF_WIDTH;
    const bx = seg.p0.x - seg.nx * TRACK_HALF_WIDTH;
    const by = seg.p0.y - seg.ny * TRACK_HALF_WIDTH;
    const cx = seg.p1.x - seg.nx * TRACK_HALF_WIDTH;
    const cy = seg.p1.y - seg.ny * TRACK_HALF_WIDTH;
    const dx = seg.p1.x + seg.nx * TRACK_HALF_WIDTH;
    const dy = seg.p1.y + seg.ny * TRACK_HALF_WIDTH;

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.lineTo(dx, dy);
    ctx.closePath();
    ctx.fillStyle = shade;
    ctx.fill();
  }

  ctx.lineWidth = 4;
  ctx.strokeStyle = "#e7ebef";
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.moveTo(track.points[0].x, track.points[0].y);
  for (let i = 1; i < track.points.length; i++) {
    ctx.lineTo(track.points[i].x, track.points[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#9daab6";
  ctx.beginPath();
  for (const seg of track.segments) {
    ctx.moveTo(seg.p0.x + seg.nx * TRACK_HALF_WIDTH, seg.p0.y + seg.ny * TRACK_HALF_WIDTH);
    ctx.lineTo(seg.p1.x + seg.nx * TRACK_HALF_WIDTH, seg.p1.y + seg.ny * TRACK_HALF_WIDTH);
    ctx.moveTo(seg.p0.x - seg.nx * TRACK_HALF_WIDTH, seg.p0.y - seg.ny * TRACK_HALF_WIDTH);
    ctx.lineTo(seg.p1.x - seg.nx * TRACK_HALF_WIDTH, seg.p1.y - seg.ny * TRACK_HALF_WIDTH);
  }
  ctx.stroke();
}

function drawFinishLine() {
  const pose = poseAtS(startS);
  const nx = -Math.sin(pose.angle);
  const ny = Math.cos(pose.angle);
  const half = TRACK_HALF_WIDTH - 6;
  const startX = pose.x - nx * half;
  const startY = pose.y - ny * half;
  const endX = pose.x + nx * half;
  const endY = pose.y + ny * half;

  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const sx = lerp(startX, endX, t0);
    const sy = lerp(startY, endY, t0);
    const ex = lerp(startX, endX, t1);
    const ey = lerp(startY, endY, t1);
    ctx.strokeStyle = i % 2 === 0 ? "#f5f6f8" : "#1c2025";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
}

function drawCar() {
  const car = state.car;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.beginPath();
  ctx.ellipse(-2, 4, 18, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = state.offTrack ? "#f4b04a" : "#ff5c38";
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-14, -10);
  ctx.lineTo(-10, 0);
  ctx.lineTo(-14, 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(-6, -5);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-6, 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#21262f";
  ctx.fillRect(-11, -11, 8, 3);
  ctx.fillRect(-11, 8, 8, 3);

  ctx.restore();
}

function drawHUD() {
  ctx.fillStyle = "rgba(17, 27, 35, 0.74)";
  ctx.fillRect(14, 14, 220, 94);

  ctx.fillStyle = "#f2f6f8";
  ctx.font = "600 18px Trebuchet MS";
  ctx.fillText(`Lap ${Math.min(state.lapsCompleted + 1, LAP_TARGET)}/${LAP_TARGET}`, 24, 40);

  ctx.font = "600 22px Trebuchet MS";
  ctx.fillText(formatClock(state.raceClock), 24, 68);

  ctx.font = "500 14px Trebuchet MS";
  const speed = Math.max(0, Math.round(state.car.speed));
  ctx.fillText(`Speed ${speed} u/s`, 24, 92);

  ctx.textAlign = "right";
  ctx.fillText(`Best ${state.bestLap == null ? "--" : formatClock(state.bestLap)}`, 224, 92);
  ctx.textAlign = "left";
}

function drawMenuOverlay() {
  ctx.fillStyle = "rgba(12, 20, 30, 0.66)";
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  ctx.fillStyle = "#f0f5f8";
  ctx.font = "700 52px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillText("POLYTRACK LOCAL", BASE_WIDTH / 2, 184);

  ctx.font = "500 22px Trebuchet MS";
  ctx.fillText("Low-poly time trial racing", BASE_WIDTH / 2, 224);

  ctx.font = "500 20px Trebuchet MS";
  ctx.fillText("Enter/Space: start  |  Arrows/WASD: drive  |  R/Space: restart", BASE_WIDTH / 2, 288);
  ctx.fillText("F: fullscreen toggle", BASE_WIDTH / 2, 322);

  ctx.font = "600 24px Trebuchet MS";
  ctx.fillText("Press Enter to race", BASE_WIDTH / 2, 392);

  ctx.textAlign = "left";
}

function drawFinishOverlay() {
  ctx.fillStyle = "rgba(9, 15, 22, 0.62)";
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  ctx.fillStyle = "#f2f8fb";
  ctx.textAlign = "center";
  ctx.font = "700 48px Trebuchet MS";
  ctx.fillText("FINISH", BASE_WIDTH / 2, 210);

  ctx.font = "600 28px Trebuchet MS";
  ctx.fillText(`Total ${formatClock(state.raceClock)}`, BASE_WIDTH / 2, 262);

  ctx.font = "500 22px Trebuchet MS";
  ctx.fillText(`Best lap ${state.bestLap == null ? "--" : formatClock(state.bestLap)}`, BASE_WIDTH / 2, 306);
  ctx.fillText("Press Enter or Space to restart", BASE_WIDTH / 2, 356);

  ctx.textAlign = "left";
}

function nearestTrackPoint(x, y, referenceIndex = null, span = null) {
  let best = null;
  const total = track.segments.length;

  const candidateIndices = [];
  if (typeof referenceIndex === "number" && typeof span === "number") {
    for (let offset = -span; offset <= span; offset++) {
      candidateIndices.push((referenceIndex + offset + total) % total);
    }
  } else {
    for (let i = 0; i < total; i++) {
      candidateIndices.push(i);
    }
  }

  for (const i of candidateIndices) {
    const seg = track.segments[i];
    const segLenSq = seg.len * seg.len;
    let t = 0;

    if (segLenSq > 0) {
      t = ((x - seg.p0.x) * seg.dx + (y - seg.p0.y) * seg.dy) / segLenSq;
      t = clamp(t, 0, 1);
    }

    const px = seg.p0.x + seg.dx * t;
    const py = seg.p0.y + seg.dy * t;
    const dx = x - px;
    const dy = y - py;
    const dist = Math.hypot(dx, dy);

    if (!best || dist < best.dist) {
      best = {
        x: px,
        y: py,
        dist,
        s: seg.startS + seg.len * t,
        tx: seg.tx,
        ty: seg.ty,
        segmentIndex: i,
      };
    }
  }

  return best;
}

function poseAtS(s) {
  const wrapped = wrapS(s);
  for (let i = 0; i < track.segments.length; i++) {
    const seg = track.segments[i];
    if (wrapped >= seg.startS && wrapped <= seg.endS) {
      const t = seg.len > 0 ? (wrapped - seg.startS) / seg.len : 0;
      return {
        x: seg.p0.x + seg.dx * t,
        y: seg.p0.y + seg.dy * t,
        angle: Math.atan2(seg.ty, seg.tx),
        segmentIndex: i,
      };
    }
  }
  const first = track.segments[0];
  return {
    x: first.p0.x,
    y: first.p0.y,
    angle: Math.atan2(first.ty, first.tx),
    segmentIndex: 0,
  };
}

function wrapS(s) {
  let wrapped = s % track.totalLength;
  if (wrapped < 0) {
    wrapped += track.totalLength;
  }
  return wrapped;
}

function formatClock(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalizeAngle(angle) {
  let result = angle;
  while (result > Math.PI) {
    result -= Math.PI * 2;
  }
  while (result < -Math.PI) {
    result += Math.PI * 2;
  }
  return result;
}

window.render_game_to_text = () => {
  const payload = {
    mode: state.mode,
    coordinateSystem: "origin at top-left, +x right, +y down; units are canvas pixels on 960x540",
    track: {
      totalLength: Number(track.totalLength.toFixed(2)),
      halfWidth: TRACK_HALF_WIDTH,
      startLineS: startS,
    },
    car: {
      x: Number(state.car.x.toFixed(2)),
      y: Number(state.car.y.toFixed(2)),
      angleRad: Number(state.car.angle.toFixed(3)),
      speed: Number(state.car.speed.toFixed(2)),
      onTrack: !state.offTrack,
      trackS: Number(state.car.trackS.toFixed(2)),
      totalProgress: Number(state.car.totalProgress.toFixed(2)),
      segmentIndex: state.car.segmentIndex,
    },
    laps: {
      completed: state.lapsCompleted,
      total: LAP_TARGET,
      nextLapAtProgress: Number(state.nextLapAt.toFixed(2)),
    },
    timers: {
      raceClock: Number(state.raceClock.toFixed(3)),
      currentLap: Number((state.raceClock - state.lapStartClock).toFixed(3)),
      lastLap: state.lastLap == null ? null : Number(state.lastLap.toFixed(3)),
      bestLap: state.bestLap == null ? null : Number(state.bestLap.toFixed(3)),
    },
  };
  return JSON.stringify(payload);
};

window.advanceTime = (ms) => {
  const frames = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < frames; i++) {
    update(FIXED_DT);
  }
  render();
  return Promise.resolve();
};
