const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const BASE_WIDTH = 960;
const BASE_HEIGHT = 540;
const FIXED_DT = 1 / 60;
const TRACK_HALF_WIDTH = 56;
const LAP_TARGET = 3;
const MAX_FORWARD_SPEED = 420;
const MAX_REVERSE_SPEED = -110;
const CAMERA_DISTANCE = 132;
const CAMERA_HEIGHT = 64;
const CAMERA_LOOK_AHEAD = 74;
const NEAR_PLANE = 0.5;
const FOV_DEG = 68;

const keysDown = new Set();

const sourceCenterline = [
  { x: 184, z: 156 },
  { x: 334, z: 98 },
  { x: 520, z: 108 },
  { x: 740, z: 178 },
  { x: 818, z: 302 },
  { x: 702, z: 430 },
  { x: 482, z: 474 },
  { x: 260, z: 424 },
  { x: 134, z: 300 },
];

const centerline = sourceCenterline.map((p) => ({
  x: (p.x - 480) * 1.65,
  z: (p.z - 270) * 1.65,
  y: 0,
}));

const track = makeTrack(centerline);
const startS = 24;
const startPose = poseAtS(startS);

const mountainMeshes = [
  {
    color: "#8da8bb",
    points: [
      vec3(-700, 0, -560),
      vec3(-180, 152, -760),
      vec3(180, 0, -610),
    ],
  },
  {
    color: "#7697ad",
    points: [
      vec3(-150, 0, -640),
      vec3(210, 116, -900),
      vec3(510, 0, -680),
    ],
  },
  {
    color: "#6288a1",
    points: [
      vec3(290, 0, -560),
      vec3(720, 138, -820),
      vec3(980, 0, -520),
    ],
  },
  {
    color: "#95b0c0",
    points: [
      vec3(-980, 0, -320),
      vec3(-640, 104, -580),
      vec3(-360, 0, -330),
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
    z: startPose.z,
    y: 0,
    angle: startPose.angle,
    speed: 0,
    trackS: startS,
    totalProgress: startS,
    segmentIndex: startPose.segmentIndex,
  },
  camera: {
    x: startPose.x - Math.cos(startPose.angle) * CAMERA_DISTANCE,
    y: CAMERA_HEIGHT,
    z: startPose.z - Math.sin(startPose.angle) * CAMERA_DISTANCE,
    tx: startPose.x,
    ty: 8,
    tz: startPose.z,
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

function makeTrack(points) {
  const segments = [];
  let totalLength = 0;
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz);
    const tx = len > 0 ? dx / len : 1;
    const tz = len > 0 ? dz / len : 0;
    segments.push({
      p0,
      p1,
      dx,
      dz,
      len,
      tx,
      tz,
      nx: -tz,
      nz: tx,
      startS: totalLength,
      endS: totalLength + len,
    });
    totalLength += len;
  }
  return { points, segments, totalLength };
}

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
  if (state.mode === "racing") {
    updateCar(dt);
    state.raceClock += dt;
    if (state.car.totalProgress >= state.nextLapAt && state.car.speed > 38) {
      completeLap();
    }
  }

  updateCamera(dt);
}

function updateCar(dt) {
  const car = state.car;

  let throttle = 0;
  if (isDown("ArrowUp", "KeyW", "Enter")) {
    throttle += 1;
  }
  if (isDown("ArrowDown", "KeyS")) {
    throttle -= 0.85;
  }

  let steer = 0;
  if (isDown("ArrowLeft", "KeyA")) {
    steer -= 1;
  }
  if (isDown("ArrowRight", "KeyD", "KeyB")) {
    steer += 1;
  }

  car.speed += throttle * 305 * dt;
  const rollingDrag = throttle === 0 ? 1.9 : 0.44;
  car.speed *= Math.exp(-rollingDrag * dt);
  car.speed = clamp(car.speed, MAX_REVERSE_SPEED, MAX_FORWARD_SPEED);

  const speedRatio = Math.min(1, Math.abs(car.speed) / 280);
  const steerRate = (2.52 - speedRatio * 1.35) * (car.speed >= 0 ? 1 : -1);
  car.angle += steer * steerRate * dt;

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.z += Math.sin(car.angle) * car.speed * dt;

  let nearest = nearestTrackPoint(car.x, car.z, car.segmentIndex, 2);
  const offDistance = nearest.dist - TRACK_HALF_WIDTH;
  state.offTrack = offDistance > 0;

  if (offDistance > 0) {
    car.speed *= Math.exp(-Math.min(2.8, 1.08 + offDistance / 28) * dt);
  }

  if (offDistance > 86) {
    const snap = nearestTrackPoint(car.x, car.z, car.segmentIndex, 4);
    car.x = snap.x;
    car.z = snap.z;
    car.angle = Math.atan2(snap.tz, snap.tx);
    car.speed = Math.min(car.speed, 90);
    nearest = snap;
  }

  const tangentAngle = Math.atan2(nearest.tz, nearest.tx);
  const alignmentError = normalizeAngle(tangentAngle - car.angle);
  const assistStrength = state.offTrack ? 0.55 : 1.5;
  const assistScale = Math.min(1, Math.abs(car.speed) / 230);
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
}

function updateCamera(dt) {
  const car = state.car;
  const forwardX = Math.cos(car.angle);
  const forwardZ = Math.sin(car.angle);

  const targetX = car.x - forwardX * CAMERA_DISTANCE;
  const targetY = CAMERA_HEIGHT + (state.offTrack ? 4 : 0);
  const targetZ = car.z - forwardZ * CAMERA_DISTANCE;

  const lookX = car.x + forwardX * CAMERA_LOOK_AHEAD;
  const lookY = 9;
  const lookZ = car.z + forwardZ * CAMERA_LOOK_AHEAD;

  const smooth = 1 - Math.exp(-8.5 * dt);
  state.camera.x = lerp(state.camera.x, targetX, smooth);
  state.camera.y = lerp(state.camera.y, targetY, smooth);
  state.camera.z = lerp(state.camera.z, targetZ, smooth);
  state.camera.tx = lerp(state.camera.tx, lookX, smooth);
  state.camera.ty = lerp(state.camera.ty, lookY, smooth);
  state.camera.tz = lerp(state.camera.tz, lookZ, smooth);
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
  state.car.z = pose.z;
  state.car.y = 0;
  state.car.angle = pose.angle;
  state.car.speed = 0;
  state.car.trackS = startS;
  state.car.totalProgress = startS;
  state.car.segmentIndex = pose.segmentIndex;

  const forwardX = Math.cos(pose.angle);
  const forwardZ = Math.sin(pose.angle);
  state.camera.x = pose.x - forwardX * CAMERA_DISTANCE;
  state.camera.y = CAMERA_HEIGHT;
  state.camera.z = pose.z - forwardZ * CAMERA_DISTANCE;
  state.camera.tx = pose.x + forwardX * CAMERA_LOOK_AHEAD;
  state.camera.ty = 9;
  state.camera.tz = pose.z + forwardZ * CAMERA_LOOK_AHEAD;
}

function render() {
  drawSky();

  const view = makeCameraView();
  const polygons = [];

  pushGround(polygons);
  pushMountains(polygons);
  pushTrack(polygons);
  pushCenterDashes(polygons);
  pushFinishLine(polygons);
  pushCar(polygons);

  drawPolygons(polygons, view);

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

function drawSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
  sky.addColorStop(0, "#6ea2ca");
  sky.addColorStop(0.58, "#a9c6dc");
  sky.addColorStop(0.581, "#89b28b");
  sky.addColorStop(1, "#4d7d59");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
}

function makeCameraView() {
  const eye = vec3(state.camera.x, state.camera.y, state.camera.z);
  const target = vec3(state.camera.tx, state.camera.ty, state.camera.tz);
  const worldUp = vec3(0, 1, 0);

  const forward = normalize(sub(target, eye));
  let right = cross(forward, worldUp);
  const rightLen = length(right);
  if (rightLen < 1e-6) {
    right = vec3(1, 0, 0);
  } else {
    right = scale(right, 1 / rightLen);
  }
  const up = normalize(cross(right, forward));

  const focal = BASE_HEIGHT / (2 * Math.tan((FOV_DEG * Math.PI) / 360));

  return {
    eye,
    forward,
    right,
    up,
    focal,
    cx: BASE_WIDTH * 0.5,
    cy: BASE_HEIGHT * 0.5,
  };
}

function project(point, view) {
  const rel = sub(point, view.eye);
  const xCam = dot(rel, view.right);
  const yCam = dot(rel, view.up);
  const zCam = dot(rel, view.forward);

  if (zCam <= NEAR_PLANE) {
    return null;
  }

  return {
    x: view.cx + (xCam / zCam) * view.focal,
    y: view.cy - (yCam / zCam) * view.focal,
    z: zCam,
  };
}

function drawPolygons(polygons, view) {
  const projected = [];

  for (const poly of polygons) {
    const pts = [];
    let depthSum = 0;
    let valid = true;

    for (const p of poly.points) {
      const proj = project(p, view);
      if (!proj) {
        valid = false;
        break;
      }
      pts.push(proj);
      depthSum += proj.z;
    }

    if (!valid || pts.length < 3) {
      continue;
    }

    projected.push({
      pts,
      color: poly.color,
      stroke: poly.stroke,
      depth: depthSum / pts.length,
    });
  }

  projected.sort((a, b) => b.depth - a.depth);

  for (const poly of projected) {
    ctx.beginPath();
    ctx.moveTo(poly.pts[0].x, poly.pts[0].y);
    for (let i = 1; i < poly.pts.length; i++) {
      ctx.lineTo(poly.pts[i].x, poly.pts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = poly.color;
    ctx.fill();
    if (poly.stroke) {
      ctx.strokeStyle = poly.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function pushGround(polygons) {
  polygons.push({
    color: "#5c8a63",
    points: [
      vec3(-1600, -2, -220),
      vec3(1600, -2, -220),
      vec3(2100, -2, 1900),
      vec3(-2100, -2, 1900),
    ],
  });

  polygons.push({
    color: "#7ba17d",
    points: [
      vec3(-2000, -1.8, 420),
      vec3(1900, -1.8, 420),
      vec3(2350, -1.8, 2100),
      vec3(-2500, -1.8, 2100),
    ],
  });
}

function pushMountains(polygons) {
  for (const mesh of mountainMeshes) {
    polygons.push({
      color: mesh.color,
      points: mesh.points,
    });
  }
}

function pushTrack(polygons) {
  for (let i = 0; i < track.segments.length; i++) {
    const seg = track.segments[i];
    const shade = i % 2 === 0 ? "#313841" : "#373f48";

    const l0 = vec3(seg.p0.x + seg.nx * TRACK_HALF_WIDTH, 0, seg.p0.z + seg.nz * TRACK_HALF_WIDTH);
    const r0 = vec3(seg.p0.x - seg.nx * TRACK_HALF_WIDTH, 0, seg.p0.z - seg.nz * TRACK_HALF_WIDTH);
    const r1 = vec3(seg.p1.x - seg.nx * TRACK_HALF_WIDTH, 0, seg.p1.z - seg.nz * TRACK_HALF_WIDTH);
    const l1 = vec3(seg.p1.x + seg.nx * TRACK_HALF_WIDTH, 0, seg.p1.z + seg.nz * TRACK_HALF_WIDTH);

    polygons.push({ color: shade, points: [l0, r0, r1, l1] });

    const edgeLift = 2;
    const edgeWidth = 7;

    const le0 = vec3(seg.p0.x + seg.nx * (TRACK_HALF_WIDTH - edgeWidth), edgeLift, seg.p0.z + seg.nz * (TRACK_HALF_WIDTH - edgeWidth));
    const le1 = vec3(seg.p1.x + seg.nx * (TRACK_HALF_WIDTH - edgeWidth), edgeLift, seg.p1.z + seg.nz * (TRACK_HALF_WIDTH - edgeWidth));
    const ue0 = vec3(seg.p0.x + seg.nx * TRACK_HALF_WIDTH, edgeLift, seg.p0.z + seg.nz * TRACK_HALF_WIDTH);
    const ue1 = vec3(seg.p1.x + seg.nx * TRACK_HALF_WIDTH, edgeLift, seg.p1.z + seg.nz * TRACK_HALF_WIDTH);
    polygons.push({ color: "#97a6b3", points: [le0, ue0, ue1, le1] });

    const re0 = vec3(seg.p0.x - seg.nx * (TRACK_HALF_WIDTH - edgeWidth), edgeLift, seg.p0.z - seg.nz * (TRACK_HALF_WIDTH - edgeWidth));
    const re1 = vec3(seg.p1.x - seg.nx * (TRACK_HALF_WIDTH - edgeWidth), edgeLift, seg.p1.z - seg.nz * (TRACK_HALF_WIDTH - edgeWidth));
    const ve0 = vec3(seg.p0.x - seg.nx * TRACK_HALF_WIDTH, edgeLift, seg.p0.z - seg.nz * TRACK_HALF_WIDTH);
    const ve1 = vec3(seg.p1.x - seg.nx * TRACK_HALF_WIDTH, edgeLift, seg.p1.z - seg.nz * TRACK_HALF_WIDTH);
    polygons.push({ color: "#97a6b3", points: [ve0, re0, re1, ve1] });
  }
}

function pushCenterDashes(polygons) {
  const dashLength = 32;
  const gap = 24;
  const halfWidth = 2.4;

  for (const seg of track.segments) {
    for (let t = 0; t < seg.len; t += dashLength + gap) {
      const s0 = t;
      const s1 = Math.min(seg.len, t + dashLength);
      if (s1 - s0 < 8) {
        continue;
      }

      const c0 = vec3(seg.p0.x + seg.tx * s0, 0.3, seg.p0.z + seg.tz * s0);
      const c1 = vec3(seg.p0.x + seg.tx * s1, 0.3, seg.p0.z + seg.tz * s1);

      polygons.push({
        color: "#e7ebef",
        points: [
          vec3(c0.x + seg.nx * halfWidth, c0.y, c0.z + seg.nz * halfWidth),
          vec3(c0.x - seg.nx * halfWidth, c0.y, c0.z - seg.nz * halfWidth),
          vec3(c1.x - seg.nx * halfWidth, c1.y, c1.z - seg.nz * halfWidth),
          vec3(c1.x + seg.nx * halfWidth, c1.y, c1.z + seg.nz * halfWidth),
        ],
      });
    }
  }
}

function pushFinishLine(polygons) {
  const pose = poseAtS(startS);
  const tx = Math.cos(pose.angle);
  const tz = Math.sin(pose.angle);
  const nx = -tz;
  const nz = tx;
  const halfTrack = TRACK_HALF_WIDTH - 4;
  const stripeDepth = 8;
  const strips = 12;

  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;

    const w0 = lerp(-halfTrack, halfTrack, t0);
    const w1 = lerp(-halfTrack, halfTrack, t1);

    const c = i % 2 === 0 ? "#f4f6f8" : "#14191f";

    polygons.push({
      color: c,
      points: [
        vec3(pose.x + nx * w0 - tx * stripeDepth, 0.35, pose.z + nz * w0 - tz * stripeDepth),
        vec3(pose.x + nx * w1 - tx * stripeDepth, 0.35, pose.z + nz * w1 - tz * stripeDepth),
        vec3(pose.x + nx * w1 + tx * stripeDepth, 0.35, pose.z + nz * w1 + tz * stripeDepth),
        vec3(pose.x + nx * w0 + tx * stripeDepth, 0.35, pose.z + nz * w0 + tz * stripeDepth),
      ],
    });
  }
}

function pushCar(polygons) {
  const car = state.car;
  const f = vec3(Math.cos(car.angle), 0, Math.sin(car.angle));
  const r = vec3(-f.z, 0, f.x);
  const u = vec3(0, 1, 0);

  const transform = (lx, ly, lz) => {
    return add(add(add(vec3(car.x, 1, car.z), scale(f, lx)), scale(u, ly)), scale(r, lz));
  };

  polygons.push({
    color: "rgba(0, 0, 0, 0.28)",
    points: [
      transform(16, -0.8, 7),
      transform(16, -0.8, -7),
      transform(-16, -0.8, -8),
      transform(-16, -0.8, 8),
    ],
  });

  const bodyColor = state.offTrack ? "#ecb358" : "#ff5f3d";
  const cabinColor = "#f4f7fb";
  const trimColor = "#222b35";

  polygons.push({ color: bodyColor, points: [transform(18, 4, 0), transform(-11, 3.5, 8), transform(-11, 3.5, -8)] });
  polygons.push({ color: bodyColor, points: [transform(18, 1.2, 0), transform(-14, 1.2, -9), transform(-14, 1.2, 9)] });

  polygons.push({
    color: bodyColor,
    points: [transform(18, 4, 0), transform(18, 1.2, 0), transform(-14, 1.2, 9), transform(-11, 3.5, 8)],
  });
  polygons.push({
    color: bodyColor,
    points: [transform(18, 4, 0), transform(-11, 3.5, -8), transform(-14, 1.2, -9), transform(18, 1.2, 0)],
  });

  polygons.push({
    color: cabinColor,
    points: [transform(8, 6.3, 0), transform(-3, 5.8, 4.5), transform(-3, 5.8, -4.5)],
  });

  polygons.push({ color: trimColor, points: [transform(-12, 2.4, 7.8), transform(-15, 2.4, 7.8), transform(-15, 0.8, 7.8), transform(-12, 0.8, 7.8)] });
  polygons.push({ color: trimColor, points: [transform(-12, 2.4, -7.8), transform(-15, 2.4, -7.8), transform(-15, 0.8, -7.8), transform(-12, 0.8, -7.8)] });
}

function drawHUD() {
  ctx.fillStyle = "rgba(15, 24, 31, 0.72)";
  ctx.fillRect(14, 14, 250, 96);

  ctx.fillStyle = "#eef4f8";
  ctx.font = "600 18px Trebuchet MS";
  ctx.fillText(`Lap ${Math.min(state.lapsCompleted + 1, LAP_TARGET)}/${LAP_TARGET}`, 24, 40);

  ctx.font = "600 30px Trebuchet MS";
  ctx.fillText(formatClock(state.raceClock), 24, 74);

  ctx.font = "500 14px Trebuchet MS";
  ctx.fillText(`Speed ${Math.max(0, Math.round(state.car.speed))} u/s`, 24, 96);
  ctx.textAlign = "right";
  ctx.fillText(`Best ${state.bestLap == null ? "--" : formatClock(state.bestLap)}`, 254, 96);
  ctx.textAlign = "left";
}

function drawMenuOverlay() {
  ctx.fillStyle = "rgba(10, 16, 22, 0.54)";
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  ctx.fillStyle = "#f1f6f9";
  ctx.textAlign = "center";
  ctx.font = "700 56px Trebuchet MS";
  ctx.fillText("POLYTRACK LOCAL", BASE_WIDTH / 2, 176);

  ctx.font = "500 24px Trebuchet MS";
  ctx.fillText("3D third-person time trial", BASE_WIDTH / 2, 220);

  ctx.font = "500 20px Trebuchet MS";
  ctx.fillText("Enter/Space: start  |  Arrows/WASD: drive  |  R/Space: restart", BASE_WIDTH / 2, 286);
  ctx.fillText("F: fullscreen toggle", BASE_WIDTH / 2, 320);

  ctx.font = "600 34px Trebuchet MS";
  ctx.fillText("Press Enter to race", BASE_WIDTH / 2, 390);
  ctx.textAlign = "left";
}

function drawFinishOverlay() {
  ctx.fillStyle = "rgba(9, 14, 20, 0.58)";
  ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

  ctx.fillStyle = "#f2f8fb";
  ctx.textAlign = "center";
  ctx.font = "700 60px Trebuchet MS";
  ctx.fillText("FINISH", BASE_WIDTH / 2, 214);

  ctx.font = "600 38px Trebuchet MS";
  ctx.fillText(`Total ${formatClock(state.raceClock)}`, BASE_WIDTH / 2, 272);

  ctx.font = "500 34px Trebuchet MS";
  ctx.fillText(`Best lap ${state.bestLap == null ? "--" : formatClock(state.bestLap)}`, BASE_WIDTH / 2, 332);
  ctx.font = "500 30px Trebuchet MS";
  ctx.fillText("Press Enter or Space to restart", BASE_WIDTH / 2, 392);
  ctx.textAlign = "left";
}

function nearestTrackPoint(x, z, referenceIndex = null, span = null) {
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
    const lenSq = seg.len * seg.len;
    let t = 0;

    if (lenSq > 0) {
      t = ((x - seg.p0.x) * seg.dx + (z - seg.p0.z) * seg.dz) / lenSq;
      t = clamp(t, 0, 1);
    }

    const px = seg.p0.x + seg.dx * t;
    const pz = seg.p0.z + seg.dz * t;
    const dist = Math.hypot(x - px, z - pz);

    if (!best || dist < best.dist) {
      best = {
        x: px,
        z: pz,
        dist,
        s: seg.startS + seg.len * t,
        tx: seg.tx,
        tz: seg.tz,
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
        y: 0,
        z: seg.p0.z + seg.dz * t,
        angle: Math.atan2(seg.tz, seg.tx),
        segmentIndex: i,
      };
    }
  }

  const first = track.segments[0];
  return {
    x: first.p0.x,
    y: 0,
    z: first.p0.z,
    angle: Math.atan2(first.tz, first.tx),
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

function vec3(x, y, z) {
  return { x, y, z };
}

function add(a, b) {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function sub(a, b) {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function scale(v, s) {
  return vec3(v.x * s, v.y * s, v.z * s);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
}

function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v) {
  const len = length(v);
  return len > 0 ? scale(v, 1 / len) : vec3(0, 0, 0);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

window.render_game_to_text = () => {
  const payload = {
    mode: state.mode,
    coordinateSystem: "world-space: origin at track center, +x right, +z forward on ground plane, +y up",
    track: {
      totalLength: Number(track.totalLength.toFixed(2)),
      halfWidth: TRACK_HALF_WIDTH,
      startLineS: startS,
    },
    car: {
      x: Number(state.car.x.toFixed(2)),
      y: Number(state.car.y.toFixed(2)),
      z: Number(state.car.z.toFixed(2)),
      angleRad: Number(state.car.angle.toFixed(3)),
      speed: Number(state.car.speed.toFixed(2)),
      onTrack: !state.offTrack,
      trackS: Number(state.car.trackS.toFixed(2)),
      totalProgress: Number(state.car.totalProgress.toFixed(2)),
      segmentIndex: state.car.segmentIndex,
    },
    camera: {
      x: Number(state.camera.x.toFixed(2)),
      y: Number(state.camera.y.toFixed(2)),
      z: Number(state.camera.z.toFixed(2)),
      targetX: Number(state.camera.tx.toFixed(2)),
      targetY: Number(state.camera.ty.toFixed(2)),
      targetZ: Number(state.camera.tz.toFixed(2)),
      fovDeg: FOV_DEG,
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
