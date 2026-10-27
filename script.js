'use strict';

/*
 * 채널을 바꿀 때는 이 배열만 수정하면 된다.
 * id     화면과 버튼에 보이는 번호
 * name   영상 왼쪽 위에 보이는 장소
 * type   "video" 또는 "offline"
 * video  type이 video일 때만 사용. 파일명은 카메라 번호와 같다.
 * screen offline 화면. "camera-offline" 또는 "no-signal"
 *
 * 영상이 있는 채널: 1, 3, 4, 5, 7, 8
 * CAM 02 는 꺼진 카메라, CAM 06 은 신호 없음.
 */
const cameras = [
  {
    id: "CAM 01",
    name: "WARD B - CORRIDOR A",
    type: "video",
    video: "videos/CCTV1.mp4"
  },
  {
    id: "CAM 02",
    name: "WARD B - BAY",
    type: "offline",
    screen: "camera-offline"
  },
  {
    id: "CAM 03",
    name: "ISOLATION ROOM 2A",
    type: "video",
    video: "videos/CCTV3.mp4"
  },
  {
    id: "CAM 04",
    name: "SURGERY PREP - ROOM 2",
    type: "video",
    video: "videos/CCTV4.mp4"
  },
  {
    id: "CAM 05",
    name: "PATHOLOGY LAB - SOUTH",
    type: "video",
    video: "videos/CCTV5.mp4"
  },
  {
    id: "CAM 06",
    name: "WARD B - PRIVATE",
    type: "offline",
    screen: "no-signal"
  },
  {
    id: "CAM 07",
    name: "WARD B - ROOM 2",
    type: "video",
    video: "videos/CCTV7.mp4"
  },
  {
    id: "CAM 08",
    name: "WARD B - ISOLATION 2",
    type: "video",
    video: "videos/CCTV8.mp4"
  }
];

/* 전환 연출은 0.5초를 넘기지 않는다. */
const SWITCH_MS = 320;
const ACQUIRED_MS = 160;
const ADMIN_TAPS = 5;
const ADMIN_TAP_GAP = 700;

const videos = [];
const feedsByIndex = [];
const buttons = [];
const roomsByIndex = [];

const feedsEl = document.getElementById('feeds');
const dockEl = document.getElementById('dock');
const osdIdEl = document.getElementById('osd-id');
const osdNameEl = document.getElementById('osd-name');
const dateEl = document.getElementById('osd-date');
const timeEl = document.getElementById('osd-time');
const statusEl = document.getElementById('status');
const staticEl = document.getElementById('static');
const staticTextEl = document.getElementById('static-text');
const gateEl = document.getElementById('gate');
const gateBtn = document.getElementById('gate-btn');
const adminEl = document.getElementById('admin');
const hotspotEl = document.getElementById('admin-hotspot');
const shellEl = document.getElementById('shell');
const soundBtn = document.getElementById('admin-sound');
const recEl = document.getElementById('osd-rec');
const offlineEl = document.getElementById('offline');
const offlineTitleEl = document.getElementById('offline-title');
const offlineMetaEl = document.getElementById('offline-meta');
const preloadEl = document.getElementById('admin-preload');
const mapGridEl = document.getElementById('map-grid');

let current = 0;
let booted = false;
let soundOn = false;
let switchToken = 0;
let switchTimer = 0;
let statusTimer = 0;
let preloadTimer = 0;
let adminTaps = [];

function isVideoCam(cam) {
  return !!cam && cam.type === 'video' && !!cam.video;
}

function isDeadScreen(cam) {
  return cam.screen === 'camera-offline';
}

function feedFor(index) {
  return feedsByIndex[index] || null;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function mapNumber(cam, index) {
  const digits = String(cam.id).match(/\d+/);
  if (!digits) return pad(index + 1);
  return digits[0].padStart(2, '0');
}

function swallow(pending) {
  if (pending && typeof pending.catch === 'function') pending.catch(function () {});
}

function seekStart(video) {
  try {
    if (video.readyState >= 1) video.currentTime = 0;
  } catch (err) {
    /* 메타데이터가 없으면 재생은 이미 0초에서 시작한다. */
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function showStatic(centerText) {
  staticTextEl.textContent = centerText || '';
  staticEl.classList.add('is-on');
  staticEl.setAttribute('aria-hidden', 'false');
}

function hideStatic() {
  staticEl.classList.remove('is-on');
  staticTextEl.textContent = '';
  staticEl.setAttribute('aria-hidden', 'true');
}

function isBroken(video) {
  return video.dataset.broken === '1' || !!(video.error && video.error.code);
}

function createFeeds() {
  cameras.forEach(function (cam, index) {
    if (!isVideoCam(cam)) return;

    const video = document.createElement('video');
    video.className = 'feed';
    video.preload = 'auto';
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute('muted', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', 'true');
    video.setAttribute('disableremoteplayback', '');
    video.dataset.index = String(index);
    video.dataset.broken = '0';
    video.setAttribute('aria-hidden', 'true');

    /* 시작 버튼을 누르기 전에는 자동재생이 화면 뒤에서 돌아가지 않게 막는다. */
    video.addEventListener('play', function () {
      if (!booted) video.pause();
    });
    video.addEventListener('error', function () {
      onFeedError(index);
    });
    video.addEventListener('click', function (event) {
      event.preventDefault();
    });

    video.src = cam.video;
    feedsEl.appendChild(video);
    videos.push(video);
    feedsByIndex[index] = video;
  });
}

function onFeedError(index) {
  const video = feedFor(index);
  if (!video) return;
  video.dataset.broken = '1';
  if (!booted || index !== current || switchTimer) return;
  showStatic('NO SIGNAL');
  setStatus('');
}

function buildButtons() {
  cameras.forEach(function (cam, index) {
    const button = document.createElement('button');
    const led = document.createElement('span');
    const label = document.createElement('span');

    button.type = 'button';
    button.className = 'cam-btn';
    if (cam.type === 'offline') button.classList.add('is-offline');
    led.className = cam.type === 'offline' ? 'led led-off' : 'led';
    led.setAttribute('aria-hidden', 'true');
    if (cam.type === 'offline') led.textContent = '×';
    label.className = 'cam-id';
    label.textContent = cam.id;
    button.setAttribute('aria-label', cam.id + ' ' + cam.name);
    button.appendChild(led);
    button.appendChild(label);
    button.addEventListener('click', function () {
      switchTo(index);
    });

    dockEl.appendChild(button);
    buttons.push(button);
  });
}

function buildMap() {
  cameras.forEach(function (cam, index) {
    const room = document.createElement('button');
    const number = document.createElement('span');

    room.type = 'button';
    room.className = 'room';
    if (index === 0) room.classList.add('room-hall');
    if (index === 5) room.classList.add('room-wide');
    if (cam.type === 'offline') room.classList.add('is-dead');
    number.className = 'room-num';
    number.textContent = mapNumber(cam, index);
    room.appendChild(number);

    if (cam.type === 'offline') {
      const mark = document.createElement('span');
      mark.className = 'room-x';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = '×';
      room.appendChild(mark);
    }

    room.setAttribute('aria-label', cam.id + ' ' + cam.name);
    room.addEventListener('click', function () {
      switchTo(index);
    });
    mapGridEl.appendChild(room);
    roomsByIndex[index] = room;
  });
}

function renderRec(cam) {
  recEl.replaceChildren();
  if (cam.type === 'offline') {
    recEl.textContent = isDeadScreen(cam) ? 'OFFLINE' : 'SIGNAL LOST';
    return;
  }
  recEl.append('REC ');
  const dot = document.createElement('i');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');
  recEl.appendChild(dot);
}

function renderSelection() {
  const cam = cameras[current];
  if (!cam) return;
  osdIdEl.textContent = cam.id;
  osdNameEl.textContent = cam.name;
  renderRec(cam);

  buttons.forEach(function (button, index) {
    const active = index === current;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  roomsByIndex.forEach(function (room, index) {
    if (!room) return;
    room.classList.toggle('is-active', index === current);
    room.setAttribute('aria-pressed', index === current ? 'true' : 'false');
  });
}

/* muted 속성이 남아 있으면 태블릿에서 소리를 켜도 계속 음소거되는 경우가 있다. */
function setMuted(video, muted) {
  video.muted = muted;
  video.defaultMuted = muted;
  if (muted) video.setAttribute('muted', '');
  else video.removeAttribute('muted');
}

function applySound() {
  videos.forEach(function (video) {
    const index = Number(video.dataset.index);
    const audible = soundOn && index === current && isVideoCam(cameras[current]);
    setMuted(video, !audible);
    video.volume = audible ? 1 : 0;
  });
  soundBtn.textContent = soundOn ? 'SOUND: ON' : 'SOUND: OFF';
}

function hideOffline() {
  offlineEl.hidden = true;
  offlineEl.classList.remove('is-nosignal', 'is-dead');
}

function showOffline(cam) {
  const dead = isDeadScreen(cam);
  offlineTitleEl.textContent = dead ? 'CAMERA OFFLINE' : 'NO SIGNAL';
  offlineMetaEl.textContent = cam.id + '\n' + (dead ? 'CONNECTION FAILURE' : 'SIGNAL LOST');
  offlineEl.classList.toggle('is-dead', dead);
  offlineEl.classList.toggle('is-nosignal', !dead);
  offlineEl.hidden = false;
}

/* 첫 터치 안에서 여섯 영상을 한 번씩 재생해 두면, 이후 전환에서도 재생이 막히지 않는다. */
function primeVideos() {
  videos.forEach(function (video) {
    const index = Number(video.dataset.index);
    setMuted(video, true);
    video.autoplay = true;
    const pending = video.play();
    if (!pending || typeof pending.then !== 'function') return;
    pending.then(function () {
      if (index !== current) {
        video.pause();
        seekStart(video);
      }
    }).catch(function () {});
  });
}

function revealFeed(index) {
  videos.forEach(function (video) {
    const i = Number(video.dataset.index);
    const active = i === index;
    video.classList.toggle('is-live', active);
    if (!active) {
      video.pause();
      setMuted(video, true);
      return;
    }
    setMuted(video, !soundOn);
    video.volume = soundOn ? 1 : 0;
    seekStart(video);
    swallow(video.play());
    if (video.readyState < 1) {
      const onReady = function () {
        video.removeEventListener('loadedmetadata', onReady);
        if (current !== index) return;
        seekStart(video);
      };
      video.addEventListener('loadedmetadata', onReady);
    }
  });
}

function clearSwitchTimers() {
  window.clearTimeout(switchTimer);
  window.clearTimeout(statusTimer);
  switchTimer = 0;
  statusTimer = 0;
}

/*
 * 버튼을 누르면 번호는 바로 바뀌고, 영상만 짧은 노이즈를 거친 뒤 처음부터 재생된다.
 * force는 같은 채널을 관리자 기능으로 다시 시작할 때 쓴다.
 */
function switchTo(index, force) {
  if (!booted) return;
  if (index < 0 || index >= cameras.length) return;
  if (!force && index === current) return;

  clearSwitchTimers();
  const token = ++switchToken;
  const cam = cameras[index];
  const offline = cam.type === 'offline';
  current = index;
  renderSelection();

  videos.forEach(function (video) {
    video.classList.remove('is-live');
    video.pause();
    setMuted(video, true);
  });
  hideOffline();

  if (!offline) {
    /* 소리 허용은 클릭 안에서 처리하고, 화면이 바뀔 때까지 음량은 0으로 둔다. */
    const next = feedFor(index);
    if (next) {
      setMuted(next, !soundOn);
      next.volume = 0;
      next.autoplay = true;
      seekStart(next);
      swallow(next.play());
    }
    showStatic('');
    setStatus('CAMERA CONNECTING...');
  } else {
    /* 고장 채널은 기다리는 화면처럼 보이지 않게, 고장 문구를 바로 보여 준다. */
    showStatic(isDeadScreen(cam) ? 'CAMERA OFFLINE' : 'NO SIGNAL');
    setStatus('');
  }

  switchTimer = window.setTimeout(function () {
    if (token !== switchToken) return;
    switchTimer = 0;

    if (offline) {
      hideStatic();
      showOffline(cam);
      return;
    }

    const video = feedFor(index);
    revealFeed(index);

    if (!video || isBroken(video)) {
      showStatic('NO SIGNAL');
      setStatus('');
      return;
    }

    hideStatic();
    setStatus('SIGNAL ACQUIRED');
    statusTimer = window.setTimeout(function () {
      if (token !== switchToken) return;
      statusTimer = 0;
      setStatus('');
    }, ACQUIRED_MS);
  }, SWITCH_MS);
}

function updateClock() {
  const now = new Date();
  dateEl.textContent = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  timeEl.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}

function requestFullscreen() {
  const root = document.documentElement;
  let pending = null;
  try {
    if (root.requestFullscreen) {
      pending = root.requestFullscreen({ navigationUI: 'hide' });
    } else if (root.webkitRequestFullscreen) {
      pending = root.webkitRequestFullscreen();
    }
  } catch (err) {
    try {
      if (root.requestFullscreen) pending = root.requestFullscreen();
    } catch (second) {
      pending = null;
    }
  }
  if (pending && typeof pending.then === 'function') {
    pending.then(lockLandscape).catch(function () {});
  } else {
    lockLandscape();
  }
}

function lockLandscape() {
  try {
    if (!screen.orientation || typeof screen.orientation.lock !== 'function') return;
    swallow(screen.orientation.lock('landscape'));
  } catch (err) {
    /* 전체화면이 아니면 방향 잠금은 실패해도 된다. */
  }
}

function boot() {
  if (booted) return;
  booted = true;
  gateEl.hidden = true;
  shellEl.inert = false;
  requestFullscreen();
  if (!cameras.length) return;
  switchTo(0, true);
  primeVideos();
}

function preloadState(video) {
  if (!video) return 'MISSING';
  if (video.dataset.broken === '1' || (video.error && video.error.code)) return 'MISSING';
  if (video.readyState >= 4) return 'READY';
  if (video.readyState >= 2) return 'BUFFERED';
  if (video.readyState >= 1) return 'LOADING';
  return 'WAITING';
}

function renderPreload() {
  preloadEl.replaceChildren();
  cameras.forEach(function (cam, index) {
    if (!isVideoCam(cam)) return;
    const row = document.createElement('div');
    const name = document.createElement('span');
    const state = document.createElement('span');
    name.textContent = cam.id;
    state.textContent = preloadState(feedFor(index));
    row.appendChild(name);
    row.appendChild(state);
    preloadEl.appendChild(row);
  });
}

function openAdmin() {
  if (!booted || !adminEl.hidden) return;
  applySound();
  adminEl.hidden = false;
  renderPreload();
  window.clearInterval(preloadTimer);
  preloadTimer = window.setInterval(renderPreload, 500);
}

function closeAdmin() {
  adminEl.hidden = true;
  adminTaps = [];
  window.clearInterval(preloadTimer);
  preloadTimer = 0;
}

function toggleSound() {
  soundOn = !soundOn;
  applySound();
  const active = feedFor(current);
  if (soundOn && active) swallow(active.play());
}

function bindAdmin() {
  hotspotEl.addEventListener('pointerdown', function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (!booted || !adminEl.hidden) return;

    const now = Date.now();
    const last = adminTaps.length ? adminTaps[adminTaps.length - 1] : 0;
    if (now - last > ADMIN_TAP_GAP) adminTaps = [];
    adminTaps.push(now);
    if (adminTaps.length >= ADMIN_TAPS) {
      adminTaps = [];
      openAdmin();
    }
  });

  soundBtn.addEventListener('click', toggleSound);
  document.getElementById('admin-reset').addEventListener('click', function () {
    switchTo(0, true);
  });
  document.getElementById('admin-full').addEventListener('click', requestFullscreen);
  document.getElementById('admin-replay').addEventListener('click', function () {
    switchTo(current, true);
  });
  document.getElementById('admin-close').addEventListener('click', closeAdmin);
}

function bindGuards() {
  window.addEventListener('contextmenu', function (event) {
    event.preventDefault();
  }, true);

  window.addEventListener('selectstart', function (event) {
    event.preventDefault();
  });

  window.addEventListener('dragstart', function (event) {
    event.preventDefault();
  });

  document.addEventListener('gesturestart', function (event) {
    event.preventDefault();
  });

  document.addEventListener('touchstart', function (event) {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });

  /* 밀어서 새로고침하거나 페이지가 흔들리지 않게 한다. */
  document.addEventListener('touchmove', function (event) {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener('wheel', function (event) {
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !adminEl.hidden) {
      closeAdmin();
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace') event.preventDefault();
    if (event.code === 'Space' && event.target.tagName !== 'BUTTON') event.preventDefault();
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (!booted) return;
    if (document.hidden) {
      videos.forEach(function (video) { video.pause(); });
      return;
    }
    const active = feedFor(current);
    if (active) swallow(active.play());
  });

  try {
    history.pushState({ cctv: 1 }, '', location.href);
    window.addEventListener('popstate', function () {
      try { history.pushState({ cctv: 1 }, '', location.href); } catch (err) {}
    });
  } catch (err) {
    /* 일부 로컬 주소에서는 뒤로 가기를 고정할 수 없다. */
  }
}

function init() {
  shellEl.inert = true;
  createFeeds();
  buildButtons();
  buildMap();
  renderSelection();
  updateClock();
  window.setInterval(updateClock, 1000);
  gateBtn.addEventListener('click', boot);
  bindAdmin();
  bindGuards();
}

init();
