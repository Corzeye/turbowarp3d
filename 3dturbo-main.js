// Name: 3D Turbo
// Description: A Three.js powered 3D engine with scenes, physics, audio, prefabs, saving, player styles, terrain, animation, per-face textures, editor and model loading.
// License: MIT

(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    throw new Error('3D Turbo must be loaded as an unsandboxed extension');
  }

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
  const GLTF_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
  const OBJ_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/OBJLoader.js/+esm';
  const TC_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/TransformControls.js/+esm';
  const ROOM_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';
  const FBX_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/FBXLoader.js/+esm';
  const DAE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/ColladaLoader.js/+esm';
  const STL_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/STLLoader.js/+esm';
  const DRACO_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js/+esm';
  const MESHOPT_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js/+esm';
  const ASSET_VAR = '3D Turbo files';
  const MODEL_EXTS = ['glb', 'gltf', 'obj', 'fbx', 'dae', 'stl'];
  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];

  const Cast = Scratch.Cast;
  const num = (v) => Cast.toNumber(v);
  const str = (v) => Cast.toString(v);
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  let THREE, TransformControls;
  let loading = null;
  let isReady = false;
  let renderer, scene, camera, clock, canvas, raycaster;
  let enabled = true;
  let lastW = 0;
  let lastH = 0;
  let camYaw = 0;
  let camPitch = 0;
  let ambient = null;
  let sun = null;

  // editor and interaction
  let tc = null;
  let selected = null;
  let crosshair = null;
  let crosshairOn = true;
  let rightDown = false;
  const mouseButtons = new Set();
  const snap = { move: 0.5, rotate: 15, scale: 0.25 };

  // settings
  let flyMode = false;
  let mouseLook = false;
  let sensitivity = 0.15;
  let reach = 50;
  let quality = 1;
  let shadowsOn = false;

  // mouse
  let accDX = 0;
  let accDY = 0;
  let deltaX = 0;
  let deltaY = 0;

  // fps
  let fps = 0;
  let frames = 0;
  let fpsTime = 0;

  // keyboard
  const pressed = new Set();

  // premade player
  const player = {
    mode: 'off',
    pos: null,
    spawn: null,
    vy: 0,
    vx: 0,
    vz: 0,
    onGround: false,
    walkSpeed: 4,
    sprint: 1.8,
    jump: 1.2,
    gravity: 22,
    accel: 70,
    friction: 90,
    airAccel: 70,
    airFriction: 70,
    edge: 0.2,
    coyote: 0,
    jumpBuf: 0,
    eye: 1.7,
    radius: 0.35,
    step: 0.5,
    flySpeed: 8,
    flySprint: 3,
    floorOn: true,
    floorY: 0,
    keys: { forward: 'w', back: 's', left: 'a', right: 'd', jump: 'space', sprint: 'shift', down: 'c' }
  };

  let objects = new Map();
  let idIndex = new Map();
  let mixers = new Map();
  const textureCache = new Map();
  let groups = new Map(); // group name -> Set of object names
  const uiItems = new Map(); // sprite id -> { img, key }
  const uiOptOut = new Set();
  let uiLayer = null;
  let toolbar = null;
  let toolbarInfo = null;
  const toolbarButtons = {};
  const toolbarSliders = {};
  let toolbarSel = null;
  let snapLock = false;
  let lastCreated = '';
  let autoId = 0;

  // hover shading (the Minecraft-style darkening of what you look at)
  const hoverShade = { on: true, amount: 0.25 };
  const hoverOrig = new Map();
  let hoverObj = null;

  // particles
  const bursts = [];
  const particleCfg = { life: 1, gravity: 14, shape: 'cube' };
  let particleGeos = null;
  let particleMat = null;
  let totalParticles = 0;
  let sampleCanvas = null;

  // clicks (pressedNow collects between ticks, pressedThisFrame is what scripts see)
  const pressedNow = new Set();
  const pressedThisFrame = new Set();

  const stageCanvas = () => Scratch.vm.runtime.renderer.canvas;

  const toColor = (v) => {
    const c = Cast.toRgbColorObject(v);
    return new THREE.Color().setRGB(c.r / 255, c.g / 255, c.b / 255, THREE.SRGBColorSpace);
  };

  const materialsOf = (obj) => {
    const list = [];
    obj.traverse((child) => {
      if (!child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => list.push(m));
    });
    return list;
  };

  // keyboard helpers

  const keyCodes = (name) => {
    const k = str(name).trim().toLowerCase();
    if (/^[a-z]$/.test(k)) return ['Key' + k.toUpperCase()];
    if (/^[0-9]$/.test(k)) return ['Digit' + k, 'Numpad' + k];
    const map = {
      space: ['Space'],
      shift: ['ShiftLeft', 'ShiftRight'],
      ctrl: ['ControlLeft', 'ControlRight'],
      control: ['ControlLeft', 'ControlRight'],
      alt: ['AltLeft', 'AltRight'],
      'up arrow': ['ArrowUp'],
      'down arrow': ['ArrowDown'],
      'left arrow': ['ArrowLeft'],
      'right arrow': ['ArrowRight'],
      enter: ['Enter'],
      tab: ['Tab']
    };
    return map[k] || [];
  };

  const keyDown = (name) => keyCodes(name).some((c) => pressed.has(c));

  // imported files (saved inside the project in a stage variable)

  let assetRaw = null;
  let assetMap = {};

  const assetVar = () => {
    const stage = Scratch.vm.runtime.getTargetForStage();
    if (!stage) return null;
    return stage.lookupOrCreateVariable('turbo3d_files', ASSET_VAR);
  };

  const readAssets = () => {
    const v = assetVar();
    const raw = v ? str(v.value) : '';
    if (raw !== assetRaw) {
      assetRaw = raw;
      try {
        assetMap = raw && raw !== '0' ? JSON.parse(raw) : {};
      } catch (e) {
        assetMap = {};
      }
    }
    return assetMap;
  };

  const writeAssets = () => {
    const v = assetVar();
    if (!v) return;
    assetRaw = JSON.stringify(assetMap);
    v.value = assetRaw;
  };

  const assetNames = (type) => {
    const store = readAssets();
    const names = Object.keys(store).filter((n) => !type || store[n].type === type);
    return names.length ? names : ['none'];
  };

  // small message on the stage (so problems are visible without opening the console)

  let toastEl = null;
  let toastTimer = 0;
  const stageParent = () => {
    const canvasEl = stageCanvas();
    const parent = canvasEl ? canvasEl.parentElement : null;
    if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    return parent;
  };
  const toast = (msg) => {
    console.warn('3D Turbo: ' + msg);
    try {
      const parent = stageParent();
      if (!parent) return;
      if (!toastEl) {
        toastEl = document.createElement('div');
        Object.assign(toastEl.style, {
          position: 'absolute',
          left: '50%',
          bottom: '6%',
          transform: 'translateX(-50%)',
          maxWidth: '90%',
          padding: '0.5em 1em',
          borderRadius: '0.5em',
          background: 'rgba(60,20,40,0.92)',
          color: '#fff',
          font: '14px sans-serif',
          textAlign: 'center',
          zIndex: '40',
          pointerEvents: 'none'
        });
      }
      toastEl.textContent = msg;
      parent.appendChild(toastEl);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl && toastEl.remove(), 7000);
    } catch (e) {
      /* ignore */
    }
  };

  // loading progress + frame breaks (so your own loading screen can draw and animate)

  let loadPct = 0;
  const setLoadBar = (pct) => {
    loadPct = pct;
  };

  // lets the browser draw a frame, so the loading screen actually shows up
  // (the timeout makes sure it never waits forever in a background tab)
  const nextFrame = () =>
    new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      requestAnimationFrame(() => setTimeout(finish, 0));
      setTimeout(finish, 150);
    });

  const loadStep = async (pct) => {
    setLoadBar(pct);
    await nextFrame();
  };

  const readDataURL = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const dataURLToBuffer = (url) => {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };

  const pickFile = (accept) =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.onchange = () => resolve(input.files[0] || null);
      input.oncancel = () => resolve(null);
      input.click();
    });

  // scene helpers

  const attach = () => {
    const stage = stageCanvas();
    const parent = stage ? stage.parentElement : null;
    if (!parent) {
      // cannot sit in the background -> do not show anywhere
      canvas.style.display = 'none';
      if (uiLayer) uiLayer.style.display = 'none';
      return;
    }
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    // 3D world: always the background layer, directly above the stage backdrop
    canvas.style.zIndex = '1';
    parent.appendChild(canvas);
    if (crosshair) parent.appendChild(crosshair);
    // sprites (mirrored in uiLayer): always above the 3D world
    if (uiLayer) {
      uiLayer.style.zIndex = '5';
      parent.appendChild(uiLayer);
    }
    if (toolbar) parent.appendChild(toolbar);
    if (enabled) {
      canvas.style.display = 'block';
      if (uiLayer) uiLayer.style.display = 'block';
    }
  };

  // groups (lots of blocks, one name)

  const leaveGroup = (obj) => {
    const g = obj.userData.group;
    if (!g) return;
    const set = groups.get(g);
    if (set) {
      set.delete(obj.userData.name);
      if (!set.size) groups.delete(g);
    }
    obj.userData.group = null;
  };

  const joinGroup = (obj, group) => {
    leaveGroup(obj);
    const g = str(group).trim();
    if (!g) return;
    if (!groups.has(g)) groups.set(g, new Set());
    groups.get(g).add(obj.userData.name);
    obj.userData.group = g;
  };

  // a name can be one object or a whole group
  const targetsOf = (name) => {
    const n = str(name);
    const o = objects.get(n) || idIndex.get(n);
    if (o) return [o];
    const g = groups.get(n);
    if (!g) return selectObjects(n);
    const list = [];
    g.forEach((m) => {
      const x = objects.get(m);
      if (x) list.push(x);
    });
    return list;
  };

  const uniqueName = (base) => {
    let n;
    do {
      n = base + '#' + ++autoId;
    } while (objects.has(n));
    return n;
  };

  const matchesHit = (hit, name) => {
    if (!hit) return false;
    const n = str(name);
    return hit.name === n || hit.object.userData.group === n || selectorTest(hit.object, n);
  };

  // hover shading

  const clearHover = () => {
    hoverOrig.forEach((c, m) => m.color.copy(c));
    hoverOrig.clear();
    hoverObj = null;
  };

  const applyHover = (obj) => {
    clearHover();
    hoverObj = obj;
    materialsOf(obj).forEach((m) => {
      if (!m.color || hoverOrig.has(m)) return;
      hoverOrig.set(m, m.color.clone());
      m.color.multiplyScalar(1 - hoverShade.amount);
    });
  };

  // call before changing an object's colors so the hover shade never gets baked in
  const touchColor = (obj) => {
    if (hoverObj === obj) clearHover();
  };

  const updateHover = () => {
    let target = null;
    if (hoverShade.on && player.mode !== 'editor' && (!mouseLook || document.pointerLockElement)) {
      const hit = pickAt(0, 0, reach);
      if (hit && hit.object.userData.hover !== false) target = hit.object;
    }
    if (target !== hoverObj) {
      if (target) applyHover(target);
      else clearHover();
    }
  };

  // faces (box: 6 sides, cylinder / cone: side, top, bottom)

  const faceCount = { cube: 6, cylinder: 3, cone: 3 };
  const cubeFaces = { right: 0, left: 1, top: 2, bottom: 3, front: 4, back: 5 };

  const slotsFor = (shape, face) => {
    if (!faceCount[shape] || face === 'all') return null;
    if (shape === 'cube') return face === 'sides' ? [0, 1, 4, 5] : [cubeFaces[face]];
    if (face === 'top') return shape === 'cylinder' ? [1] : [];
    if (face === 'bottom') return [2];
    return [0];
  };

  const ensureFaceMaterials = (obj) => {
    if (!obj.isMesh || Array.isArray(obj.material)) return;
    const n = faceCount[obj.userData.shape];
    if (!n) return;
    const base = obj.material;
    obj.material = Array.from({ length: n }, () => {
      const m = base.clone();
      if (m.map) {
        m.map = m.map.clone();
        m.map.needsUpdate = true;
      }
      return m;
    });
    base.dispose();
  };

  // the materials a "face" argument points at (all of them for models and round shapes)
  const materialsForFace = (obj, face) => {
    touchColor(obj);
    let f = face === undefined || face === null ? 'all' : str(face).trim().toLowerCase();
    if (!['all', 'top', 'bottom', 'sides', 'front', 'back', 'left', 'right'].includes(f)) f = 'all';
    const slots = slotsFor(obj.userData.shape, f);
    if (!obj.isMesh || slots === null) return materialsOf(obj);
    ensureFaceMaterials(obj);
    return slots.map((i) => obj.material[i]).filter(Boolean);
  };

  // particles

  const clearParticles = () => {
    for (const b of bursts) {
      scene.remove(b.mesh);
      b.mesh.dispose();
    }
    bursts.length = 0;
    totalParticles = 0;
    emitters.forEach((e) => {
      e.n = 0;
      if (e.mesh) e.mesh.count = 0;
    });
  };

  const dropBurst = (index) => {
    const b = bursts[index];
    scene.remove(b.mesh);
    b.mesh.dispose();
    totalParticles -= b.count;
    bursts.splice(index, 1);
  };

  const spawnBurst = (count, origin, spread, colors, size, speed) => {
    count = Math.max(1, Math.min(500, Math.floor(count) || 1));
    size = size > 0 ? size : 0.15;
    while (bursts.length && totalParticles + count > 4000) dropBurst(0);
    const geo = particleCfg.shape === 'sphere' ? particleGeos.sphere : particleGeos.cube;
    const mesh = new THREE.InstancedMesh(geo, particleMat, count);
    mesh.frustumCulled = false;
    mesh.castShadow = shadowsOn;
    const parts = [];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (dir.lengthSq() < 0.0001) dir.set(0, 1, 0);
      const v = dir.normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      v.y += speed * 0.35;
      parts.push({
        p: new THREE.Vector3(
          origin.x + (Math.random() * 2 - 1) * spread.x,
          origin.y + (Math.random() * 2 - 1) * spread.y,
          origin.z + (Math.random() * 2 - 1) * spread.z
        ),
        v,
        s: size * (0.6 + Math.random() * 0.8),
        rx: Math.random() * 6.28,
        ry: Math.random() * 6.28,
        sx: (Math.random() * 2 - 1) * 6,
        sy: (Math.random() * 2 - 1) * 6
      });
      c.copy(colors[Math.floor(Math.random() * colors.length)]).multiplyScalar(0.85 + Math.random() * 0.3);
      mesh.setColorAt(i, c);
    }
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    bursts.push({ mesh, parts, age: 0, life: particleCfg.life, count });
    totalParticles += count;
  };

  const updateParticles = (dt) => {
    if (!bursts.length) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const ground = player.floorOn ? player.floorY : -Infinity;
    for (let bi = bursts.length - 1; bi >= 0; bi--) {
      const b = bursts[bi];
      b.age += dt;
      if (b.age >= b.life) {
        dropBurst(bi);
        continue;
      }
      const t = b.age / b.life;
      const fade = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
      for (let i = 0; i < b.parts.length; i++) {
        const pt = b.parts[i];
        pt.v.y -= particleCfg.gravity * dt;
        pt.p.addScaledVector(pt.v, dt);
        const half = pt.s * 0.5;
        if (pt.p.y < ground + half) {
          pt.p.y = ground + half;
          pt.v.set(0, 0, 0);
          pt.sx = 0;
          pt.sy = 0;
        }
        pt.rx += pt.sx * dt;
        pt.ry += pt.sy * dt;
        q.setFromEuler(e.set(pt.rx, pt.ry, 0));
        const s = pt.s * fade;
        sc.set(s, s, s);
        m.compose(pt.p, q, sc);
        b.mesh.setMatrixAt(i, m);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  // ===== selectors, tags and data (every [NAME] argument understands these) =====
  //   box1            one object (or a whole group)
  //   box*  b?x       wildcards          box{1-25}   box1 to box25
  //   #enemy          everything tagged "enemy"       @cube  @grass  @model  @light   by type
  //   $hp>3  $team=red   by data value (= != > < >= <=)
  //   a,b,c           several at once     @cube&#red   AND      !#dead   NOT
  //   *               every object

  const SELECTOR_CHARS = /[*?#@$&,!{]/;
  const selectorCache = new Map();

  const tagList = (o) => o.userData.tags || (o.userData.tags = []);
  const dataStore = (o) => o.userData.data || (o.userData.data = {});
  const typeOfObj = (o) => {
    if (o.isLight) return 'light';
    if (o.userData.blockType) return o.userData.blockType;
    if (o.userData.shape) return o.userData.shape;
    return o.userData.clips ? 'model' : 'object';
  };

  const expandRange = (s, out = []) => {
    const m = /\{(\d+)-(\d+)\}/.exec(s);
    if (!m) {
      out.push(s);
      return out;
    }
    let a = parseInt(m[1], 10);
    let b = parseInt(m[2], 10);
    if (a > b) [a, b] = [b, a];
    b = Math.min(b, a + 5000);
    for (let i = a; i <= b && out.length < 20000; i++) {
      expandRange(s.slice(0, m.index) + i + s.slice(m.index + m[0].length), out);
    }
    return out;
  };

  const globTest = (pattern) => {
    const names = expandRange(pattern);
    const exact = new Set();
    const regs = [];
    names.forEach((n) => {
      if (/[*?]/.test(n)) {
        regs.push(new RegExp('^' + n.replace(/[.+^$()|\\[\]]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'));
      } else exact.add(n);
    });
    return (s) => s !== null && s !== undefined && (exact.has(s) || regs.some((r) => r.test(s)));
  };

  const compareData = (have, op, want) => {
    const hn = Number(have);
    const wn = Number(want);
    const numeric = have !== '' && want !== '' && !isNaN(hn) && !isNaN(wn);
    const a = numeric ? hn : String(have);
    const b = numeric ? wn : String(want);
    switch (op) {
      case '=': return a === b;
      case '!=': return a !== b;
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
    }
    return false;
  };

  const makeFactor = (raw) => {
    let f = raw.trim();
    let neg = false;
    if (f[0] === '!') {
      neg = true;
      f = f.slice(1).trim();
    }
    let test;
    if (f[0] === '#') {
      const tags = f.slice(1).split('+').map((t) => t.trim());
      test = (o) => tags.every((t) => tagList(o).includes(t));
    } else if (f[0] === '@') {
      const t = f.slice(1).trim().toLowerCase();
      test = (o) => typeOfObj(o).toLowerCase() === t || (t === 'block' && !!o.userData.blockType);
    } else if (f[0] === '$') {
      const m = /^\$([^=<>!]+?)\s*(?:(>=|<=|!=|=|>|<)\s*(.*))?$/.exec(f);
      if (!m) test = () => false;
      else {
        const key = m[1].trim();
        const op = m[2];
        const want = m[3] === undefined ? '' : m[3].trim();
        test = (o) => {
          const d = o.userData.data;
          if (!d || !(key in d)) return false;
          return op ? compareData(d[key], op, want) : true;
        };
      }
    } else if (f === '*') {
      test = (o) => !o.isLight;
    } else {
      const g = globTest(f);
      test = (o, n) => g(n) || g(o.userData.group);
    }
    return neg ? (o, n) => !test(o, n) : test;
  };

  const compileSelector = (sel) => {
    let c = selectorCache.get(sel);
    if (c) return c;
    c = sel
      .split(',')
      .map((term) => term.trim())
      .filter(Boolean)
      .map((term) => term.split('&').map(makeFactor));
    if (selectorCache.size > 300) selectorCache.clear();
    selectorCache.set(sel, c);
    return c;
  };

  const selectorTest = (obj, sel) => {
    if (!SELECTOR_CHARS.test(sel)) return false;
    const n = obj.userData.name;
    return compileSelector(sel).some((term) => term.every((f) => f(obj, n)));
  };

  const selectObjects = (sel) => {
    if (!SELECTOR_CHARS.test(sel)) return [];
    const terms = compileSelector(sel);
    if (!terms.length) return [];
    const out = [];
    for (const [n, o] of objects) {
      if (terms.some((term) => term.every((f) => f(o, n)))) out.push(o);
    }
    return out;
  };

  // same matching for plain lists of names (used for particle emitters)
  const selectNames = (sel, names) => {
    const list = Array.from(names);
    if (list.includes(sel)) return [sel];
    if (!SELECTOR_CHARS.test(sel)) return [];
    const tests = sel.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (t === '*' ? () => true : globTest(t)));
    return list.filter((n) => tests.some((t) => t(n)));
  };

  // ===== player helpers =====

  const camVel = { x: 0, y: 0, z: 0 };

  const playerFeet = (out) => {
    if (player.mode === 'fp') return out.copy(player.pos);
    return out.set(camera.position.x, camera.position.y - player.eye, camera.position.z);
  };

  const lookDir = (out) => {
    const yaw = rad(camYaw);
    const pitch = rad(camPitch);
    return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  };

  const playerVelocity = () => {
    if (player.mode === 'fp') return { x: player.vx, y: player.vy, z: player.vz };
    return camVel;
  };

  // ===== particle emitters (Unity style particle systems) =====

  let emitters = new Map();
  const EMITTER_LIMIT = 30000; // alive particles across every emitter
  const STRIDE = 17; // px py pz vx vy vz age life size rot rot2 spin spin2 r g b phase
  const TAU = Math.PI * 2;
  const LOOKS_3D = ['cube', 'sphere'];

  const PRESETS = {
    default: {},
    fire: {
      rate: 40, life: 0.9, lifeRand: 0.3, speed: 1.2, speedRand: 0.5, size: 0.45, sizeRand: 0.15, sizeEnd: 0.1,
      colorA: '#ffb020', colorB: '#ff5a10', colorEnd: '#a01000', useEnd: true, gravity: -2.5, turbulence: 2,
      shape: 'cone', angle: 12, radius: 0.2, look: 'soft glow', additive: true
    },
    smoke: {
      rate: 12, life: 3, lifeRand: 0.8, speed: 0.6, speedRand: 0.3, size: 0.5, sizeRand: 0.15, sizeEnd: 3,
      colorA: '#8a8a8a', colorB: '#555555', alpha: 0.5, gravity: -0.6, turbulence: 1.2, shape: 'cone', angle: 15,
      radius: 0.2, look: 'soft glow', spin: 20, spinRand: 30
    },
    sparks: {
      rate: 0, burstCount: 30, burstEvery: 0, life: 0.7, lifeRand: 0.3, speed: 6, speedRand: 3, size: 0.1,
      sizeRand: 0.03, sizeEnd: 0.2, colorA: '#fff2a0', colorB: '#ff9a30', gravity: 12, drag: 0.4, shape: 'sphere',
      radius: 0.05, look: 'spark', additive: true, floor: 'bounce', bounce: 0.4
    },
    explosion: {
      rate: 0, burstCount: 70, burstEvery: 0, life: 0.9, lifeRand: 0.3, speed: 7, speedRand: 3, size: 0.6,
      sizeRand: 0.25, sizeEnd: 0.2, colorA: '#ffd060', colorB: '#ff4a10', colorEnd: '#331a10', useEnd: true,
      drag: 2.5, shape: 'sphere', radius: 0.2, look: 'soft glow', additive: true
    },
    debris: {
      rate: 0, burstCount: 20, burstEvery: 0, life: 1.6, lifeRand: 0.4, speed: 3.5, speedRand: 1.5, size: 0.15,
      sizeRand: 0.05, sizeEnd: 1, colorA: '#8a6a4a', colorB: '#6a6a6a', alpha: 1, alphaEnd: 1, gravity: 18,
      shape: 'sphere', radius: 0.2, look: 'cube', lit: true, floor: 'bounce', bounce: 0.35, spin: 300, spinRand: 200
    },
    snow: {
      rate: 60, life: 7, lifeRand: 1.5, speed: 1, speedRand: 0.3, size: 0.09, sizeRand: 0.03, sizeEnd: 1,
      colorA: '#ffffff', colorB: '#dff0ff', alpha: 0.9, alphaEnd: 0.9, turbulence: 0.7, shape: 'box', radius: 8,
      height: 0, angle: 15, dirY: -1, look: 'circle', floor: 'die', max: 1500
    },
    rain: {
      rate: 220, life: 1.3, lifeRand: 0.2, speed: 16, speedRand: 2, size: 0.05, sizeRand: 0.01, sizeEnd: 1,
      colorA: '#9ec8ff', colorB: '#cfe4ff', alpha: 0.7, alphaEnd: 0.7, shape: 'box', radius: 8, height: 0, angle: 3,
      dirY: -1, look: 'circle', floor: 'die', max: 2500
    },
    fountain: {
      rate: 80, life: 1.8, lifeRand: 0.2, speed: 8, speedRand: 1, size: 0.14, sizeRand: 0.04, sizeEnd: 0.8,
      colorA: '#7fd0ff', colorB: '#bfeaff', alpha: 0.9, alphaEnd: 0.2, gravity: 14, shape: 'cone', angle: 12,
      radius: 0.1, look: 'circle', floor: 'die'
    },
    magic: {
      rate: 30, life: 1.6, lifeRand: 0.4, speed: 0.3, speedRand: 0.2, size: 0.18, sizeRand: 0.06, sizeEnd: 0.1,
      colorA: '#c58bff', colorB: '#7fd9ff', gravity: -0.8, swirl: 2, turbulence: 1, shape: 'sphere', radius: 0.6,
      edgeOnly: true, look: 'star', additive: true, spin: 90, spinRand: 60
    },
    dust: {
      rate: 0, burstCount: 14, burstEvery: 0, life: 0.8, lifeRand: 0.3, speed: 1.2, speedRand: 0.5, size: 0.35,
      sizeRand: 0.1, sizeEnd: 2, colorA: '#cdbba0', colorB: '#a89880', alpha: 0.5, gravity: -0.3, drag: 3,
      shape: 'hemisphere', radius: 0.2, look: 'soft glow'
    },
    confetti: {
      rate: 0, burstCount: 60, burstEvery: 0, life: 3, lifeRand: 0.6, speed: 7, speedRand: 3, size: 0.12,
      sizeRand: 0.04, sizeEnd: 1, colorA: '#ff4d8d', colorB: '#ffd84a', alpha: 1, alphaEnd: 1, gravity: 9, drag: 1,
      shape: 'cone', angle: 60, radius: 0.1, look: 'square', spin: 400, spinRand: 300, floor: 'stop'
    },
    bubbles: {
      rate: 8, life: 4, lifeRand: 1, speed: 0.6, speedRand: 0.3, size: 0.22, sizeRand: 0.1, sizeEnd: 1.3,
      colorA: '#bfefff', colorB: '#ffffff', alpha: 0.7, gravity: -1, turbulence: 1.5, shape: 'sphere', radius: 0.5,
      look: 'ring'
    },
    fireflies: {
      rate: 6, life: 5, lifeRand: 1.5, speed: 0.3, speedRand: 0.2, size: 0.12, sizeRand: 0.04, sizeEnd: 0.5,
      colorA: '#e8ff6a', colorB: '#9dff7a', turbulence: 2.5, shape: 'box', radius: 4, height: 2, angle: 180,
      look: 'soft glow', additive: true
    },
    embers: {
      rate: 15, life: 2.5, lifeRand: 0.8, speed: 1, speedRand: 0.6, size: 0.07, sizeRand: 0.03, sizeEnd: 0.2,
      colorA: '#ffb347', colorB: '#ff6a2a', gravity: -3, turbulence: 3, shape: 'cone', angle: 30, radius: 0.3,
      look: 'circle', additive: true
    }
  };

  // number settings: key -> [min, max, isPercent]
  const NUM_SETTINGS = {
    rate: [0, 3000],
    burstCount: [0, 3000],
    burstEvery: [0, 3600],
    max: [1, 5000],
    life: [0.02, 600],
    lifeRand: [0, 600],
    speed: [-1000, 1000],
    speedRand: [0, 1000],
    size: [0.001, 100],
    sizeRand: [0, 100],
    sizeEnd: [0, 100],
    alpha: [0, 1, true],
    alphaEnd: [0, 1, true],
    gravity: [-1000, 1000],
    drag: [0, 100],
    windX: [-1000, 1000],
    windY: [-1000, 1000],
    windZ: [-1000, 1000],
    turbulence: [0, 1000],
    swirl: [-1000, 1000],
    spin: [-100000, 100000],
    spinRand: [0, 100000],
    angle: [0, 180],
    radius: [0, 1000],
    height: [0, 1000],
    bounce: [0, 1, true],
    floorY: [-100000, 100000],
    duration: [0, 100000],
    timeScale: [0, 10]
  };
  const MESH_KEYS = new Set(['max', 'alpha', 'alphaEnd']);

  const emitterTmp = {};
  const ensureTmp = () => {
    if (emitterTmp.ready) return;
    emitterTmp.ready = true;
    emitterTmp.p = new THREE.Vector3();
    emitterTmp.d = new THREE.Vector3();
    emitterTmp.m = new THREE.Matrix4();
    emitterTmp.q = new THREE.Quaternion();
    emitterTmp.qr = new THREE.Quaternion();
    emitterTmp.e = new THREE.Euler();
    emitterTmp.s = new THREE.Vector3();
    emitterTmp.c = new THREE.Color();
    emitterTmp.c2 = new THREE.Color();
    emitterTmp.up = new THREE.Vector3(0, 1, 0);
    emitterTmp.z = new THREE.Vector3(0, 0, 1);
    emitterTmp.a = new THREE.Vector3();
  };

  const hexColor = (hex) => new THREE.Color().setRGB(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
    THREE.SRGBColorSpace
  );

  const newEmitter = (name, presetName) => {
    const e = {
      name,
      playing: true, emitting: true, looping: true, duration: 0, time: 0, clock: 0, timeScale: 1,
      rate: 20, acc: 0, burstCount: 0, burstEvery: 0, burstPending: false, burstTimer: 0,
      max: 500,
      life: 1.5, lifeRand: 0.3, speed: 3, speedRand: 1,
      size: 0.2, sizeRand: 0.05, sizeEnd: 1, alpha: 1, alphaEnd: 0,
      colorA: new THREE.Color(1, 1, 1), colorB: new THREE.Color(1, 1, 1), colorEnd: new THREE.Color(1, 1, 1),
      useEnd: false, palette: null,
      gravity: 0, drag: 0, windX: 0, windY: 0, windZ: 0, turbulence: 0, swirl: 0, spin: 0, spinRand: 0,
      shape: 'cone', angle: 25, radius: 0.2, height: 0, edgeOnly: false,
      dirX: 0, dirY: 1, dirZ: 0, q: new THREE.Quaternion(),
      space: 'world', follow: null, offset: new THREE.Vector3(), pos: new THREE.Vector3(),
      floor: 'none', bounce: 0.5, floorY: null,
      look: 'soft glow', additive: false, lit: false, texture: null, autoDelete: false,
      mesh: null, geo: null, alphaAttr: null, data: null, n: 0, dirty: true
    };
    const preset = PRESETS[presetName] || {};
    Object.keys(preset).forEach((k) => {
      const v = preset[k];
      if (k === 'colorA' || k === 'colorB' || k === 'colorEnd') e[k] = hexColor(v);
      else e[k] = v;
    });
    e.data = new Float32Array(e.max * STRIDE);
    ensureTmp();
    applyEmitterDir(e);
    e.burstPending = e.burstCount > 0;
    return e;
  };

  const applyEmitterDir = (e) => {
    const l = Math.hypot(e.dirX, e.dirY, e.dirZ);
    if (l < 1e-6) {
      e.dirX = 0;
      e.dirY = 1;
      e.dirZ = 0;
    } else {
      e.dirX /= l;
      e.dirY /= l;
      e.dirZ /= l;
    }
    emitterTmp.d.set(e.dirX, e.dirY, e.dirZ);
    e.q.setFromUnitVectors(emitterTmp.up, emitterTmp.d);
  };

  const particleTexCache = new Map();
  const particleLookTex = (look) => {
    let t = particleTexCache.get(look);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    if (look === 'soft glow') {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    } else if (look === 'circle') {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.8, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    } else if (look === 'ring') {
      g.strokeStyle = 'white';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(32, 32, 24, 0, TAU);
      g.stroke();
    } else if (look === 'star') {
      g.fillStyle = 'white';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 30 : 12;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    } else if (look === 'spark') {
      g.fillStyle = 'white';
      g.beginPath();
      g.moveTo(32, 2);
      g.lineTo(38, 26);
      g.lineTo(62, 32);
      g.lineTo(38, 38);
      g.lineTo(32, 62);
      g.lineTo(26, 38);
      g.lineTo(2, 32);
      g.lineTo(26, 26);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = 'white';
      g.fillRect(8, 8, 48, 48);
    }
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    particleTexCache.set(look, t);
    return t;
  };

  const buildEmitterMesh = (e) => {
    e.dirty = false;
    ensureTmp();
    if (e.mesh) {
      scene.remove(e.mesh);
      e.mesh.dispose();
      e.mesh.material.dispose();
      e.geo.dispose();
      e.mesh = null;
    }
    if (e.data.length !== e.max * STRIDE) {
      const nd = new Float32Array(e.max * STRIDE);
      nd.set(e.data.subarray(0, Math.min(e.data.length, nd.length)));
      e.data = nd;
      e.n = Math.min(e.n, e.max);
    }
    if (!particleGeos.quad) particleGeos.quad = new THREE.PlaneGeometry(1, 1);
    const is3D = LOOKS_3D.includes(e.look);
    const base = e.look === 'sphere' ? particleGeos.sphere : is3D ? particleGeos.cube : particleGeos.quad;
    e.geo = base.clone();
    e.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(e.max).fill(1), 1);
    e.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    e.geo.setAttribute('instAlpha', e.alphaAttr);
    const transparent = !is3D || e.additive || e.alpha < 1 || e.alphaEnd < 1;
    const mat = e.lit
      ? new THREE.MeshStandardMaterial({ roughness: 0.8 })
      : new THREE.MeshBasicMaterial();
    mat.transparent = transparent;
    mat.depthWrite = !transparent;
    mat.side = is3D ? THREE.FrontSide : THREE.DoubleSide;
    mat.blending = e.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    mat.map = e.texture || (is3D ? null : particleLookTex(e.look));
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instAlpha;\nvarying float vInstAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstAlpha = instAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstAlpha;');
    };
    mat.customProgramCacheKey = () => 'turbo-particle-alpha';
    const mesh = new THREE.InstancedMesh(e.geo, mat, e.max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, emitterTmp.c.setRGB(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = shadowsOn && e.lit && is3D;
    mesh.renderOrder = e.additive ? 2 : 1;
    mesh.count = e.n;
    scene.add(mesh);
    e.mesh = mesh;
  };

  const killEmitter = (name) => {
    const e = emitters.get(name);
    if (!e) return;
    if (e.mesh) {
      scene.remove(e.mesh);
      e.mesh.dispose();
      e.mesh.material.dispose();
      e.geo.dispose();
    }
    emitters.delete(name);
  };

  const clearEmitters = () => {
    Array.from(emitters.keys()).forEach(killEmitter);
  };

  const totalEmitterParticles = () => {
    let t = 0;
    emitters.forEach((e) => (t += e.n));
    return t;
  };

  // where the emitter is right now (follows an object or the player if attached)
  const updateEmitterOrigin = (e) => {
    const T = emitterTmp;
    if (e.follow) {
      if (str(e.follow).trim().toLowerCase() === 'player') {
        playerFeet(T.p);
        e.pos.copy(T.p).add(e.offset);
      } else {
        const o = objects.get(e.follow);
        if (o) {
          o.getWorldPosition(T.p);
          e.pos.copy(T.p).add(e.offset);
        }
      }
    }
  };

  const sampleShape = (e, outP, outD) => {
    const rnd = Math.random;
    switch (e.shape) {
      case 'sphere':
      case 'hemisphere':
      case 'point': {
        let x, y, z, l2;
        do {
          x = rnd() * 2 - 1;
          y = rnd() * 2 - 1;
          z = rnd() * 2 - 1;
          l2 = x * x + y * y + z * z;
        } while (l2 > 1 || l2 < 1e-4);
        const l = Math.sqrt(l2);
        x /= l;
        y /= l;
        z /= l;
        if (e.shape === 'hemisphere' && y < 0) y = -y;
        const r = e.shape === 'point' ? 0 : e.edgeOnly ? e.radius : e.radius * Math.cbrt(rnd());
        outP.set(x * r, y * r, z * r);
        outD.set(x, y, z);
        break;
      }
      case 'circle': {
        const t = rnd() * TAU;
        const r = e.edgeOnly ? e.radius : e.radius * Math.sqrt(rnd());
        outP.set(Math.cos(t) * r, 0, Math.sin(t) * r);
        outD.set(Math.cos(t), 0, Math.sin(t));
        break;
      }
      default: {
        // cone, box, edge: a position on the base and a direction spread around the axis
        const t = rnd() * TAU;
        const a = rad(e.angle) * Math.sqrt(rnd());
        if (e.shape === 'box') {
          outP.set((rnd() * 2 - 1) * e.radius, (rnd() - 0.5) * e.height, (rnd() * 2 - 1) * e.radius);
        } else if (e.shape === 'edge') {
          outP.set((rnd() * 2 - 1) * e.radius, 0, 0);
        } else {
          const r = e.edgeOnly ? e.radius : e.radius * Math.sqrt(rnd());
          outP.set(Math.cos(t) * r, 0, Math.sin(t) * r);
        }
        outD.set(Math.sin(a) * Math.cos(t), Math.cos(a), Math.sin(a) * Math.sin(t));
      }
    }
    outP.applyQuaternion(e.q);
    outD.applyQuaternion(e.q);
  };

  const emitOne = (e) => {
    if (e.n >= e.max || totalEmitterParticles() >= EMITTER_LIMIT) return false;
    const T = emitterTmp;
    const rnd = Math.random;
    const o = e.n * STRIDE;
    const a = e.data;
    sampleShape(e, T.p, T.d);
    if (e.space === 'world') T.p.add(e.pos);
    const speed = Math.max(0, e.speed + (rnd() * 2 - 1) * e.speedRand);
    a[o] = T.p.x;
    a[o + 1] = T.p.y;
    a[o + 2] = T.p.z;
    a[o + 3] = T.d.x * speed;
    a[o + 4] = T.d.y * speed;
    a[o + 5] = T.d.z * speed;
    a[o + 6] = 0;
    a[o + 7] = Math.max(0.05, e.life + (rnd() * 2 - 1) * e.lifeRand);
    a[o + 8] = Math.max(0.005, e.size + (rnd() * 2 - 1) * e.sizeRand);
    a[o + 9] = rnd() * TAU;
    a[o + 10] = rnd() * TAU;
    const spin = rad(e.spin + (rnd() * 2 - 1) * e.spinRand);
    a[o + 11] = spin;
    a[o + 12] = spin * (rnd() * 2 - 1);
    if (e.palette && e.palette.length) T.c.copy(e.palette[Math.floor(rnd() * e.palette.length)]);
    else T.c.copy(e.colorA).lerp(e.colorB, rnd());
    a[o + 13] = T.c.r;
    a[o + 14] = T.c.g;
    a[o + 15] = T.c.b;
    a[o + 16] = rnd() * 100;
    e.n++;
    return true;
  };

  const startEmitter = (e) => {
    e.playing = true;
    e.emitting = true;
    e.time = 0;
    e.acc = 0;
    e.burstPending = e.burstCount > 0;
    e.burstTimer = 0;
  };

  const simulateEmitter = (e, dt) => {
    const T = emitterTmp;
    const a = e.data;
    const local = e.space === 'local';
    const ground = local || e.floor === 'none'
      ? -Infinity
      : e.floorY !== null ? e.floorY : player.floorOn ? player.floorY : -Infinity;
    const is3D = LOOKS_3D.includes(e.look);
    const cx = local ? 0 : e.pos.x;
    const cz = local ? 0 : e.pos.z;
    const camQ = camera.quaternion;
    const col = e.mesh.instanceColor.array;
    const alphaArr = e.alphaAttr.array;
    e.clock += dt;
    let i = 0;
    while (i < e.n) {
      const o = i * STRIDE;
      const age = (a[o + 6] += dt);
      const life = a[o + 7];
      if (age >= life) {
        const last = (e.n - 1) * STRIDE;
        if (o !== last) a.copyWithin(o, last, last + STRIDE);
        e.n--;
        continue;
      }
      let vx = a[o + 3];
      let vy = a[o + 4];
      let vz = a[o + 5];
      let px = a[o];
      let py = a[o + 1];
      let pz = a[o + 2];
      vy -= e.gravity * dt;
      if (e.windX || e.windY || e.windZ) {
        vx += e.windX * dt;
        vy += e.windY * dt;
        vz += e.windZ * dt;
      }
      if (e.drag > 0) {
        const k = Math.max(0, 1 - e.drag * dt);
        vx *= k;
        vy *= k;
        vz *= k;
      }
      if (e.turbulence > 0) {
        const ph = a[o + 16];
        const tt = e.clock;
        vx += Math.sin(py * 1.7 + tt * 1.3 + ph) * e.turbulence * dt;
        vy += Math.sin(pz * 1.9 + tt * 1.1 + ph * 1.7) * e.turbulence * dt;
        vz += Math.sin(px * 1.5 + tt * 1.7 + ph * 0.7) * e.turbulence * dt;
      }
      if (e.swirl !== 0) {
        const dx = px - cx;
        const dz = pz - cz;
        const d = Math.hypot(dx, dz);
        if (d > 0.001) {
          vx += (-dz / d) * e.swirl * dt;
          vz += (dx / d) * e.swirl * dt;
        }
      }
      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;
      const t = age / life;
      const size = a[o + 8] * (1 + (e.sizeEnd - 1) * t);
      if (ground > -Infinity) {
        const half = is3D ? size * 0.5 : 0;
        if (py < ground + half) {
          if (e.floor === 'die') {
            a[o + 6] = life;
            py = ground + half;
          } else {
            py = ground + half;
            if (e.floor === 'bounce' && Math.abs(vy) > 0.4) {
              vy = -vy * e.bounce;
              vx *= 0.8;
              vz *= 0.8;
            } else {
              vx = 0;
              vy = 0;
              vz = 0;
              a[o + 11] = 0;
              a[o + 12] = 0;
            }
          }
        }
      }
      a[o] = px;
      a[o + 1] = py;
      a[o + 2] = pz;
      a[o + 3] = vx;
      a[o + 4] = vy;
      a[o + 5] = vz;
      a[o + 9] += a[o + 11] * dt;
      a[o + 10] += a[o + 12] * dt;
      T.p.set(px, py, pz);
      if (is3D) T.q.setFromEuler(T.e.set(a[o + 10], a[o + 9], 0));
      else {
        T.qr.setFromAxisAngle(T.z, a[o + 9]);
        T.q.copy(camQ).multiply(T.qr);
      }
      T.s.set(size, size, size);
      T.m.compose(T.p, T.q, T.s);
      e.mesh.setMatrixAt(i, T.m);
      if (e.useEnd) {
        T.c.setRGB(a[o + 13], a[o + 14], a[o + 15]).lerp(e.colorEnd, t);
        col[i * 3] = T.c.r;
        col[i * 3 + 1] = T.c.g;
        col[i * 3 + 2] = T.c.b;
      } else {
        col[i * 3] = a[o + 13];
        col[i * 3 + 1] = a[o + 14];
        col[i * 3 + 2] = a[o + 15];
      }
      alphaArr[i] = e.alpha + (e.alphaEnd - e.alpha) * t;
      i++;
    }
    e.mesh.count = e.n;
    e.mesh.instanceMatrix.needsUpdate = true;
    e.mesh.instanceColor.needsUpdate = true;
    e.alphaAttr.needsUpdate = true;
  };

  const updateEmitters = (dt) => {
    if (!emitters.size) return;
    for (const [name, e] of Array.from(emitters)) {
      if (e.dirty) buildEmitterMesh(e);
      updateEmitterOrigin(e);
      e.mesh.position.set(e.space === 'local' ? e.pos.x : 0, e.space === 'local' ? e.pos.y : 0, e.space === 'local' ? e.pos.z : 0);
      const sdt = dt * e.timeScale;
      if (e.playing && sdt > 0) {
        if (e.emitting) {
          e.time += sdt;
          if (e.duration > 0 && e.time >= e.duration) {
            if (e.looping) {
              e.time %= e.duration;
              e.burstPending = e.burstCount > 0;
              e.burstTimer = 0;
            } else e.emitting = false;
          }
        }
        if (e.emitting) {
          if (e.rate > 0) {
            e.acc = Math.min(e.acc + e.rate * sdt, e.max);
            while (e.acc >= 1) {
              e.acc -= 1;
              if (!emitOne(e)) {
                e.acc = 0;
                break;
              }
            }
          }
          if (e.burstCount > 0 && (e.burstPending || e.burstEvery > 0)) {
            e.burstTimer -= sdt;
            if (e.burstTimer <= 0) {
              for (let k = 0; k < e.burstCount; k++) if (!emitOne(e)) break;
              e.burstPending = false;
              e.burstTimer = e.burstEvery > 0 ? Math.max(0.02, e.burstEvery) : 0;
            }
          }
        }
        simulateEmitter(e, sdt);
        const active = e.emitting && (e.rate > 0 || (e.burstCount > 0 && (e.burstPending || e.burstEvery > 0)));
        if (e.autoDelete && !active && e.n === 0) killEmitter(name);
      }
    }
  };

  const emitterBurst = (e, count) => {
    if (e.dirty) buildEmitterMesh(e);
    updateEmitterOrigin(e);
    count = Math.max(0, Math.min(5000, Math.floor(count) || 0));
    for (let k = 0; k < count; k++) if (!emitOne(e)) break;
    simulateEmitter(e, 0);
  };

  const uniqueEmitterName = (base) => {
    let n;
    do {
      n = base + '#' + ++autoId;
    } while (emitters.has(n));
    return n;
  };

  // a quick one-off effect that cleans itself up
  const playEffect = (preset, x, y, z, seconds, palette, box) => {
    const e = newEmitter(uniqueEmitterName('effect'), str(preset));
    e.pos.set(x, y, z);
    e.autoDelete = true;
    e.looping = false;
    e.burstEvery = 0;
    const continuous = e.rate > 0;
    if (continuous) e.duration = Math.max(0.1, seconds > 0 ? seconds : 3);
    if (palette) e.palette = palette;
    if (box) {
      e.shape = 'box';
      e.radius = box.radius;
      e.height = box.height;
      e.angle = Math.max(e.angle, 45);
    }
    emitters.set(e.name, e);
    buildEmitterMesh(e);
    startEmitter(e);
    return e;
  };

  // ===== texture sources (imported images, links, or the built-in block textures) =====

  const camPrev = { x: 0, y: 0, z: 0 };
  let eachCur = '';
  let eachIdx = 0;
  let defaultTextureSrc = null;

  const resolveTextureSource = async (src) => {
    const s = str(src).trim();
    if (!s || s === 'none') return null;
    const a = readAssets()[s];
    if (a && a.type === 'image') return loadTexture('asset:' + s, a.data);
    if (/^(https?:|data:)/i.test(s)) {
      if (!(await Scratch.canFetch(s))) return null;
      return loadTexture(s, s);
    }
    return null;
  };

  const applyDefaultTexture = async (obj) => {
    if (!defaultTextureSrc || !obj) return;
    try {
      const base = await resolveTextureSource(defaultTextureSrc);
      if (base) applyTexture(materialsOf(obj), base);
    } catch (e) {
      console.warn('3D Turbo could not apply the default texture', e);
    }
  };

  const aggregate = (agg, values) => {
    if (!values.length) return 0;
    switch (agg) {
      case 'sum': return values.reduce((a, b) => a + b, 0);
      case 'min': return Math.min(...values);
      case 'max': return Math.max(...values);
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  // colors an object is made of (samples the texture so broken blocks look like the block)
  const sampleColors = (obj, n) => {
    touchColor(obj);
    const out = [];
    const mats = materialsOf(obj);
    const per = Math.max(2, Math.ceil(n / Math.max(1, mats.length)));
    if (!sampleCanvas) {
      sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 32;
      sampleCanvas.height = 32;
    }
    mats.forEach((m) => {
      let got = false;
      const img = m.map && m.map.image;
      if (img && (img.naturalWidth || img.width)) {
        try {
          const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
          ctx.clearRect(0, 0, 32, 32);
          ctx.drawImage(img, 0, 0, 32, 32);
          const d = ctx.getImageData(0, 0, 32, 32).data;
          for (let i = 0; i < per; i++) {
            const px = Math.floor(Math.random() * 1024) * 4;
            if (d[px + 3] > 10) {
              out.push(new THREE.Color().setRGB(d[px] / 255, d[px + 1] / 255, d[px + 2] / 255, THREE.SRGBColorSpace));
              got = true;
            }
          }
        } catch (e) {
          got = false;
        }
      }
      if (!got && m.color) out.push(m.color.clone());
    });
    return out.length ? out : [new THREE.Color(0xffffff)];
  };

  // UI layer: normal sprites drawn in front of the 3D view

  const clearUI = () => {
    uiItems.forEach((item) => item.img && item.img.remove());
    uiItems.clear();
    uiOptOut.clear();
  };

  // every sprite is shown on top of the 3D world by default
  const syncUiSprites = () => {
    const rt = Scratch.vm.runtime;
    for (const t of rt.targets) {
      if (t.isStage) continue;
      if (!uiItems.has(t.id) && !uiOptOut.has(t.id)) uiItems.set(t.id, { img: null, key: '' });
    }
  };

  const updateUI = () => {
    if (!uiLayer) return;
    syncUiSprites();
    if (!uiItems.size) return;
    const rt = Scratch.vm.runtime;
    const stage = stageCanvas();
    const sw = rt.stageWidth || 480;
    const sh = rt.stageHeight || 360;
    const k = stage.clientWidth / sw;
    for (const [id, item] of Array.from(uiItems)) {
      const t = rt.getTargetById(id);
      if (!t) {
        if (item.img) item.img.remove();
        uiItems.delete(id);
        continue;
      }
      if (!item.img) {
        const img = document.createElement('img');
        img.draggable = false;
        Object.assign(img.style, {
          position: 'absolute',
          pointerEvents: 'none',
          userSelect: 'none',
          maxWidth: 'none',
          maxHeight: 'none',
          display: 'none'
        });
        uiLayer.appendChild(img);
        item.img = img;
      }
      const img = item.img;
      const costume = t.getCurrentCostume();
      if (!t.visible || !costume || !costume.asset) {
        img.style.display = 'none';
        continue;
      }
      if (item.key !== costume.assetId) {
        item.key = costume.assetId;
        img.src = costume.asset.encodeDataURI();
        img.style.imageRendering = costume.dataFormat === 'svg' ? 'auto' : 'pixelated';
      }
      let size = null;
      try {
        size = rt.renderer.getCurrentSkinSize(t.drawableID);
      } catch (e) {
        size = null;
      }
      const res = costume.bitmapResolution || 1;
      if (!size || !size[0]) size = [(img.naturalWidth || 1) / res, (img.naturalHeight || 1) / res];
      const scale = (t.size / 100) * k;
      const cx = (costume.rotationCenterX || 0) / res;
      const cy = (costume.rotationCenterY || 0) / res;
      const px = (sw / 2 + t.x) * k;
      const py = (sh / 2 - t.y) * k;
      const s = img.style;
      s.display = 'block';
      s.width = size[0] * scale + 'px';
      s.height = size[1] * scale + 'px';
      s.left = px - cx * scale + 'px';
      s.top = py - cy * scale + 'px';
      s.transformOrigin = cx * scale + 'px ' + cy * scale + 'px';
      let tf = '';
      if (t.rotationStyle === 'all around') tf = 'rotate(' + (t.direction - 90) + 'deg)';
      else if (t.rotationStyle === 'left-right' && t.direction < 0) tf = 'scaleX(-1)';
      s.transform = tf;
      const ghost = (t.effects && t.effects.ghost) || 0;
      s.opacity = String(Math.max(0, Math.min(1, 1 - ghost / 100)));
      s.zIndex = String(t.getLayerOrder ? t.getLayerOrder() : 0);
    }
  };

  // is the mouse on top of a UI sprite? (so clicking it never grabs the mouse or hits the world)
  const overUI = (e) => {
    if (!uiItems.size || document.pointerLockElement) return false;
    try {
      const rt = Scratch.vm.runtime;
      const rect = stageCanvas().getBoundingClientRect();
      const id = rt.renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
      if (id < 0) return false;
      for (const tid of uiItems.keys()) {
        const t = rt.getTargetById(tid);
        if (t && t.drawableID === id) return true;
      }
    } catch (err) {
      return false;
    }
    return false;
  };

  // editor toolbar (only visible in editor mode)

  const setText = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };

  const refreshToolbar = () => {
    if (!toolbar || !tc) return;
    ['translate', 'rotate', 'scale'].forEach((m) => {
      toolbarButtons[m].style.background = tc.mode === m ? '#e85aa0' : '#444';
    });
    setText(toolbarButtons.space, tc.space === 'world' ? 'World axes' : 'Local axes');
    setText(toolbarButtons.snap, snapLock ? 'Snap: on' : 'Snap: hold Shift');
    toolbarButtons.snap.style.background = snapLock ? '#e85aa0' : '#444';
    setText(toolbarInfo, selected ? selected.userData.name : 'click an object to select it');
    if (selected !== toolbarSel) {
      // show the selected object's current roughness / metalness on the sliders
      toolbarSel = selected;
      const mat = selected ? materialsOf(selected).find((m) => m.roughness !== undefined) : null;
      toolbarSliders.rough.disabled = !mat;
      toolbarSliders.metal.disabled = !mat;
      if (mat) {
        toolbarSliders.rough.value = String(Math.round(mat.roughness * 100));
        toolbarSliders.metal.value = String(Math.round(mat.metalness * 100));
      }
    }
  };

  const copySelected = () => {
    if (!selected) return;
    const r = (v) => Math.round(v * 1000) / 1000;
    const p = selected.position;
    const o = selected.rotation;
    const s = selected.scale;
    const text =
      selected.userData.name +
      ': position ' + r(p.x) + ' ' + r(p.y) + ' ' + r(p.z) +
      ' | rotation ' + r(deg(o.x)) + ' ' + r(deg(o.y)) + ' ' + r(deg(o.z)) +
      ' | size ' + r(s.x) + ' ' + r(s.y) + ' ' + r(s.z);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => window.prompt('Copy this:', text));
    } else {
      window.prompt('Copy this:', text);
    }
  };

  const buildToolbar = () => {
    toolbar = document.createElement('div');
    Object.assign(toolbar.style, {
      position: 'absolute',
      left: '6px',
      top: '6px',
      display: 'none',
      flexWrap: 'wrap',
      gap: '4px',
      alignItems: 'center',
      padding: '4px',
      background: 'rgba(20,20,30,0.78)',
      borderRadius: '6px',
      font: '12px sans-serif',
      color: '#fff',
      zIndex: '10',
      pointerEvents: 'auto',
      userSelect: 'none',
      maxWidth: '95%'
    });
    ['pointerdown', 'mousedown', 'mouseup', 'click', 'contextmenu'].forEach((t) =>
      toolbar.addEventListener(t, (e) => e.stopPropagation())
    );
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        border: '0',
        borderRadius: '4px',
        padding: '3px 7px',
        color: '#fff',
        background: '#444',
        font: '12px sans-serif',
        cursor: 'pointer'
      });
      b.addEventListener('click', () => {
        fn();
        refreshToolbar();
      });
      toolbar.appendChild(b);
      return b;
    };
    toolbarButtons.translate = mk('Move (1)', () => tc.setMode('translate'));
    toolbarButtons.rotate = mk('Rotate (2)', () => tc.setMode('rotate'));
    toolbarButtons.scale = mk('Size (3)', () => tc.setMode('scale'));
    toolbarButtons.space = mk('World axes', () => tc.setSpace(tc.space === 'world' ? 'local' : 'world'));
    toolbarButtons.snap = mk('Snap: hold Shift', () => {
      snapLock = !snapLock;
    });
    mk('Copy values', copySelected);
    const mkSlider = (label) => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:3px';
      wrap.appendChild(document.createTextNode(label));
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.style.width = '70px';
      wrap.appendChild(input);
      toolbar.appendChild(wrap);
      return input;
    };
    toolbarSliders.rough = mkSlider('Rough');
    toolbarSliders.metal = mkSlider('Metal');
    const onSlide = () => {
      if (!selected) return;
      const r = Number(toolbarSliders.rough.value) / 100;
      const m = Number(toolbarSliders.metal.value) / 100;
      materialsOf(selected).forEach((mat) => applySurface(mat, r, m));
    };
    toolbarSliders.rough.addEventListener('input', onSlide);
    toolbarSliders.metal.addEventListener('input', onSlide);
    toolbarInfo = document.createElement('span');
    toolbarInfo.style.opacity = '0.85';
    toolbarInfo.style.padding = '0 4px';
    toolbar.appendChild(toolbarInfo);
  };

  const disposeObject = (obj) => {
    obj.traverse((child) => {
      if (child.geometry && !(child.geometry.userData && child.geometry.userData.shared)) child.geometry.dispose();
    });
    materialsOf(obj).forEach((m) => {
      if (m.userData && m.userData.shared) return;
      if (m.map && !(m.map.userData && m.map.userData.shared)) m.map.dispose();
      m.dispose();
    });
  };

  const applyShadowFlags = (obj) => {
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = shadowsOn && !obj.userData.noCast;
        child.receiveShadow = shadowsOn && !obj.userData.noReceive;
      }
    });
  };

  const removeObject = (name) => {
    const obj = objects.get(name);
    if (!obj) return;
    // children go with their parent
    childObjects(obj).forEach((c) => removeObject(c.userData.name));
    if (selected === obj) deselect();
    if (hoverObj === obj) clearHover();
    leaveGroup(obj);
    if (obj.parent) obj.parent.remove(obj);
    if (scene.userData.waters) scene.userData.waters.delete(obj);
    removeShaderQuiet(obj);
    disposeObject(obj);
    objects.delete(name);
    if (obj.userData.id && idIndex.get(obj.userData.id) === obj) idIndex.delete(obj.userData.id);
    mixers.delete(name);
    fireEvent('object destroyed', name);
  };

  const addObject = (name, obj) => {
    removeObject(name);
    obj.userData.name = name;
    obj.userData.group = null;
    if (obj.isLight) obj.userData.light = true;
    registerNewObject(obj);
    applyShadowFlags(obj);
    scene.add(obj);
    objects.set(name, obj);
    registerClonedChildren(obj, name);
    fireEvent('object created', name);
  };

  const updateCamera = () => {
    camPitch = Math.max(-89, Math.min(89, camPitch));
    camera.rotation.set(rad(camPitch), rad(camYaw), rad(fx.roll));
  };

  const buildWorld = () => {
    removeSkyDome();
    day.on = false;
    tweenClear();
    clearHover();
    clearParticles();
    clearEmitters();
    lastCreated = '';
    for (const name of Array.from(objects.keys())) removeObject(name);
    if (ambient) scene.remove(ambient);
    if (sun) scene.remove(sun);
    ambient = new THREE.AmbientLight(0xeaf0f5, 1.1);
    sun = new THREE.DirectionalLight(0xfff0dc, 1.15);
    sun.position.set(3, 6, 4);
    sun.castShadow = shadowsOn;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    const sc = sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 0.5;
    sc.far = 200;
    scene.add(ambient);
    scene.add(sun);
    scene.background = new THREE.Color().setRGB(1, 0.89, 0.95, THREE.SRGBColorSpace);
    scene.fog = null;
    camera.position.set(0, 1.6, 5);
    camera.fov = 70;
    camera.far = 1000;
    camera.updateProjectionMatrix();
    camYaw = 0;
    camPitch = 0;
    updateCamera();
    player.mode = 'off';
    exitEditor();
  };

  // raycasting

  const solidTargets = () => {
    const list = [];
    for (const o of objects.values()) {
      if (o.isLight || !o.visible || o.userData.solid === false) continue;
      list.push(o);
    }
    return list;
  };

  const castRay = (origin, dir, far) => {
    raycaster.set(origin, dir);
    raycaster.far = far;
    raycaster.near = 0;
    const hits = raycaster.intersectObjects(solidTargets(), true);
    return hits.length ? hits[0] : null;
  };

  const pickAt = (px, py, far) => {
    raycaster.setFromCamera(new THREE.Vector2(px, py), camera);
    raycaster.far = far;
    raycaster.near = 0;
    const hits = raycaster.intersectObjects(Array.from(objects.values()), true);
    for (const h of hits) {
      let top = h.object;
      let visible = top.visible;
      while (top.parent && top.parent !== scene && !(top.userData.name !== undefined && objects.get(top.userData.name) === top)) {
        top = top.parent;
        if (!top.visible) visible = false;
      }
      for (let n = top.parent; n && n !== scene; n = n.parent) if (!n.visible) visible = false;
      if (visible && top.userData.name !== undefined) {
        const normal = h.face
          ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
          : new THREE.Vector3();
        return { name: top.userData.name, object: top, point: h.point, distance: h.distance, normal };
      }
    }
    return null;
  };

  const lookHit = (far) => (isReady ? pickAt(0, 0, far === undefined ? reach : far) : null);

  const isPlayerName = (name) => str(name).trim().toLowerCase() === 'player';

  // 'player' means the player's eyes (the camera) anywhere a name is asked for
  const posOf = (name) => {
    const o = objects.get(str(name)) || idIndex.get(str(name));
    if (o) return o.parent === scene ? o.position : o.getWorldPosition(new THREE.Vector3());
    return isPlayerName(name) ? camera.position : null;
  };

  const boxOf = (name) => {
    const o = objects.get(str(name));
    if (o) return new THREE.Box3().setFromObject(o);
    return isPlayerName(name) ? playerBox() : null;
  };

  // editor (gizmo) helpers

  const selectObject = (obj) => {
    selected = obj;
    if (!tc) return;
    if (obj) tc.attach(obj);
    else tc.detach();
  };

  const deselect = () => selectObject(null);

  const enterEditor = () => {
    if (!tc) return;
    if (toolbar) toolbar.style.display = 'flex';
    tc.enabled = true;
    canvas.style.pointerEvents = 'auto';
    mouseLook = false;
    if (document.pointerLockElement) document.exitPointerLock();
  };

  const exitEditor = () => {
    if (toolbar) toolbar.style.display = 'none';
    if (!tc) return;
    deselect();
    tc.enabled = false;
    canvas.style.pointerEvents = 'none';
    rightDown = false;
  };

  // touching helpers

  const playerBox = () => {
    const r = player.radius;
    const base = player.mode === 'fp' ? player.pos : camera.position;
    const feet = player.mode === 'fp' ? base.y : base.y - player.eye;
    const eyeH = player.mode === 'fp' ? player.eyeNow : player.eye;
    return new THREE.Box3(
      new THREE.Vector3(base.x - r, feet, base.z - r),
      new THREE.Vector3(base.x + r, feet + eyeH + 0.1, base.z + r)
    );
  };

  const touchingList = (name) => {
    const obj = objects.get(name);
    if (!obj) return [];
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return [];
    const names = [];
    for (const [n, o] of objects) {
      if (o === obj || o.isLight || !o.visible) continue;
      const other = new THREE.Box3().setFromObject(o);
      if (!other.isEmpty() && box.intersectsBox(other)) names.push(n);
    }
    return names;
  };

  // movement helpers

  const translateCam = (f, r, u) => {
    const yaw = rad(camYaw);
    const pitch = flyMode ? rad(camPitch) : 0;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const p = camera.position;
    p.x += fx * f + rx * r;
    p.y += fy * f + u;
    p.z += fz * f + rz * r;
  };

  // premade first person controller

  const stepFly = (dt) => {
    const p = player;
    const k = p.keys;
    let f = (keyDown(k.forward) ? 1 : 0) - (keyDown(k.back) ? 1 : 0);
    let r = (keyDown(k.right) ? 1 : 0) - (keyDown(k.left) ? 1 : 0);
    const len = Math.hypot(f, r);
    if (len > 0) {
      f /= len;
      r /= len;
    }
    const up = (keyDown(k.jump) ? 1 : 0) - (keyDown(k.down) ? 1 : 0);
    const speed = p.flySpeed * (keyDown(k.sprint) ? p.flySprint : 1) * dt;
    const yaw = rad(camYaw);
    const pitch = rad(camPitch);
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    camera.position.x += (fx * f + rx * r) * speed;
    camera.position.y += (fy * f + up) * speed;
    camera.position.z += (fz * f + rz * r) * speed;
  };

  // render loop

  const resizeToStage = () => {
    const stage = stageCanvas();
    if (!canvas.isConnected || canvas.parentElement !== stage.parentElement) attach();
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w && h && (w !== lastW || h !== lastH)) {
      lastW = w;
      lastH = h;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * quality);
      renderer.setSize(w, h, false);
      applyProjection();
    }
  };

  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    frames++;
    if (now - fpsTime >= 500) {
      fps = (frames * 1000) / (now - fpsTime);
      frames = 0;
      fpsTime = now;
    }
    if (!enabled) return;
    resizeToStage();
    const raw = Math.min(clock.getDelta(), 0.05);
    const frozen = isFrozen();
    const dt = frozen ? 0 : raw * TM.scale;
    TM.raw = raw;
    TM.dt = dt;
    TM.frames++;
    if (!frozen) TM.time += dt;
    removeCamFx();
    for (const m of mixers.values()) m.update(dt);
    camPrev.x = camera.position.x;
    camPrev.y = camera.position.y;
    camPrev.z = camera.position.z;
    if (!frozen) {
      if (player.mode === 'fp') stepPlayer(dt);
      else if (player.mode === 'fly') stepFly(dt);
      if (player.mode === 'fp' || rig.target) {
        if (rig.mode !== 'first' || rig.target || rig.body) stepRig(dt);
      }
      stepPhysics(dt);
      stepTweens(dt);
      stepTimers(dt);
      stepDay(dt);
      if (autosave.every > 0) {
        autosave.t += raw;
        if (autosave.t >= autosave.every) {
          autosave.t = 0;
          saveSlot(autosave.slot);
        }
      }
    }
    if (player.mode === 'editor') {
      stepFly(dt || raw);
      const snapOn = snapLock !== keyDown('shift');
      tc.setTranslationSnap(snapOn ? snap.move : null);
      tc.setRotationSnap(snapOn ? rad(snap.rotate) : null);
      tc.setScaleSnap(snapOn ? snap.scale : null);
      refreshToolbar();
    }
    if (dt > 0) {
      camVel.x = (camera.position.x - camPrev.x) / dt;
      camVel.y = (camera.position.y - camPrev.y) / dt;
      camVel.z = (camera.position.z - camPrev.z) / dt;
    }
    stepWater(TM.time);
    stepShaders(TM.time);
    updateHover();
    if (!frozen) {
      updateParticles(dt);
      updateEmitters(dt);
    }
    updateUI();
    if (crosshair) crosshair.style.display = crosshairOn && mouseLook ? 'block' : 'none';
    applyCamFx(frozen ? 0 : dt);
    updateSkyDome();
    updateAudio();
    updateDebug(raw);
    const t0 = performance.now();
    renderer.render(scene, camera);
    frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
    if (dbgEl || dbg.stats || dbg.info || dbg.names || dbgWatch.size) updateDebugOverlay();
  };

  const setupInput = () => {
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      accDX += e.movementX;
      accDY += e.movementY;
      if (mouseLook && isReady && !isFrozen()) {
        camYaw -= e.movementX * sensitivity;
        camPitch -= e.movementY * sensitivity;
        updateCamera();
      }
    });
    document.addEventListener(
      'mousedown',
      (e) => {
        if (!mouseLook || document.pointerLockElement) return;
        if (overUI(e)) return;
        const stage = stageCanvas();
        const parent = stage.parentElement;
        if (parent && parent.contains(e.target) && stage.requestPointerLock) {
          stage.requestPointerLock();
        }
      },
      true
    );
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      pressed.add(e.code);
      if (player.mode === 'editor' && tc) {
        if (e.code === 'Digit1') tc.setMode('translate');
        else if (e.code === 'Digit2') tc.setMode('rotate');
        else if (e.code === 'Digit3') tc.setMode('scale');
      }
    });
    window.addEventListener('keyup', (e) => pressed.delete(e.code));
    window.addEventListener('blur', () => {
      pressed.clear();
      mouseButtons.clear();
    });
    document.addEventListener(
      'mousedown',
      (e) => {
        mouseButtons.add(e.button);
        if (player.mode === 'editor') return;
        if (mouseLook && !document.pointerLockElement) return; // that click only captures the mouse
        if (overUI(e)) return;
        const parent = stageCanvas().parentElement;
        if (parent && parent.contains(e.target)) pressedNow.add(e.button);
      },
      true
    );
    document.addEventListener('mouseup', (e) => mouseButtons.delete(e.button), true);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (player.mode !== 'editor') return;
      if (e.button === 2) {
        rightDown = true;
        canvas.setPointerCapture(e.pointerId);
      } else if (e.button === 0 && tc.axis === null && !tc.dragging) {
        const rect = canvas.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const py = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const hit = pickAt(px, py, 1000);
        selectObject(hit ? hit.object : null);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!rightDown) return;
      camYaw -= e.movementX * sensitivity;
      camPitch -= e.movementY * sensitivity;
      updateCamera();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2) rightDown = false;
    });
    Scratch.vm.runtime.on('BEFORE_EXECUTE', () => {
      deltaX = accDX;
      deltaY = accDY;
      accDX = 0;
      accDY = 0;
      pressedThisFrame.clear();
      pressedNow.forEach((b) => pressedThisFrame.add(b));
      pressedNow.clear();
    });
    Scratch.vm.runtime.on('PROJECT_STOP_ALL', () => {
      player.mode = 'off';
      mouseLook = false;
      pressedNow.clear();
      if (isReady) {
        clearHover();
        clearParticles();
        clearEmitters();
      }
      clearUI();
      exitEditor();
      if (document.pointerLockElement) document.exitPointerLock();
    });
  };

  const init = () => {
    if (!loading) {
      loading = (async () => {
        await loadStep(5);
        THREE = await import(THREE_URL);
        await loadStep(35);
        TransformControls = (await import(TC_URL)).TransformControls;
        await loadStep(55);
        player.pos = new THREE.Vector3();
        player.spawn = new THREE.Vector3();
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        canvas = renderer.domElement;
        Object.assign(canvas.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        });
        if (!enabled) canvas.style.display = 'none';
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        scene = new THREE.Scene();
        await loadStep(65);
        try {
          // reflections, so metal blocks look like metal instead of black
          const { RoomEnvironment } = await import(ROOM_URL);
          const pm = new THREE.PMREMGenerator(renderer);
          scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
          pm.dispose();
        } catch (e) {
          console.warn('3D Turbo could not load reflections (metal will look dark)', e);
        }
        await loadStep(85);
        camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 1000);
        camera.rotation.order = 'YXZ';
        perspCam = camera;
        clock = new THREE.Clock();
        raycaster = new THREE.Raycaster();
        tc = new TransformControls(camera, canvas);
        tc.enabled = false;
        scene.add(tc);
        crosshair = document.createElement('div');
        Object.assign(crosshair.style, {
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '10px',
          height: '10px',
          marginLeft: '-5px',
          marginTop: '-5px',
          borderRadius: '50%',
          background: '#ff9acb',
          border: '2px solid white',
          boxSizing: 'border-box',
          pointerEvents: 'none',
          display: 'none'
        });
        uiLayer = document.createElement('div');
        Object.assign(uiLayer.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          zIndex: '2',
          pointerEvents: 'none'
        });
        if (!enabled) uiLayer.style.display = 'none';
        buildToolbar();
        particleGeos = { cube: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.SphereGeometry(0.5, 8, 6) };
        particleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
        buildWorld();
        attach();
        setupInput();
        setupV12();
        isReady = true;
        fpsTime = performance.now();
        loop();
        setLoadBar(100);
      })().catch((e) => {
        loading = null;
        toast('Could not load the 3D engine. Check your internet connection and try again.');
        console.error('3D Turbo failed to load Three.js', e);
        throw e;
      });
    }
    return loading;
  };

  const shapes = {
    cube: () => new THREE.BoxGeometry(1, 1, 1),
    sphere: () => new THREE.SphereGeometry(0.5, 32, 16),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
    cone: () => new THREE.ConeGeometry(0.5, 1, 32),
    torus: () => new THREE.TorusGeometry(0.5, 0.2, 16, 48),
    floor: () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  };

  const getObj = (name) => objects.get(str(name)) || idIndex.get(str(name));

  const makeShape = (shape, color) => {
    const key = shapes[str(shape)] ? str(shape) : 'cube';
    const material = new THREE.MeshStandardMaterial({
      color: toColor(color),
      roughness: 0.6,
      envMapIntensity: 0.2,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(shapes[key](), material);
    mesh.userData.shape = key;
    return mesh;
  };

  // a copy with its own materials (so colors and hover shade never leak between copies)
  const copyObject = (src) => {
    touchColor(src);
    const clips = src.userData.clips;
    delete src.userData.clips;
    // data that does not survive a plain clone is taken off and copied by hand
    const KEYS = ['phys', '_pc', '_pr', 'terrain', 'base', 'origMaterial', 'shader'];
    const stash = [];
    src.traverse((n) => {
      const keep = {};
      KEYS.forEach((k) => {
        if (n.userData[k] !== undefined) {
          keep[k] = n.userData[k];
          delete n.userData[k];
        }
      });
      stash.push([n, keep]);
    });
    const copy = src.clone(true);
    const srcNodes = [];
    src.traverse((n) => srcNodes.push(n));
    const copyNodes = [];
    copy.traverse((n) => copyNodes.push(n));
    stash.forEach(([n, keep]) => Object.assign(n.userData, keep));
    srcNodes.forEach((s, i) => {
      const c = copyNodes[i];
      const su = s.userData;
      if (su.phys) c.userData.phys = physFromData(physToData(su.phys));
      if (su.terrain) {
        c.userData.terrain = Object.assign({}, su.terrain, { heights: Float32Array.from(su.terrain.heights), paint: su.terrain.paint ? Object.assign({}, su.terrain.paint) : null });
        c.geometry = s.geometry.clone();
      }
      if (su.base) {
        c.userData.base = Float32Array.from(su.base);
        c.geometry = s.geometry.clone();
      }
    });
    if (clips) {
      src.userData.clips = clips;
      copy.userData.clips = clips;
    }
    copy.traverse((child) => {
      if (!child.material) return;
      const dup = (m) => (m.userData && m.userData.shared ? m : m.clone());
      child.material = Array.isArray(child.material) ? child.material.map(dup) : dup(child.material);
    });
    if (copy.userData.water && scene.userData.waters) scene.userData.waters.add(copy);
    return copy;
  };

  const loadTexture = async (key, url) => {
    if (textureCache.has(key)) return textureCache.get(key);
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    const tex = await loader.loadAsync(url);
    tex.userData.src = key;
    textureCache.set(key, tex);
    return tex;
  };

  const applyTexture = (mats, base) => {
    mats.forEach((m) => {
      const tex = base.clone();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      if (m.map) m.map.dispose();
      m.map = tex;
      if (m.color) m.color.set(0xffffff);
      m.needsUpdate = true;
    });
  };

  const loaderCache = {};
  const getLoaderModule = (key, url) => {
    if (!loaderCache[key]) {
      loaderCache[key] = import(url).catch((e) => {
        delete loaderCache[key];
        throw e;
      });
    }
    return loaderCache[key];
  };

  // models with silly sizes (like fbx files in centimeters) get shrunk or grown to something sane
  const fitModel = (obj) => {
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const biggest = Math.max(size.x, size.y, size.z);
    if (biggest > 0 && (biggest > 30 || biggest < 0.1)) obj.scale.multiplyScalar(2 / biggest);
  };

  const buildModel = async (ext, buffer) => {
    let obj;
    if (ext === 'obj') {
      const { OBJLoader } = await getLoaderModule('obj', OBJ_URL);
      obj = new OBJLoader().parse(new TextDecoder().decode(buffer));
    } else if (ext === 'fbx') {
      const { FBXLoader } = await getLoaderModule('fbx', FBX_URL);
      obj = new FBXLoader().parse(buffer, '');
      obj.userData.clips = obj.animations || [];
    } else if (ext === 'dae') {
      const { ColladaLoader } = await getLoaderModule('dae', DAE_URL);
      const result = new ColladaLoader().parse(new TextDecoder().decode(buffer), '');
      obj = result.scene;
      obj.userData.clips = result.animations || [];
    } else if (ext === 'stl') {
      const { STLLoader } = await getLoaderModule('stl', STL_URL);
      const geometry = new STLLoader().parse(buffer);
      obj = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, side: THREE.DoubleSide })
      );
    } else {
      const { GLTFLoader } = await getLoaderModule('gltf', GLTF_URL);
      const loader = new GLTFLoader();
      // compressed models need extra decoders (only fetched when the file asks for them)
      const head = new TextDecoder().decode(buffer.slice(0, Math.min(buffer.byteLength, 300000)));
      if (head.includes('KHR_draco_mesh_compression')) {
        const { DRACOLoader } = await getLoaderModule('draco', DRACO_URL);
        const draco = new DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        loader.setDRACOLoader(draco);
      }
      if (head.includes('EXT_meshopt_compression')) {
        const { MeshoptDecoder } = await getLoaderModule('meshopt', MESHOPT_URL);
        loader.setMeshoptDecoder(MeshoptDecoder);
      }
      const gltf = await loader.parseAsync(buffer, '');
      obj = gltf.scene;
      obj.userData.clips = gltf.animations;
    }
    materialsOf(obj).forEach((m) => {
      if (m.metalness !== undefined) m.envMapIntensity = 0.2 + 0.8 * m.metalness;
    });
    fitModel(obj);
    return obj;
  };

  const makeSky = (tex) => {
    const sky = tex.clone();
    sky.mapping = THREE.EquirectangularReflectionMapping;
    sky.colorSpace = THREE.SRGBColorSpace;
    sky.needsUpdate = true;
    removeSkyDome();
    scene.background = sky;
  };

  // ===================================================================
  // ready-made textured blocks
  // ===================================================================

  const FACE_ORDER = ['right', 'left', 'top', 'bottom', 'front', 'back']; // same order as a three.js box
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  // ready-made block types are flat colour presets: no pictures, assign your own textures
  const BLOCKS = {
    grass: { color: '#6f9a4f', rough: 0.95, metal: 0 },
    dirt: { color: '#7a5a3e', rough: 1, metal: 0 },
    stone: { color: '#8c8c8a', rough: 0.85, metal: 0 },
    sand: { color: '#d9c99a', rough: 1, metal: 0 },
    planks: { color: '#b8884f', rough: 0.8, metal: 0 },
    log: { color: '#6b4a2c', rough: 0.9, metal: 0 },
    leaves: { color: '#4f8a3a', rough: 1, metal: 0 },
    brick: { color: '#a4533d', rough: 0.85, metal: 0 },
    glass: { color: '#cfe6ee', rough: 0.05, metal: 0, glass: true },
    iron: { color: '#c9ccd0', rough: 0.35, metal: 1 },
    gold: { color: '#e6b84a', rough: 0.25, metal: 1 },
    snow: { color: '#f2f5f7', rough: 0.9, metal: 0 },
    glowstone: { color: '#f2d38a', rough: 0.5, metal: 0, glow: true },
    obsidian: { color: '#231f2e', rough: 0.15, metal: 0.3 }
  };

  const allBlockTypes = () => Object.keys(BLOCKS);


  // one place that sets roughness + metalness (and the reflection amount that makes metal look like metal)
  const applySurface = (m, rough, metal) => {
    if (!m || m.roughness === undefined) return;
    m.roughness = clamp01(rough);
    m.metalness = clamp01(metal);
    m.envMapIntensity = 0.2 + 0.8 * m.metalness;
  };

  let sharedBox = null;
  let sharedPlane = null;

  const makeBlockMat = (def, face) => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(def.color) });
    if (def.glass) {
      m.transparent = true;
      m.opacity = 0.35;
      m.depthWrite = false;
    }
    if (def.glow) {
      m.emissive = new THREE.Color(def.color);
      m.emissiveIntensity = 0.7;
    }
    applySurface(m, def.rough, def.metal);
    return m;
  };

  const makeBlockMesh = (type) => {
    const def = BLOCKS[type];
    if (!sharedBox) {
      sharedBox = new THREE.BoxGeometry(1, 1, 1);
      sharedBox.userData.shared = true;
    }
    const mesh = new THREE.Mesh(
      sharedBox,
      FACE_ORDER.map((f) => makeBlockMat(def, f))
    );
    mesh.userData.shape = 'cube';
    mesh.userData.blockType = type;
    return mesh;
  };

  const setTypeSurface = (type, rough, metal) => {
    const def = BLOCKS[type];
    if (!def) return;
    def.rough = clamp01(rough);
    def.metal = clamp01(metal);
    for (const o of objects.values()) {
      if (o.userData.blockType === type) materialsOf(o).forEach((m) => applySurface(m, def.rough, def.metal));
    }
  };

  const removeShaderQuiet = (obj) => {
    if (obj.userData.shader && typeof removeShader === 'function') removeShader(obj);
  };
  const registerClonedChildren = (root, rootName) => {
    root.traverse((c) => {
      if (c === root || !c.userData || c.userData.name === undefined) return;
      if (objects.get(c.userData.name) === c) return;
      const orig = String(c.userData.name).split('/').pop();
      const nn = uniqueName(rootName + '/' + orig);
      const g = c.userData.group;
      c.userData.group = null;
      c.userData.id = null;
      c.userData.name = nn;
      registerNewObject(c);
      objects.set(nn, c);
      if (g) joinGroup(c, g);
    });
  };
  // ===================================================================
  // v12 core: time, events, globals, timers, ids, hierarchy, pause
  // ===================================================================

  const xClamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const xLerp = (a, b, t) => a + (b - a) * t;
  const xJSON = (v, fallback) => {
    try {
      return JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  };
  const xHex = (c) => '#' + c.getHexString();
  const xNum = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d === undefined ? 0 : d;
  };

  // engine time (scaled, stops while paused) vs real time
  const TM = { scale: 1, dt: 0, raw: 0, time: 0, frames: 0 };
  let enginePaused = false;
  let projectPaused = false;
  let origStep = null;
  let pauseKeyName = '';

  // ---- events ----
  const EV = { now: new Set(), frame: new Set(), args: new Map(), matched: '', pairsNow: [], pairsFrame: [], names: new Set() };
  const BUILTIN_EVENTS = [
    'object created',
    'object destroyed',
    'collided',
    'entered trigger',
    'left trigger',
    'animation finished',
    'scene changed',
    'sound ended',
    'landed',
    'jumped',
    'wall jumped',
    'slide started',
    'paused',
    'resumed',
    'world loaded',
    'game saved',
    'save failed'
  ];

  const fireEvent = (name, a, b, c) => {
    const n = str(name);
    EV.now.add(n);
    EV.args.set(n, [a === undefined ? '' : a, b === undefined ? '' : b, c === undefined ? '' : c]);
    if (BUILTIN_EVENTS.indexOf(n) < 0) EV.names.add(n);
  };

  const firePair = (kind, a, b) => {
    EV.pairsNow.push({ kind, a, b });
    if (EV.pairsNow.length > 500) EV.pairsNow.shift();
  };

  const nameMatches = (name, pattern) => {
    const p = str(pattern).trim();
    if (p === '' || p === 'anything' || p === '*') return true;
    if (name === p) return true;
    const o = objects.get(name);
    if (!o) return isPlayerName(name) && isPlayerName(p);
    if (o.userData.group === p || o.userData.id === p) return true;
    return selectorTest(o, p);
  };

  const flushEvents = () => {
    EV.frame = EV.now;
    EV.now = new Set();
    EV.pairsFrame = EV.pairsNow;
    EV.pairsNow = [];
    try {
      const rt = Scratch.vm.runtime;
      if (EV.frame.size) rt.startHats('turbo3d_whenEvent');
      if (EV.pairsFrame.length) rt.startHats('turbo3d_whenContact');
    } catch (e) {
      /* ignore */
    }
  };

  // ---- global variables ----
  const globals = new Map();

  // ---- timers and delayed events ----
  const timers = new Map();
  let schedule = [];
  let scheduleId = 0;

  const stepTimers = (dt) => {
    timers.forEach((t) => {
      if (t.run) t.t += dt;
    });
    if (!schedule.length) return;
    const keep = [];
    schedule.forEach((s) => {
      s.left -= dt;
      if (s.left <= 0) {
        fireEvent(s.event, s.a, s.b, s.c);
        if (s.every > 0) {
          s.left += s.every;
          keep.push(s);
        }
      } else keep.push(s);
    });
    schedule = keep;
  };

  // ---- ids, names, parenting ----
  let idCounter = 0;
  const makeId = () => {
    let id;
    do {
      id = 'id' + ++idCounter;
    } while (idIndex.has(id));
    return id;
  };

  const objById = (id) => idIndex.get(str(id).trim());

  const setObjectId = (obj, id) => {
    const want = str(id).trim();
    if (!want) return false;
    const cur = idIndex.get(want);
    if (cur && cur !== obj) return false;
    if (obj.userData.id) idIndex.delete(obj.userData.id);
    obj.userData.id = want;
    idIndex.set(want, obj);
    return true;
  };

  const registerNewObject = (obj) => {
    const u = obj.userData;
    const other = u.id ? idIndex.get(u.id) : null;
    if (!u.id || (other && other !== obj)) u.id = makeId();
    idIndex.set(u.id, obj);
  };

  // named children of an object (direct)
  const childObjects = (obj) => {
    const list = [];
    obj.children.forEach((c) => {
      if (c.userData && c.userData.name !== undefined && objects.get(c.userData.name) === c) list.push(c);
    });
    return list;
  };

  const parentObject = (obj) => {
    const p = obj.parent;
    return p && p !== scene && p.userData && p.userData.name !== undefined && objects.get(p.userData.name) === p ? p : null;
  };

  const worldPosOf = (obj, out) => obj.getWorldPosition(out || new THREE.Vector3());

  const renameObject = (oldName, newName) => {
    const from = str(oldName);
    const to = str(newName).trim();
    const obj = objects.get(from);
    if (!obj || !to || from === to || objects.has(to)) return false;
    objects.delete(from);
    objects.set(to, obj);
    obj.userData.name = to;
    const g = obj.userData.group;
    if (g && groups.has(g)) {
      groups.get(g).delete(from);
      groups.get(g).add(to);
    }
    if (mixers.has(from)) {
      mixers.set(to, mixers.get(from));
      mixers.delete(from);
    }
    emitters.forEach((e) => {
      if (e.follow === from) e.follow = to;
    });
    if (lastCreated === from) lastCreated = to;
    return true;
  };

  const attachTo = (child, parent) => {
    if (!child || !parent || child === parent) return false;
    for (let p = parent; p; p = p.parent) if (p === child) return false;
    parent.attach(child);
    return true;
  };

  const detachFromParent = (child) => {
    if (!child || !child.parent || child.parent === scene) return false;
    scene.attach(child);
    return true;
  };

  const setObjectEnabled = (obj, on) => {
    const u = obj.userData;
    if (on === (u.enabled !== false)) return;
    u.enabled = on;
    if (on) {
      obj.visible = u.visBefore !== false;
      u.solid = u.solidBefore !== false;
    } else {
      u.visBefore = obj.visible;
      u.solidBefore = u.solid !== false;
      obj.visible = false;
      u.solid = false;
    }
  };

  const worldPointToObjectsList = (list) => JSON.stringify(list.map((o) => o.userData.name));

  // ---- pause ----
  const setEnginePaused = (p) => {
    if (p === enginePaused) return;
    enginePaused = p;
    if (p) {
      if (document.pointerLockElement) document.exitPointerLock();
      auPause(true);
    } else if (!projectPaused) auPause(false);
    fireEvent(p ? 'paused' : 'resumed');
  };

  const setProjectPaused = (p) => {
    const rt = Scratch.vm.runtime;
    if (p === projectPaused) return;
    projectPaused = p;
    if (p) {
      origStep = rt._step;
      // the project's scripts and sprites stop; the 3D view keeps drawing
      rt._step = function () {};
    } else if (origStep) {
      rt._step = origStep;
      origStep = null;
    }
    if (p && document.pointerLockElement) document.exitPointerLock();
    auPause(p);
    if (!p) fireEvent('resumed');
    else fireEvent('paused');
  };

  const isFrozen = () => enginePaused || projectPaused;

  // ---- persistent storage (localStorage with a memory fallback) ----
  let saveNs = 'game';
  const memoryStore = new Map();
  const lsKey = (k) => 'turbo3d.' + saveNs + '.' + k;
  const storeGet = (k) => {
    try {
      const v = window.localStorage.getItem(lsKey(k));
      return v === null ? undefined : v;
    } catch (e) {
      return memoryStore.get(lsKey(k));
    }
  };
  const storeSet = (k, v) => {
    try {
      window.localStorage.setItem(lsKey(k), v);
      return true;
    } catch (e) {
      memoryStore.set(lsKey(k), v);
      return false;
    }
  };
  const storeDel = (k) => {
    try {
      window.localStorage.removeItem(lsKey(k));
    } catch (e) {
      /* ignore */
    }
    memoryStore.delete(lsKey(k));
  };
  const storeKeys = (prefix) => {
    const pre = lsKey(prefix || '');
    const out = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(pre)) out.push(k.slice(lsKey('').length));
      }
    } catch (e) {
      memoryStore.forEach((v, k) => {
        if (k.startsWith(pre)) out.push(k.slice(lsKey('').length));
      });
    }
    return out;
  };
  let lastSaveError = '';

  // ---- seeded noise (for terrain and generation) ----
  const xHash = (x, y, z, seed) => {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  };
  const xFade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise2 = (x, y, seed) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = xFade(x - x0);
    const fy = xFade(y - y0);
    const a = xHash(x0, y0, 0, seed);
    const b = xHash(x0 + 1, y0, 0, seed);
    const c = xHash(x0, y0 + 1, 0, seed);
    const d = xHash(x0 + 1, y0 + 1, 0, seed);
    return xLerp(xLerp(a, b, fx), xLerp(c, d, fx), fy);
  };
  const noise3 = (x, y, z, seed) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const fx = xFade(x - x0);
    const fy = xFade(y - y0);
    const fz = xFade(z - z0);
    const v = (i, j, k) => xHash(x0 + i, y0 + j, z0 + k, seed);
    return xLerp(
      xLerp(xLerp(v(0, 0, 0), v(1, 0, 0), fx), xLerp(v(0, 1, 0), v(1, 1, 0), fx), fy),
      xLerp(xLerp(v(0, 0, 1), v(1, 0, 1), fx), xLerp(v(0, 1, 1), v(1, 1, 1), fx), fy),
      fz
    );
  };
  const fbm2 = (x, y, seed, octaves) => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise2(x * freq, y * freq, seed + i * 17) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  const rngFrom = (seed) => {
    let s = (Math.floor(seed) || 1) >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ---- easing ----
  const EASINGS = {
    linear: (t) => t,
    'ease in': (t) => t * t,
    'ease out': (t) => 1 - (1 - t) * (1 - t),
    'ease in out': (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    'cubic in': (t) => t * t * t,
    'cubic out': (t) => 1 - Math.pow(1 - t, 3),
    'cubic in out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    'back out': (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    'elastic out': (t) => {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
    },
    'bounce out': (t) => {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    },
    smooth: (t) => t * t * (3 - 2 * t)
  };
  const easeFn = (name) => EASINGS[str(name)] || EASINGS.linear;

  // ===================================================================
  // v12 scenes: each scene has its own objects, lights, sky, emitters and camera
  // ===================================================================

  const sceneStore = new Map();
  let currentSceneName = 'main';

  const makeSceneLights = (scn) => {
    const a = new THREE.AmbientLight(0xeaf0f5, 1.1);
    const s = new THREE.DirectionalLight(0xfff0dc, 1.15);
    s.position.set(3, 6, 4);
    s.castShadow = shadowsOn;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0005;
    const sc = s.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 0.5;
    sc.far = 200;
    scn.add(a);
    scn.add(s);
    return { a, s };
  };

  const snapshotScene = () => {
    let rec = sceneStore.get(currentSceneName);
    if (!rec) {
      rec = {};
      sceneStore.set(currentSceneName, rec);
    }
    rec.scene = scene;
    rec.objects = objects;
    rec.groups = groups;
    rec.mixers = mixers;
    rec.emitters = emitters;
    rec.idIndex = idIndex;
    rec.ambient = ambient;
    rec.sun = sun;
    rec.mode = player.mode;
    rec.cam = { pos: camera.position.clone(), yaw: camYaw, pitch: camPitch, fov: fovBase };
    rec.ppos = player.pos.clone();
    rec.pspawn = player.spawn.clone();
    return rec;
  };

  const sceneExists = (name) => str(name).trim() === currentSceneName || sceneStore.has(str(name).trim());

  const createScene = (name) => {
    const n = str(name).trim();
    if (!n || sceneExists(n)) return false;
    snapshotScene();
    const scn = new THREE.Scene();
    scn.environment = scene.environment;
    scn.background = new THREE.Color().setRGB(1, 0.89, 0.95, THREE.SRGBColorSpace);
    const L = makeSceneLights(scn);
    sceneStore.set(n, {
      scene: scn,
      objects: new Map(),
      groups: new Map(),
      mixers: new Map(),
      emitters: new Map(),
      idIndex: new Map(),
      ambient: L.a,
      sun: L.s,
      mode: 'off',
      cam: { pos: new THREE.Vector3(0, 1.6, 5), yaw: 0, pitch: 0, fov: 70 },
      ppos: new THREE.Vector3(),
      pspawn: new THREE.Vector3()
    });
    return true;
  };

  const switchScene = (name) => {
    const n = str(name).trim();
    if (n === currentSceneName) return true;
    const target = sceneStore.get(n);
    if (!target) return false;
    snapshotScene();
    deselect();
    clearHover();
    clearParticles();
    if (tc && tc.parent) tc.parent.remove(tc);
    debugDetach();
    scene = target.scene;
    objects = target.objects;
    groups = target.groups;
    mixers = target.mixers;
    emitters = target.emitters;
    idIndex = target.idIndex;
    ambient = target.ambient;
    sun = target.sun;
    if (tc) scene.add(tc);
    debugAttach();
    camera.position.copy(target.cam.pos);
    camYaw = target.cam.yaw;
    camPitch = target.cam.pitch;
    fovBase = target.cam.fov;
    applyProjection();
    player.pos.copy(target.ppos);
    player.spawn.copy(target.pspawn);
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.mode = target.mode;
    mouseLook = target.mode === 'fp' || target.mode === 'fly';
    if (target.mode === 'editor') enterEditor();
    else exitEditor();
    if (!mouseLook && document.pointerLockElement) document.exitPointerLock();
    updateCamera();
    currentSceneName = n;
    physicsReset();
    fireEvent('scene changed', n);
    return true;
  };

  const deleteScene = (name) => {
    const n = str(name).trim();
    if (n === currentSceneName) return false;
    const rec = sceneStore.get(n);
    if (!rec) return false;
    rec.objects.forEach((o) => disposeObject(o));
    rec.emitters.forEach((e) => {
      if (e.mesh) {
        e.mesh.dispose();
        e.mesh.material.dispose();
        e.geo.dispose();
      }
    });
    sceneStore.delete(n);
    return true;
  };

  const sceneNames = () => {
    const list = Array.from(sceneStore.keys());
    if (list.indexOf(currentSceneName) < 0) list.unshift(currentSceneName);
    return list;
  };

  // ===================================================================
  // v12 serialization, prefabs and saving
  // ===================================================================

  const prefabs = new Map(); // name -> list of object descriptions (first one is the root)

  const setTexFilter = (tex, pixel) => {
    tex.magFilter = pixel ? THREE.NearestFilter : THREE.LinearFilter;
    tex.minFilter = pixel ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = !pixel;
    tex.needsUpdate = true;
  };

  const resolveSrc = async (src) => {
    const s = str(src);
    if (s.startsWith('asset:')) {
      const a = readAssets()[s.slice(6)];
      return a && a.type === 'image' ? loadTexture(s, a.data) : null;
    }
    if (/^(https?:|data:)/i.test(s)) {
      if (!(await Scratch.canFetch(s))) return null;
      return loadTexture(s, s);
    }
    return null;
  };

  const texInfo = (t) => {
    if (!t || !t.userData || !t.userData.src || String(t.userData.src).startsWith('costume:')) return null;
    return {
      src: t.userData.src,
      rx: t.repeat.x,
      ry: t.repeat.y,
      ox: t.offset.x,
      oy: t.offset.y,
      nearest: t.magFilter === THREE.NearestFilter
    };
  };

  const serMat = (m) => {
    const o = {};
    if (m.color) o.color = m.color.getHexString();
    ['roughness', 'metalness', 'opacity', 'envMapIntensity', 'emissiveIntensity', 'alphaTest'].forEach((k) => {
      if (typeof m[k] === 'number') o[k] = m[k];
    });
    if (m.emissive) o.emissive = m.emissive.getHexString();
    o.transparent = !!m.transparent;
    o.side = m.side;
    o.wireframe = !!m.wireframe;
    o.flatShading = !!m.flatShading;
    o.depthWrite = m.depthWrite !== false;
    const map = texInfo(m.map);
    if (map) o.map = map;
    const nm = texInfo(m.normalMap);
    if (nm) o.normalMap = nm;
    if (m.userData && m.userData.libName) o.lib = m.userData.libName;
    return o;
  };

  const applyMatData = async (m, d) => {
    if (!m || !d) return;
    if (d.lib && materialLib.has(d.lib)) return;
    if (d.map) {
      const base = await resolveSrc(d.map.src);
      if (base) {
        applyTexture([m], base);
        m.map.repeat.set(d.map.rx, d.map.ry);
        m.map.offset.set(d.map.ox, d.map.oy);
        setTexFilter(m.map, !!d.map.nearest);
      }
    }
    if (d.normalMap) {
      const base = await resolveSrc(d.normalMap.src);
      if (base) {
        const t = base.clone();
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(d.normalMap.rx, d.normalMap.ry);
        t.needsUpdate = true;
        m.normalMap = t;
      }
    }
    if (d.color && m.color) m.color.set('#' + d.color);
    if (d.emissive && m.emissive) m.emissive.set('#' + d.emissive);
    ['roughness', 'metalness', 'opacity', 'envMapIntensity', 'emissiveIntensity', 'alphaTest'].forEach((k) => {
      if (typeof d[k] === 'number' && typeof m[k] === 'number') m[k] = d[k];
    });
    m.transparent = !!d.transparent;
    if (d.side !== undefined) m.side = d.side;
    m.wireframe = !!d.wireframe;
    m.flatShading = !!d.flatShading;
    m.depthWrite = d.depthWrite !== false;
    m.needsUpdate = true;
  };

  const serObject = (o) => {
    touchColor(o);
    const u = o.userData;
    const d = {
      name: u.name,
      id: u.id,
      group: u.group || null,
      pos: o.position.toArray(),
      rot: [o.rotation.x, o.rotation.y, o.rotation.z],
      scl: o.scale.toArray(),
      visible: o.visible,
      solid: u.solid !== false,
      hover: u.hover !== false,
      enabled: u.enabled !== false,
      tags: (u.tags || []).slice(),
      data: JSON.parse(JSON.stringify(u.data || {})),
      noCast: !!u.noCast,
      noReceive: !!u.noReceive
    };
    if (u.enabled === false) {
      d.visible = u.visBefore !== false;
      d.solid = u.solidBefore !== false;
    }
    if (u.light) d.kind = 'light';
    else if (u.customGeo) d.kind = 'mesh';
    else if (u.terrain) d.kind = 'terrain';
    else if (u.water) d.kind = 'water';
    else if (u.scatter) d.kind = 'scatter';
    else if (u.modelSrc) d.kind = 'model';
    else if (u.blockType) d.kind = 'block';
    else if (u.shape && shapes[u.shape]) d.kind = 'shape';
    else d.kind = 'empty';
    if (d.kind === 'light') d.light = lightToData(o);
    if (d.kind === 'mesh') d.mesh = u.customGeo;
    if (d.kind === 'terrain') d.terrain = Object.assign({}, u.terrain, { heights: Array.from(u.terrain.heights) });
    if (d.kind === 'water') d.water = u.water;
    if (d.kind === 'scatter') d.scatter = u.scatter;
    if (d.kind === 'model') d.model = u.modelSrc;
    if (d.kind === 'block') d.block = u.blockType;
    if (d.kind === 'shape') d.shape = u.shape;
    if (o.isMesh && d.kind !== 'model') {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      d.mats = mats.map(serMat);
    }
    if (u.phys) d.phys = physToData(u.phys);
    if (u.shader) d.shader = u.shader;
    return d;
  };

  const buildFromData = async (d) => {
    let obj;
    switch (d.kind) {
      case 'light':
        obj = makeLightFromData(d.light);
        break;
      case 'mesh':
        obj = makeCustomMesh(d.mesh, '#cccccc');
        break;
      case 'terrain':
        obj = makeTerrain(d.terrain);
        break;
      case 'water':
        obj = makeWater(d.water);
        break;
      case 'scatter':
        obj = makeScatter(d.scatter);
        break;
      case 'model':
        obj = await loadModelObject(d.model);
        break;
      case 'block':
        obj = BLOCKS[d.block] ? makeBlockMesh(d.block) : makeShape('cube', '#cccccc');
        break;
      case 'shape':
        obj = makeShape(d.shape, '#cccccc');
        break;
      default:
        obj = new THREE.Group();
    }
    return obj;
  };

  const applyCommon = async (obj, d, keepId) => {
    const u = obj.userData;
    obj.position.fromArray(d.pos);
    obj.rotation.set(d.rot[0], d.rot[1], d.rot[2]);
    obj.scale.fromArray(d.scl);
    obj.visible = d.visible !== false;
    u.solid = d.solid !== false;
    u.hover = d.hover !== false;
    u.tags = (d.tags || []).slice();
    u.data = JSON.parse(JSON.stringify(d.data || {}));
    if (d.mats && obj.isMesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (let i = 0; i < mats.length; i++) await applyMatData(mats[i], d.mats[Math.min(i, d.mats.length - 1)]);
      d.mats.forEach((m, i) => {
        if (m.lib && materialLib.has(m.lib)) setObjectMaterial(obj, materialLib.get(m.lib), mats.length > 1 ? faceNameOf(i) : 'all');
      });
    }
    if (d.noCast) u.noCast = true;
    if (d.noReceive) u.noReceive = true;
    applyShadowFlags(obj);
    if (d.phys) u.phys = physFromData(d.phys);
    if (d.shader) applyShaderData(obj, d.shader);
    if (keepId && d.id) u.id = d.id;
    if (d.enabled === false) {
      u.enabled = true;
      setObjectEnabled(obj, false);
    }
  };

  const captureTree = (root) => {
    const list = [];
    const walk = (o, parentIdx) => {
      const d = serObject(o);
      d.parent = parentIdx;
      const idx = list.length;
      list.push(d);
      childObjects(o).forEach((c) => walk(c, idx));
    };
    walk(root, -1);
    return list;
  };

  // opts: keepNames, keepIds, pos [x,y,z], group
  const spawnTree = async (list, rootName, opts) => {
    const o = opts || {};
    const made = [];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const obj = await buildFromData(d);
      await applyCommon(obj, d, !!o.keepIds);
      let name;
      if (i === 0) name = rootName;
      else if (o.keepNames) name = d.name;
      else name = uniqueName(rootName + '/' + String(d.name).split('/').pop());
      addObject(name, obj);
      if (o.keepIds && d.id) setObjectId(obj, d.id);
      made.push(obj);
      if (d.parent >= 0 && made[d.parent]) made[d.parent].add(obj);
      const g = i === 0 && o.group !== undefined && o.group !== '' ? o.group : d.group;
      if (g) joinGroup(obj, g);
    }
    if (made[0] && o.pos) made[0].position.set(o.pos[0], o.pos[1], o.pos[2]);
    return made[0] || null;
  };

  const faceNameOf = (i) => FACE_ORDER[i] || 'all';

  // ---- world ----
  const serializeWorld = () => {
    const trees = [];
    for (const o of objects.values()) if (o.parent === scene) trees.push(captureTree(o));
    const env = { bg: null, fog: null };
    if (scene.background && scene.background.isColor) env.bg = { color: scene.background.getHexString() };
    else if (scene.background && scene.background.userData && scene.background.userData.src)
      env.bg = { sky: scene.background.userData.src };
    if (scene.fog && scene.fog.isFogExp2) env.fog = { color: scene.fog.color.getHexString(), density: scene.fog.density };
    else if (scene.fog) env.fog = { color: scene.fog.color.getHexString(), near: scene.fog.near, far: scene.fog.far };
    env.ambient = { color: ambient.color.getHexString(), intensity: ambient.intensity };
    env.sun = { color: sun.color.getHexString(), intensity: sun.intensity, pos: sun.position.toArray() };
    env.exposure = renderer.toneMappingExposure;
    env.tone = toneName;
    return {
      v: 12,
      scene: currentSceneName,
      env,
      day: { on: day.on, tod: day.tod, length: day.length },
      cam: { pos: camera.position.toArray(), yaw: camYaw, pitch: camPitch, fov: fovBase },
      player: { mode: player.mode, pos: player.pos.toArray(), style: playerStyleName },
      gravity: physWorld.gravity,
      globals: Object.fromEntries(globals),
      prefabs: Object.fromEntries(prefabs),
      trees
    };
  };

  const clearSceneObjects = () => {
    for (const name of Array.from(objects.keys())) removeObject(name);
    clearEmitters();
    clearParticles();
    tweenClear();
  };

  const loadWorldData = async (data, restorePlayer) => {
    if (!data || !Array.isArray(data.trees)) return false;
    clearHover();
    clearSceneObjects();
    const env = data.env || {};
    if (env.bg && env.bg.color) scene.background = new THREE.Color('#' + env.bg.color);
    else if (env.bg && env.bg.sky) {
      const t = await resolveSrc(env.bg.sky);
      if (t) makeSky(t);
    } else if (env.bg === null) scene.background = null;
    if (env.fog) {
      const c = new THREE.Color('#' + env.fog.color);
      scene.fog = env.fog.density !== undefined ? new THREE.FogExp2(c, env.fog.density) : new THREE.Fog(c, env.fog.near, env.fog.far);
    } else scene.fog = null;
    if (env.ambient) {
      ambient.color.set('#' + env.ambient.color);
      ambient.intensity = env.ambient.intensity;
    }
    if (env.sun) {
      sun.color.set('#' + env.sun.color);
      sun.intensity = env.sun.intensity;
      sun.position.fromArray(env.sun.pos);
    }
    if (env.tone) setToneMapping(env.tone, env.exposure);
    if (data.day) {
      day.on = !!data.day.on;
      day.tod = data.day.tod;
      day.length = data.day.length;
    }
    if (typeof data.gravity === 'number') physWorld.gravity = data.gravity;
    globals.clear();
    Object.keys(data.globals || {}).forEach((k) => globals.set(k, data.globals[k]));
    prefabs.clear();
    Object.keys(data.prefabs || {}).forEach((k) => prefabs.set(k, data.prefabs[k]));
    for (const tree of data.trees) {
      if (!tree.length) continue;
      await spawnTree(tree, tree[0].name, { keepNames: true, keepIds: true, group: '' });
    }
    if (data.cam) {
      camera.position.fromArray(data.cam.pos);
      camYaw = data.cam.yaw;
      camPitch = data.cam.pitch;
      fovBase = data.cam.fov;
      applyProjection();
      updateCamera();
    }
    if (restorePlayer && data.player) {
      if (data.player.style && PLAYER_STYLES[data.player.style]) applyPlayerStyle(data.player.style);
      if (player.mode === 'fp' || data.player.mode === 'fp') {
        player.pos.fromArray(data.player.pos);
        player.spawn.copy(player.pos);
        player.vx = player.vy = player.vz = 0;
        camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
      }
    }
    physicsReset();
    fireEvent('world loaded', currentSceneName);
    return true;
  };

  const downloadText = (filename, text) => {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  };

  const saveSlot = (slot) => {
    const s = str(slot).trim() || 'slot 1';
    try {
      const payload = JSON.stringify({ t: Date.now(), scene: currentSceneName, data: serializeWorld() });
      const ok = storeSet('slot:' + s, payload);
      if (!ok) throw new Error('browser storage is not available, the save only lives until the page closes');
      lastSaveError = '';
      fireEvent('game saved', s);
      return true;
    } catch (e) {
      lastSaveError = e && e.message ? e.message : String(e);
      fireEvent('save failed', s, lastSaveError);
      return false;
    }
  };

  const readSlot = (slot) => {
    const raw = storeGet('slot:' + str(slot).trim());
    return raw ? xJSON(raw, null) : null;
  };

  const loadSlot = async (slot, restorePlayer) => {
    const rec = readSlot(slot);
    if (!rec || !rec.data) return false;
    return loadWorldData(rec.data, restorePlayer);
  };

  const slotNames = () => storeKeys('slot:').map((k) => k.slice(5));

  // ===================================================================
  // v12 physics: opt-in rigid bodies that live on ordinary objects.
  // Every solid object is a collider. Shapes are boxes or spheres
  // (a capsule uses its bounding box). Bodies do not rotate on impact.
  // ===================================================================

  const physWorld = { gravity: 20, on: true };

  const newPhys = (type) => ({
    type: type || 'dynamic',
    mass: 1,
    friction: 0.5,
    bounce: 0.15,
    linDamp: 0.02,
    angDamp: 0.05,
    gravity: true,
    collider: 'box',
    trigger: false,
    layer: 1,
    mask: 0xffff,
    vel: new THREE.Vector3(),
    ang: new THREE.Vector3(),
    force: new THREE.Vector3(),
    torque: new THREE.Vector3(),
    fp: [0, 0, 0],
    fr: [0, 0, 0],
    enabled: true,
    grounded: false,
    touching: new Set(),
    inside: new Set(),
    groundFriction: 0.5
  });

  const physToData = (p) => ({
    type: p.type,
    mass: p.mass,
    friction: p.friction,
    bounce: p.bounce,
    linDamp: p.linDamp,
    angDamp: p.angDamp,
    gravity: p.gravity,
    collider: p.collider,
    trigger: p.trigger,
    layer: p.layer,
    mask: p.mask,
    vel: p.vel.toArray(),
    ang: p.ang.toArray(),
    fp: p.fp.slice(),
    fr: p.fr.slice(),
    enabled: p.enabled
  });

  const physFromData = (d) => {
    const p = newPhys(d.type);
    ['mass', 'friction', 'bounce', 'linDamp', 'angDamp', 'gravity', 'collider', 'trigger', 'layer', 'mask', 'enabled'].forEach(
      (k) => {
        if (d[k] !== undefined) p[k] = d[k];
      }
    );
    p.vel.fromArray(d.vel || [0, 0, 0]);
    p.ang.fromArray(d.ang || [0, 0, 0]);
    p.fp = (d.fp || [0, 0, 0]).slice();
    p.fr = (d.fr || [0, 0, 0]).slice();
    return p;
  };

  const ensurePhys = (obj, type) => {
    if (!obj.userData.phys) {
      const p = newPhys(type || 'dynamic');
      if (obj.userData.shape === 'sphere') p.collider = 'sphere';
      obj.userData.phys = p;
    } else if (type) obj.userData.phys.type = type;
    return obj.userData.phys;
  };

  const physicsReset = () => {
    for (const o of objects.values()) {
      const p = o.userData.phys;
      if (p) {
        p.touching.clear();
        p.inside.clear();
      }
    }
  };

  const bitOf = (layer) => 1 << (xClamp(Math.round(layer), 1, 16) - 1);
  const parseMask = (txt) => {
    const s = str(txt).trim().toLowerCase();
    if (!s || s === 'all') return 0xffff;
    let m = 0;
    s.split(/[\s,]+/).forEach((t) => {
      const n = parseInt(t, 10);
      if (n >= 1 && n <= 16) m |= 1 << (n - 1);
    });
    return m;
  };
  const STATIC_PH = { layer: 1, mask: 0xffff, friction: 0.5, bounce: 0, mass: 1e6, vel: null, type: 'static' };
  const canCollide = (a, b) => (a.mask & bitOf(b.layer)) !== 0 && (b.mask & bitOf(a.layer)) !== 0;

  // world box that is only recomputed when the object has moved
  const worldBoxOf = (o) => {
    const u = o.userData;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements;
    let c = u._pc;
    if (c) {
      let same = true;
      for (let i = 0; i < 16; i++) {
        if (c.sig[i] !== e[i]) {
          same = false;
          break;
        }
      }
      if (same) return c.box;
    } else c = u._pc = { box: new THREE.Box3(), sig: new Float64Array(16) };
    c.box.setFromObject(o);
    for (let i = 0; i < 16; i++) c.sig[i] = e[i];
    return c.box;
  };

  const physGrid = { cell: 4, map: new Map(), big: [], stamp: 0 };
  const gridKey = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;

  const gridAdd = (rec) => {
    const c = physGrid.cell;
    const x0 = Math.floor(rec.min[0] / c);
    const x1 = Math.floor(rec.max[0] / c);
    const y0 = Math.floor(rec.min[1] / c);
    const y1 = Math.floor(rec.max[1] / c);
    const z0 = Math.floor(rec.min[2] / c);
    const z1 = Math.floor(rec.max[2] / c);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64) {
      physGrid.big.push(rec);
      return;
    }
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const k = gridKey(x, y, z);
          let cell = physGrid.map.get(k);
          if (!cell) physGrid.map.set(k, (cell = []));
          cell.push(rec);
        }
      }
    }
  };

  const gridQuery = (min, max, out) => {
    const c = physGrid.cell;
    physGrid.stamp++;
    const st = physGrid.stamp;
    const x0 = Math.floor(min[0] / c);
    const x1 = Math.floor(max[0] / c);
    const y0 = Math.floor(min[1] / c);
    const y1 = Math.floor(max[1] / c);
    const z0 = Math.floor(min[2] / c);
    const z1 = Math.floor(max[2] / c);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const cell = physGrid.map.get(gridKey(x, y, z));
          if (!cell) continue;
          for (let i = 0; i < cell.length; i++) {
            const r = cell[i];
            if (r.stamp !== st) {
              r.stamp = st;
              out.push(r);
            }
          }
        }
      }
    }
    for (let i = 0; i < physGrid.big.length; i++) {
      const r = physGrid.big[i];
      if (r.stamp !== st) {
        r.stamp = st;
        out.push(r);
      }
    }
  };

  const recordFor = (o, kind) => {
    const u = o.userData;
    let r = u._pr;
    if (!r) r = u._pr = { o, min: [0, 0, 0], max: [0, 0, 0], ph: STATIC_PH, kind, stamp: 0, name: u.name };
    const b = worldBoxOf(o);
    r.min[0] = b.min.x;
    r.min[1] = b.min.y;
    r.min[2] = b.min.z;
    r.max[0] = b.max.x;
    r.max[1] = b.max.y;
    r.max[2] = b.max.z;
    r.ph = u.phys || STATIC_PH;
    r.kind = kind;
    r.name = u.name;
    return r;
  };

  const AX = ['x', 'y', 'z'];
  const physTmp = { cands: [], contacts: new Set(), pbox: null };

  const overlapsBox = (bmin, bmax, r) =>
    bmin[0] < r.max[0] && bmax[0] > r.min[0] && bmin[1] < r.max[1] && bmax[1] > r.min[1] && bmin[2] < r.max[2] && bmax[2] > r.min[2];

  const exchange = (p, other, ax, otherMass, otherVel) => {
    const m1 = Math.max(p.mass, 0.0001);
    const m2 = Math.max(otherMass, 0.0001);
    const v1 = p.vel[ax];
    const v2 = otherVel;
    const e = Math.min(p.bounce, other ? other.bounce : 0);
    const nv1 = (m1 * v1 + m2 * v2 + m2 * e * (v2 - v1)) / (m1 + m2);
    const nv2 = (m1 * v1 + m2 * v2 + m1 * e * (v1 - v2)) / (m1 + m2);
    p.vel[ax] = nv1;
    if (other && other.vel && other.type === 'dynamic') other.vel[ax] = nv2;
  };

  const terrainFloor = (terrains, x, z) => {
    let best = -Infinity;
    for (let i = 0; i < terrains.length; i++) {
      const h = terrainHeightAt(terrains[i], x, z);
      if (h > best) best = h;
    }
    return best;
  };

  const stepBodyBox = (o, p, dt, dynamics, terrains, playerRec) => {
    const box = worldBoxOf(o);
    const hx = (box.max.x - box.min.x) / 2;
    const hy = (box.max.y - box.min.y) / 2;
    const hz = (box.max.z - box.min.z) / 2;
    if (!(hx > 0 || hy > 0 || hz > 0)) return;
    const ox = (box.max.x + box.min.x) / 2 - o.position.x;
    const oy = (box.max.y + box.min.y) / 2 - o.position.y;
    const oz = (box.max.z + box.min.z) / 2 - o.position.z;
    const half = [hx, hy, hz];
    const off = [ox, oy, oz];
    const small = Math.max(0.05, Math.min(hx, hy, hz));
    const speed = Math.max(Math.abs(p.vel.x), Math.abs(p.vel.y), Math.abs(p.vel.z));
    const subs = xClamp(Math.ceil((speed * dt) / (small * 0.8)), 1, 8);
    const sdt = dt / subs;
    const bmin = [0, 0, 0];
    const bmax = [0, 0, 0];
    const cands = physTmp.cands;
    p.grounded = false;
    for (let s = 0; s < subs; s++) {
      for (let ai = 0; ai < 3; ai++) {
        const ax = AX[ai];
        if (p.fp[ai]) {
          p.vel[ax] = 0;
          continue;
        }
        const d = p.vel[ax] * sdt;
        if (d === 0) continue;
        o.position[ax] += d;
        for (let k = 0; k < 3; k++) {
          bmin[k] = o.position[AX[k]] + off[k] - half[k];
          bmax[k] = o.position[AX[k]] + off[k] + half[k];
        }
        cands.length = 0;
        gridQuery(bmin, bmax, cands);
        for (let i = 0; i < dynamics.length; i++) if (dynamics[i].o !== o) cands.push(dynamics[i]);
        if (playerRec) cands.push(playerRec);
        for (let i = 0; i < cands.length; i++) {
          const r = cands[i];
          if (!canCollide(p, r.ph)) continue;
          if (!overlapsBox(bmin, bmax, r)) continue;
          let push;
          if (d > 0) push = r.min[ai] - bmax[ai];
          else push = r.max[ai] - bmin[ai];
          o.position[ax] += push;
          bmin[ai] += push;
          bmax[ai] += push;
          physTmp.contacts.add(r.name);
          if (r.kind === 'body' || r.kind === 'player') {
            const ov = r.kind === 'player' ? [player.vx, player.vy, player.vz][ai] : r.ph.vel[ax];
            exchange(p, r.ph, ax, r.kind === 'player' ? 60 : r.ph.mass, ov);
          } else {
            const vn = p.vel[ax];
            const e = Math.max(p.bounce, r.ph.bounce);
            p.vel[ax] = Math.abs(vn) > 1.2 ? -vn * e : 0;
            if (ai === 1 && d < 0) {
              p.grounded = true;
              p.groundFriction = r.ph.friction;
            }
          }
        }
        if (ai === 1 && terrains.length) {
          const fy = (() => {
            let m = -Infinity;
            const px = o.position.x + ox;
            const pz = o.position.z + oz;
            [[0, 0], [hx, hz], [-hx, hz], [hx, -hz], [-hx, -hz]].forEach(([a, b]) => {
              m = Math.max(m, terrainFloor(terrains, px + a, pz + b));
            });
            return m;
          })();
          const bottom = o.position.y + oy - hy;
          if (isFinite(fy) && bottom < fy && p.vel.y <= 0) {
            o.position.y += fy - bottom;
            const vn = p.vel.y;
            p.vel.y = Math.abs(vn) > 1.2 ? -vn * p.bounce : 0;
            p.grounded = true;
            p.groundFriction = 0.6;
            physTmp.contacts.add('terrain');
          }
        }
      }
    }
  };

  const stepBodySphere = (o, p, dt, dynamics, terrains, playerRec) => {
    const box = worldBoxOf(o);
    const rad3 = ((box.max.x - box.min.x) + (box.max.y - box.min.y) + (box.max.z - box.min.z)) / 6;
    if (!(rad3 > 0)) return;
    const cOff = new THREE.Vector3().copy(box.min).add(box.max).multiplyScalar(0.5).sub(o.position);
    const speed = p.vel.length();
    const subs = xClamp(Math.ceil((speed * dt) / (rad3 * 0.8)), 1, 8);
    const sdt = dt / subs;
    const c = new THREE.Vector3();
    const bmin = [0, 0, 0];
    const bmax = [0, 0, 0];
    const cands = physTmp.cands;
    p.grounded = false;
    for (let s = 0; s < subs; s++) {
      for (let ai = 0; ai < 3; ai++) if (p.fp[ai]) p.vel[AX[ai]] = 0;
      o.position.addScaledVector(p.vel, sdt);
      c.copy(o.position).add(cOff);
      bmin[0] = c.x - rad3;
      bmin[1] = c.y - rad3;
      bmin[2] = c.z - rad3;
      bmax[0] = c.x + rad3;
      bmax[1] = c.y + rad3;
      bmax[2] = c.z + rad3;
      cands.length = 0;
      gridQuery(bmin, bmax, cands);
      for (let i = 0; i < dynamics.length; i++) if (dynamics[i].o !== o) cands.push(dynamics[i]);
      if (playerRec) cands.push(playerRec);
      for (let i = 0; i < cands.length; i++) {
        const r = cands[i];
        if (!canCollide(p, r.ph)) continue;
        if (!overlapsBox(bmin, bmax, r)) continue;
        const qx = xClamp(c.x, r.min[0], r.max[0]);
        const qy = xClamp(c.y, r.min[1], r.max[1]);
        const qz = xClamp(c.z, r.min[2], r.max[2]);
        let nx = c.x - qx;
        let ny = c.y - qy;
        let nz = c.z - qz;
        let dist = Math.hypot(nx, ny, nz);
        if (dist >= rad3) continue;
        let pen;
        if (dist < 1e-6) {
          // center is inside the box, leave through the nearest face
          const ds = [c.x - r.min[0], r.max[0] - c.x, c.y - r.min[1], r.max[1] - c.y, c.z - r.min[2], r.max[2] - c.z];
          let bi = 0;
          for (let k = 1; k < 6; k++) if (ds[k] < ds[bi]) bi = k;
          nx = ny = nz = 0;
          if (bi === 0) nx = -1;
          else if (bi === 1) nx = 1;
          else if (bi === 2) ny = -1;
          else if (bi === 3) ny = 1;
          else if (bi === 4) nz = -1;
          else nz = 1;
          pen = ds[bi] + rad3;
        } else {
          nx /= dist;
          ny /= dist;
          nz /= dist;
          pen = rad3 - dist;
        }
        o.position.x += nx * pen;
        o.position.y += ny * pen;
        o.position.z += nz * pen;
        c.copy(o.position).add(cOff);
        physTmp.contacts.add(r.name);
        const vn = p.vel.x * nx + p.vel.y * ny + p.vel.z * nz;
        if (vn < 0) {
          if (r.kind === 'body' || r.kind === 'player') {
            const ax = Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz) ? 'x' : Math.abs(ny) > Math.abs(nz) ? 'y' : 'z';
            const ai = AX.indexOf(ax);
            exchange(p, r.ph, ax, r.kind === 'player' ? 60 : r.ph.mass, r.kind === 'player' ? [player.vx, player.vy, player.vz][ai] : r.ph.vel[ax]);
          } else {
            const e = Math.abs(vn) > 1.2 ? Math.max(p.bounce, r.ph.bounce) : 0;
            const k = (1 + e) * vn;
            p.vel.x -= k * nx;
            p.vel.y -= k * ny;
            p.vel.z -= k * nz;
          }
        }
        if (ny > 0.6) {
          p.grounded = true;
          p.groundFriction = r.ph.friction;
        }
      }
      if (terrains.length) {
        const fy = terrainFloor(terrains, c.x, c.z);
        if (isFinite(fy) && c.y - rad3 < fy && p.vel.y <= 0) {
          o.position.y += fy + rad3 - c.y;
          const vn = p.vel.y;
          p.vel.y = Math.abs(vn) > 1.2 ? -vn * p.bounce : 0;
          p.grounded = true;
          p.groundFriction = 0.6;
          physTmp.contacts.add('terrain');
        }
      }
    }
  };

  const stepPhysics = (dt) => {
    if (!physWorld.on || dt <= 0) return;
    const bodies = [];
    const triggers = [];
    const kinematics = [];
    const terrains = [];
    physGrid.map.clear();
    physGrid.big.length = 0;
    const dynRecs = [];
    for (const o of objects.values()) {
      const u = o.userData;
      if (o.isLight || u.enabled === false) continue;
      const p = u.phys;
      if (p) {
        if (!p.enabled) continue;
        if (p.trigger) {
          triggers.push(o);
          continue;
        }
        if (p.type === 'dynamic') {
          if (o.parent === scene) bodies.push(o);
          continue;
        }
        if (p.type === 'kinematic') kinematics.push(o);
      }
      if (!o.visible || u.solid === false) continue;
      if (u.terrain) {
        terrains.push(o);
        continue;
      }
      const b = worldBoxOf(o);
      if (b.isEmpty()) continue;
      gridAdd(recordFor(o, 'static'));
    }
    if (!bodies.length && !triggers.length) return;

    // kinematic bodies move by their own velocity, nothing pushes them
    kinematics.forEach((o) => {
      const p = o.userData.phys;
      o.position.addScaledVector(p.vel, dt);
      for (let i = 0; i < 3; i++) if (!p.fr[i]) o.rotation[AX[i]] += p.ang[AX[i]] * dt;
    });

    // player as a collider for the bodies
    let playerRec = null;
    if (player.mode === 'fp') {
      const pb = playerBox();
      if (!physTmp.pbox) physTmp.pbox = { o: null, min: [0, 0, 0], max: [0, 0, 0], ph: { layer: 1, mask: 0xffff, friction: 0.5, bounce: 0, mass: 60, vel: null, type: 'player' }, kind: 'player', stamp: 0, name: 'player' };
      playerRec = physTmp.pbox;
      playerRec.min = [pb.min.x, pb.min.y, pb.min.z];
      playerRec.max = [pb.max.x, pb.max.y, pb.max.z];
    }

    bodies.forEach((o) => {
      const p = o.userData.phys;
      const bd = recordFor(o, 'body');
      dynRecs.push(bd);
    });

    bodies.forEach((o) => {
      const p = o.userData.phys;
      physTmp.contacts = new Set();
      // forces
      if (p.gravity) p.vel.y -= physWorld.gravity * dt;
      p.vel.addScaledVector(p.force, dt / Math.max(p.mass, 0.0001));
      p.force.set(0, 0, 0);
      p.vel.multiplyScalar(Math.max(0, 1 - p.linDamp * dt));
      p.ang.addScaledVector(p.torque, dt / Math.max(p.mass, 0.0001));
      p.torque.set(0, 0, 0);
      p.ang.multiplyScalar(Math.max(0, 1 - p.angDamp * dt));
      for (let i = 0; i < 3; i++) {
        if (p.fp[i]) p.vel[AX[i]] = 0;
        if (p.fr[i]) p.ang[AX[i]] = 0;
      }
      if (p.collider === 'sphere') stepBodySphere(o, p, dt, dynRecs, terrains, playerRec);
      else stepBodyBox(o, p, dt, dynRecs, terrains, playerRec);
      // sliding friction on whatever it is standing on
      if (p.grounded) {
        const k = Math.max(0, 1 - (p.friction + p.groundFriction) * 5 * dt);
        p.vel.x *= k;
        p.vel.z *= k;
      }
      for (let i = 0; i < 3; i++) if (!p.fr[i]) o.rotation[AX[i]] += p.ang[AX[i]] * dt;
      // collision events (only the first frame of a new contact)
      physTmp.contacts.forEach((n) => {
        if (!p.touching.has(n)) {
          fireEvent('collided', o.userData.name, n);
          firePair('collide', o.userData.name, n);
          if (n !== 'terrain' && n !== 'player') {
            const other = objects.get(n);
            if (other && other.userData.phys) firePair('collide', n, o.userData.name);
          }
        }
      });
      p.touching = physTmp.contacts;
      o.updateMatrixWorld(true);
    });

    // triggers
    if (triggers.length) {
      const bodyBoxes = bodies.map((o) => ({ name: o.userData.name, box: worldBoxOf(o), ph: o.userData.phys }));
      if (playerRec) bodyBoxes.push({ name: 'player', box: new THREE.Box3(new THREE.Vector3().fromArray(playerRec.min), new THREE.Vector3().fromArray(playerRec.max)), ph: { layer: 1, mask: 0xffff } });
      triggers.forEach((t) => {
        const tp = t.userData.phys;
        const tb = worldBoxOf(t);
        if (tb.isEmpty()) return;
        const now = new Set();
        bodyBoxes.forEach((b) => {
          if (b.name === t.userData.name) return;
          if (!canCollide(tp, b.ph)) return;
          if (tb.intersectsBox(b.box)) now.add(b.name);
        });
        now.forEach((n) => {
          if (!tp.inside.has(n)) {
            fireEvent('entered trigger', t.userData.name, n);
            firePair('enter', n, t.userData.name);
          }
        });
        tp.inside.forEach((n) => {
          if (!now.has(n)) {
            fireEvent('left trigger', t.userData.name, n);
            firePair('leave', n, t.userData.name);
          }
        });
        tp.inside = now;
      });
    }
  };

  // helpers for the blocks
  const physOf = (name) => {
    const o = getObj(name) || targetsOf(name)[0];
    return o ? o.userData.phys : null;
  };

  // ===================================================================
  // v12 player styles, controller, camera rig and camera effects
  // ===================================================================

  const PLAYER_BASE = {
    walkSpeed: 4,
    sprint: 1.8,
    jump: 1.2,
    gravity: 22,
    accel: 70,
    friction: 90,
    airAccel: 70,
    airFriction: 70,
    edge: 0.2,
    eye: 1.7,
    radius: 0.35,
    step: 0.5,
    crouchSpeed: 0.5,
    crouchEye: 1.1,
    crouchSmooth: 14,
    slide: 0,
    slideBoost: 1.25,
    slideTime: 0.9,
    slideFriction: 3.5,
    airJumps: 0,
    wallJump: 0,
    wallKick: 6,
    jumpCut: 1,
    coyoteTime: 0.12,
    jumpBuffer: 0.12,
    bob: 0,
    bobSpeed: 1,
    sprintFov: 0,
    slideFov: 0,
    fovSmooth: 8,
    lean: 0,
    leanSmooth: 8,
    landShake: 0,
    landDip: 0,
    sprintShake: 0,
    slideShake: 0,
    fallY: -100
  };

  const PLAYER_STYLES = {
    basic: {},
    parkour: {
      walkSpeed: 5.2, sprint: 1.7, jump: 1.15, gravity: 26, accel: 45, friction: 22, airAccel: 14, airFriction: 0,
      edge: 0.25, step: 0.45, crouchSpeed: 0.55, slide: 1, slideBoost: 1.2, slideTime: 1, slideFriction: 3.2,
      wallJump: 1, wallKick: 7, coyoteTime: 0.14, jumpBuffer: 0.14, bob: 0.045, bobSpeed: 1.1, sprintFov: 12,
      slideFov: 14, lean: 2.2, landShake: 0.9, landDip: 0.12, sprintShake: 0.12, slideShake: 0.6
    },
    arcade: {
      walkSpeed: 6, sprint: 1.5, jump: 1.4, gravity: 30, accel: 120, friction: 140, airAccel: 120, airFriction: 100,
      jumpCut: 0.5, sprintFov: 6, fovSmooth: 12
    },
    realistic: {
      walkSpeed: 3.2, sprint: 1.7, jump: 0.55, accel: 16, friction: 22, airAccel: 3, airFriction: 1, crouchSpeed: 0.45,
      bob: 0.03, bobSpeed: 0.9, landDip: 0.1, landShake: 0.35, sprintShake: 0.05, sprintFov: 4
    },
    moon: {
      walkSpeed: 4.5, sprint: 1.6, jump: 3.2, gravity: 5, accel: 18, friction: 10, airAccel: 6, airFriction: 0.5,
      landDip: 0.15, bob: 0.02, bobSpeed: 0.6
    },
    stealth: {
      walkSpeed: 2.2, sprint: 1.5, jump: 0.9, accel: 40, friction: 60, airAccel: 20, airFriction: 20, crouchSpeed: 0.55,
      crouchEye: 1, bob: 0.015
    },
    platformer: {
      walkSpeed: 5, sprint: 1.5, jump: 1.8, gravity: 34, accel: 60, friction: 55, airAccel: 40, airFriction: 8,
      airJumps: 1, jumpCut: 0.45, coyoteTime: 0.15, jumpBuffer: 0.15,
      rig: { mode: 'third', dist: 4.5, height: 1.5, shoulder: 0, smooth: 12 }
    }
  };

  const RIG_BASE = {
    mode: 'first',
    target: '',
    dist: 4,
    height: 1.6,
    shoulder: 0,
    smooth: 0,
    collide: 1,
    pitch: -55,
    yaw: 0,
    body: '',
    faceMove: 1,
    turnSpeed: 14,
    hideBody: 1,
    fixedPos: null
  };
  const rig = Object.assign({}, RIG_BASE);
  let playerStyleName = 'basic';

  Object.assign(player, PLAYER_BASE);
  player.keys.crouch = 'c';
  Object.assign(player, {
    eyeNow: PLAYER_BASE.eye,
    crouched: false,
    sliding: false,
    slideLeft: 0,
    jumpsLeft: 0,
    jumpWas: false,
    crouchWas: false,
    jumping: false,
    wallCool: 0,
    lastImpact: 0,
    bobPhase: 0,
    sprinting: false
  });

  const applyPlayerStyle = (name) => {
    const n = str(name);
    const def = PLAYER_STYLES[n];
    if (!def) return false;
    Object.assign(player, PLAYER_BASE);
    Object.assign(rig, RIG_BASE, { body: rig.body, target: rig.target });
    Object.keys(def).forEach((k) => {
      if (k === 'rig') Object.assign(rig, def.rig);
      else player[k] = def[k];
    });
    player.eyeNow = player.eye;
    player.sliding = false;
    player.crouched = false;
    playerStyleName = n;
    syncRigMouse();
    return true;
  };

  // third person, top down, side view and fixed cameras follow the player (or any object)
  const syncRigMouse = () => {
    if (player.mode !== 'fp') return;
    const free = rig.mode === 'first' || rig.mode === 'third';
    mouseLook = free;
    if (!free && document.pointerLockElement) document.exitPointerLock();
  };

  // ---- projection and cameras ----
  let fovBase = 70;
  let perspCam = null;
  let orthoCam = null;
  let projection = 'perspective';
  let orthoSize = 10;

  const applyProjection = () => {
    if (!camera) return;
    const asp = lastW && lastH ? lastW / lastH : 4 / 3;
    if (projection === 'orthographic') {
      orthoCam.left = -orthoSize * asp;
      orthoCam.right = orthoSize * asp;
      orthoCam.top = orthoSize;
      orthoCam.bottom = -orthoSize;
      orthoCam.updateProjectionMatrix();
    } else {
      perspCam.aspect = asp;
      perspCam.fov = xClamp(fovBase + fx.fovAdd, 10, 150);
      perspCam.updateProjectionMatrix();
    }
  };

  const setProjection = (mode) => {
    const want = str(mode) === 'orthographic' ? 'orthographic' : 'perspective';
    if (want === projection) return;
    if (!orthoCam) {
      orthoCam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
      orthoCam.rotation.order = 'YXZ';
    }
    const from = camera;
    const to = want === 'orthographic' ? orthoCam : perspCam;
    to.position.copy(from.position);
    to.rotation.copy(from.rotation);
    to.near = from.near;
    to.far = from.far;
    camera = to;
    projection = want;
    if (tc) tc.camera = camera;
    applyProjection();
  };

  const savedCameras = new Map();
  const saveCameraAs = (name) => {
    savedCameras.set(str(name), {
      pos: camera.position.clone(),
      yaw: camYaw,
      pitch: camPitch,
      fov: fovBase,
      projection,
      size: orthoSize
    });
  };
  const useCamera = (name) => {
    const c = savedCameras.get(str(name));
    if (!c) return false;
    setProjection(c.projection);
    camera.position.copy(c.pos);
    camYaw = c.yaw;
    camPitch = c.pitch;
    fovBase = c.fov;
    orthoSize = c.size;
    applyProjection();
    updateCamera();
    return true;
  };

  // ---- camera effects (shake, bob, roll, fov kick) ----
  const fx = {
    shakes: [],
    applied: null,
    fovAdd: 0,
    roll: 0,
    bobX: 0,
    bobY: 0,
    dip: 0,
    sustain: 0,
    pitchOff: 0,
    yawOff: 0,
    rollOff: 0
  };

  const addShake = (amp, dur, freq) => {
    if (!(amp > 0) || !(dur > 0)) return;
    fx.shakes.push({ amp, dur, t: 0, freq: freq || 14, ph: Math.random() * 100 });
    if (fx.shakes.length > 16) fx.shakes.shift();
  };

  const wob = (t, ph) => Math.sin(t + ph) + 0.5 * Math.sin(t * 2.3 + ph * 1.7) + 0.25 * Math.sin(t * 4.1 + ph * 0.6);

  const removeCamFx = () => {
    if (!fx.applied) fx.applied = new THREE.Vector3();
    camera.position.sub(fx.applied);
    fx.applied.set(0, 0, 0);
  };

  const applyCamFx = (dt) => {
    if (!fx.applied) fx.applied = new THREE.Vector3();
    let ax = 0;
    let ay = 0;
    let az = 0;
    let rp = 0;
    let ry = 0;
    let rr = 0;
    const clockT = TM.time;
    const sample = (amp, freq, ph) => {
      const t = clockT * freq;
      ax += wob(t, ph) * amp * 0.03;
      ay += wob(t + 11, ph) * amp * 0.03;
      az += wob(t + 23, ph) * amp * 0.012;
      rp += wob(t + 5, ph) * amp * 0.35;
      ry += wob(t + 17, ph) * amp * 0.35;
      rr += wob(t + 29, ph) * amp * 0.45;
    };
    for (let i = fx.shakes.length - 1; i >= 0; i--) {
      const s = fx.shakes[i];
      s.t += dt;
      if (s.t >= s.dur) {
        fx.shakes.splice(i, 1);
        continue;
      }
      const k = 1 - s.t / s.dur;
      sample(s.amp * k * k, s.freq, s.ph);
    }
    if (fx.sustain > 0.001) sample(fx.sustain, 9, 3.3);
    // views offset in camera space (so bob follows where you look)
    const yaw = rad(camYaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const sideOff = ax + fx.bobX;
    const upOff = ay + fx.bobY - fx.dip;
    fx.applied.set(rx * sideOff, upOff, rz * sideOff + az);
    camera.position.add(fx.applied);
    fx.pitchOff = rp;
    fx.yawOff = ry;
    fx.rollOff = rr;
    camera.rotation.set(rad(camPitch + rp), rad(camYaw + ry), rad(fx.roll + rr));
    if (projection === 'perspective') {
      const want = xClamp(fovBase + fx.fovAdd, 10, 150);
      if (Math.abs(perspCam.fov - want) > 0.01) {
        perspCam.fov = want;
        perspCam.updateProjectionMatrix();
      }
    }
  };

  // ---- the controller ----
  const worldLimits = { on: false, min: [-100, -100, -100], max: [100, 100, 100] };

  const stepPlayer = (dt) => {
    const p = player;
    const k = p.keys;
    let f = (keyDown(k.forward) ? 1 : 0) - (keyDown(k.back) ? 1 : 0);
    let r = (keyDown(k.right) ? 1 : 0) - (keyDown(k.left) ? 1 : 0);
    if (rig.mode === 'side') f = 0;
    const len = Math.hypot(f, r);
    if (len > 0) {
      f /= len;
      r /= len;
    }
    const sprintHeld = keyDown(k.sprint);
    const crouchHeld = keyDown(k.crouch);
    const jumpHeld = keyDown(k.jump);
    const jumpPressed = jumpHeld && !p.jumpWas;
    const crouchPressed = crouchHeld && !p.crouchWas;
    p.jumpWas = jumpHeld;
    p.crouchWas = crouchHeld;
    const wasOnGround = p.onGround;
    const vyBefore = p.vy;
    const yaw = rad(camYaw);

    // sliding: sprint, then press crouch
    const speedNow = Math.hypot(p.vx, p.vz);
    if (p.slide > 0 && !p.sliding && p.onGround && crouchPressed && speedNow > p.walkSpeed * 0.9) {
      p.sliding = true;
      p.slideLeft = p.slideTime;
      const sp = Math.max(speedNow, p.walkSpeed * p.sprint) * p.slideBoost;
      p.vx = (p.vx / speedNow) * sp;
      p.vz = (p.vz / speedNow) * sp;
      addShake(p.slideShake, 0.3, 16);
      fireEvent('slide started');
    }
    if (p.sliding) {
      p.slideLeft -= dt;
      if (!p.onGround || p.slideLeft <= 0 || Math.hypot(p.vx, p.vz) < p.walkSpeed * p.crouchSpeed || !crouchHeld || jumpPressed) {
        p.sliding = false;
      }
    }

    // crouching (you stay down while something is above your head)
    let wantCrouch = crouchHeld || p.sliding;
    if (p.crouched && !wantCrouch) {
      const up = castRay(
        new THREE.Vector3(p.pos.x, p.pos.y + p.crouchEye, p.pos.z),
        new THREE.Vector3(0, 1, 0),
        Math.max(0, p.eye + 0.1 - p.crouchEye)
      );
      if (up) wantCrouch = true;
    }
    p.crouched = wantCrouch;
    const eyeTarget = p.sliding ? Math.min(p.crouchEye * 0.65, p.eye) : p.crouched ? Math.min(p.crouchEye, p.eye) : p.eye;
    p.eyeNow += (eyeTarget - p.eyeNow) * (1 - Math.exp(-p.crouchSmooth * dt));

    // horizontal movement
    p.sprinting = sprintHeld && !p.crouched && len > 0;
    const speed = p.walkSpeed * (sprintHeld && !p.crouched ? p.sprint : 1) * (p.crouched && !p.sliding ? p.crouchSpeed : 1);
    if (!p.sliding) {
      const targetX = (-Math.sin(yaw) * f + Math.cos(yaw) * r) * speed;
      const targetZ = (-Math.cos(yaw) * f - Math.sin(yaw) * r) * speed;
      const deltaX = targetX - p.vx;
      const deltaZ = targetZ - p.vz;
      const deltaLength = Math.hypot(deltaX, deltaZ);
      const acceleration = len ? (p.onGround ? p.accel : p.airAccel) : p.onGround ? p.friction : p.airFriction;
      const maxDelta = acceleration * dt;
      if (deltaLength > maxDelta && deltaLength > 0) {
        p.vx += (deltaX / deltaLength) * maxDelta;
        p.vz += (deltaZ / deltaLength) * maxDelta;
      } else {
        p.vx = targetX;
        p.vz = targetZ;
      }
    } else {
      const sp = Math.hypot(p.vx, p.vz);
      const ns = Math.max(0, sp - p.slideFriction * dt);
      if (sp > 0) {
        p.vx *= ns / sp;
        p.vz *= ns / sp;
      }
    }
    const dx = p.vx * dt;
    const dz = p.vz * dt;

    const blocked = (mx, mz) => {
      const l = Math.hypot(mx, mz);
      if (l === 0) return false;
      const dir = new THREE.Vector3(mx / l, 0, mz / l);
      // in the air there is no stepping up, so also check right near the feet
      const heights = p.onGround ? [p.step + 0.1, p.eyeNow * 0.85] : [0.15, p.step + 0.1, p.eyeNow * 0.85];
      for (const h of heights) {
        const o = new THREE.Vector3(p.pos.x, p.pos.y + h, p.pos.z);
        if (castRay(o, dir, p.radius + l)) return true;
      }
      return false;
    };
    if (dx !== 0) {
      if (!blocked(dx, 0)) p.pos.x += dx;
      else p.vx = 0;
    }
    if (dz !== 0) {
      if (!blocked(0, dz)) p.pos.z += dz;
      else p.vz = 0;
    }

    let groundY = p.floorOn ? p.floorY : -Infinity;
    const probe = (ox, oz) =>
      castRay(
        new THREE.Vector3(p.pos.x + ox, p.pos.y + p.step, p.pos.z + oz),
        new THREE.Vector3(0, -1, 0),
        1000
      );
    const core = p.radius * 0.85;
    for (const [ox, oz] of [[0, 0], [core, 0], [-core, 0], [0, core], [0, -core]]) {
      const hit = probe(ox, oz);
      if (hit && hit.point.y <= p.pos.y + p.step + 0.01) groundY = Math.max(groundY, hit.point.y);
    }
    // edge forgiveness: while standing, look a bit past the body so you
    // can still stand with most of your feet over the edge
    if (p.onGround && !(isFinite(groundY) && groundY >= p.pos.y - 0.02)) {
      const far = p.radius + p.edge;
      const diag = far * 0.8;
      const wide = [[far, 0], [-far, 0], [0, far], [0, -far], [diag, diag], [diag, -diag], [-diag, diag], [-diag, -diag]];
      for (const [ox, oz] of wide) {
        const hit = probe(ox, oz);
        // these never lift you up, they only keep you from falling
        if (hit && hit.point.y <= p.pos.y + 0.02) groundY = Math.max(groundY, hit.point.y);
      }
    }

    // jumping: ground jump (with coyote time and a jump buffer), air jumps, wall jumps
    p.coyote = p.onGround ? p.coyoteTime : Math.max(0, p.coyote - dt);
    p.jumpBuf = jumpHeld ? p.jumpBuffer : Math.max(0, p.jumpBuf - dt);
    p.wallCool = Math.max(0, p.wallCool - dt);
    if (p.onGround) p.jumpsLeft = p.airJumps;
    const jumpSpeed = Math.sqrt(2 * p.gravity * p.jump);
    if ((p.onGround || p.coyote > 0) && p.jumpBuf > 0) {
      p.vy = jumpSpeed;
      p.onGround = false;
      p.coyote = 0;
      p.jumpBuf = 0;
      p.jumping = true;
      fireEvent('jumped', 'ground');
    } else if (!p.onGround && jumpPressed) {
      let didWall = false;
      if (p.wallJump > 0 && p.wallCool <= 0) {
        let best = null;
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
          const hit = castRay(new THREE.Vector3(p.pos.x, p.pos.y + p.eyeNow * 0.5, p.pos.z), dir, p.radius + 0.3);
          if (hit && (!best || hit.distance < best.distance)) best = { distance: hit.distance, dir, hit };
        }
        if (best) {
          const n = best.hit.face
            ? best.hit.face.normal.clone().transformDirection(best.hit.object.matrixWorld)
            : best.dir.clone().negate();
          n.y = 0;
          if (n.lengthSq() < 1e-6) n.copy(best.dir).negate();
          n.normalize();
          p.vx = n.x * p.wallKick + -Math.sin(yaw) * p.walkSpeed * 0.5;
          p.vz = n.z * p.wallKick + -Math.cos(yaw) * p.walkSpeed * 0.5;
          p.vy = jumpSpeed * 0.95;
          p.jumpsLeft = p.airJumps;
          p.wallCool = 0.3;
          p.jumping = true;
          didWall = true;
          addShake(p.landShake * 0.5, 0.25, 15);
          fireEvent('wall jumped');
        }
      }
      if (!didWall && p.jumpsLeft > 0) {
        p.jumpsLeft--;
        p.vy = jumpSpeed;
        p.jumping = true;
        fireEvent('jumped', 'air');
      }
    }
    if (p.jumpCut < 1 && p.jumping && !jumpHeld && p.vy > 0) {
      p.vy *= p.jumpCut;
      p.jumping = false;
    }
    if (p.vy <= 0) p.jumping = false;

    if (p.onGround) {
      if (isFinite(groundY) && p.pos.y - groundY <= p.step + 0.01) {
        p.pos.y = groundY;
        p.vy = 0;
      } else {
        p.onGround = false;
      }
    }
    if (!p.onGround) {
      p.vy -= p.gravity * dt;
      if (p.vy > 0) {
        const head = castRay(
          new THREE.Vector3(p.pos.x, p.pos.y + p.eyeNow, p.pos.z),
          new THREE.Vector3(0, 1, 0),
          p.vy * dt + 0.15
        );
        if (head) p.vy = 0;
      }
      const ny = p.pos.y + p.vy * dt;
      if (p.vy <= 0 && ny <= groundY) {
        p.pos.y = groundY;
        p.vy = 0;
        p.onGround = true;
      } else {
        p.pos.y = ny;
      }
    }

    // landing
    if (!wasOnGround && p.onGround) {
      const impact = Math.max(0, -vyBefore);
      p.lastImpact = impact;
      if (impact > 3) {
        fireEvent('landed', Math.round(impact * 10) / 10);
        addShake(p.landShake * xClamp(impact / 12, 0.2, 1.6), 0.35, 14);
        fx.dip = Math.max(fx.dip, p.landDip * xClamp(impact / 10, 0.2, 1.5));
      }
    }

    // world limits and falling out of the world
    if (worldLimits.on) {
      p.pos.x = xClamp(p.pos.x, worldLimits.min[0], worldLimits.max[0]);
      p.pos.z = xClamp(p.pos.z, worldLimits.min[2], worldLimits.max[2]);
      if (p.pos.y > worldLimits.max[1]) {
        p.pos.y = worldLimits.max[1];
        p.vy = Math.min(0, p.vy);
      }
    }
    const fallY = worldLimits.on ? Math.min(p.fallY, worldLimits.min[1]) : p.fallY;
    if (p.pos.y < fallY) {
      p.pos.copy(p.spawn);
      p.vy = 0;
      p.vx = 0;
      p.vz = 0;
    }
    camera.position.set(p.pos.x, p.pos.y + p.eyeNow, p.pos.z);

    // camera feel
    const hSpeed = Math.hypot(p.vx, p.vz);
    const moving = hSpeed > 0.5;
    if (p.bob > 0 && p.onGround && moving && !p.sliding) {
      p.bobPhase += dt * p.bobSpeed * (3 + hSpeed * 1.1);
      fx.bobY = Math.sin(p.bobPhase * 2) * p.bob;
      fx.bobX = Math.sin(p.bobPhase) * p.bob * 0.6;
    } else {
      const k2 = Math.exp(-10 * dt);
      fx.bobY *= k2;
      fx.bobX *= k2;
    }
    const fovTarget = p.sliding ? p.slideFov : p.sprinting && moving && p.onGround ? p.sprintFov : 0;
    fx.fovAdd += (fovTarget - fx.fovAdd) * (1 - Math.exp(-p.fovSmooth * dt));
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const side = (p.vx * rightX + p.vz * rightZ) / Math.max(1, p.walkSpeed * p.sprint);
    const rollTarget = -side * p.lean;
    fx.roll += (rollTarget - fx.roll) * (1 - Math.exp(-p.leanSmooth * dt));
    const sustainTarget = p.sprintShake > 0 && p.sprinting && moving && p.onGround ? p.sprintShake : p.sliding ? p.slideShake * 0.3 : 0;
    fx.sustain += (sustainTarget - fx.sustain) * (1 - Math.exp(-8 * dt));
    fx.dip *= Math.exp(-9 * dt);
  };

  // follows the player or an object: third person, top down, side view, fixed
  const rigState = { pos: null, init: false };

  const rigPivot = (out) => {
    const target = rig.target ? objects.get(rig.target) : null;
    if (target) {
      target.getWorldPosition(out);
      out.y += rig.height;
    } else {
      playerFeet(out);
      out.y += Math.min(rig.height, player.eyeNow + 0.4);
    }
    return out;
  };

  const stepRig = (dt) => {
    if (!rigState.pos) rigState.pos = new THREE.Vector3();
    const mode = rig.mode;
    // the body object stands where the player stands
    const body = rig.body ? objects.get(rig.body) : null;
    if (body && !rig.target) {
      body.visible = !(mode === 'first' && rig.hideBody);
      playerFeet(body.position);
      if (rig.faceMove && (mode !== 'first') && player.mode === 'fp') {
        const sp = Math.hypot(player.vx, player.vz);
        if (sp > 0.4) {
          const want = Math.atan2(-player.vx, -player.vz);
          let diff = want - body.rotation.y;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          body.rotation.y += diff * (1 - Math.exp(-rig.turnSpeed * dt));
        }
      }
    }
    if (mode === 'first' && !rig.target) return;
    if (mode === 'first') {
      // looking out of an object
      const t = objects.get(rig.target);
      if (t) {
        t.getWorldPosition(camera.position);
        camera.position.y += rig.height;
      }
      return;
    }
    const pivot = rigPivot(new THREE.Vector3());
    const desired = new THREE.Vector3();
    if (mode === 'third') {
      const yaw = rad(camYaw);
      const pitch = rad(camPitch);
      const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      desired.copy(pivot).addScaledVector(fwd, -rig.dist).addScaledVector(right, rig.shoulder);
    } else if (mode === 'top') {
      camYaw = rig.yaw;
      camPitch = rig.pitch;
      const yaw = rad(camYaw);
      const pitch = rad(camPitch);
      const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      desired.copy(pivot).addScaledVector(fwd, -rig.dist);
    } else if (mode === 'side') {
      camYaw = rig.yaw;
      camPitch = 0;
      desired.set(pivot.x, pivot.y, pivot.z + rig.dist);
      const yaw = rad(camYaw);
      desired.set(pivot.x + Math.sin(yaw) * rig.dist, pivot.y, pivot.z + Math.cos(yaw) * rig.dist);
    } else if (mode === 'fixed') {
      if (rig.fixedPos) desired.fromArray(rig.fixedPos);
      else desired.copy(camera.position);
      const dx = pivot.x - desired.x;
      const dy = pivot.y - desired.y;
      const dz = pivot.z - desired.z;
      camYaw = deg(Math.atan2(-dx, -dz));
      camPitch = deg(Math.atan2(dy, Math.hypot(dx, dz)));
    }
    // camera collision: pull the camera in front of whatever is in the way
    if (rig.collide && (mode === 'third' || mode === 'top')) {
      const dir = desired.clone().sub(pivot);
      const dist = dir.length();
      if (dist > 0.01) {
        dir.divideScalar(dist);
        const hit = castRay(pivot, dir, dist + 0.2);
        if (hit && hit.object !== body) desired.copy(pivot).addScaledVector(dir, Math.max(0.3, hit.distance - 0.25));
      }
    }
    // the smoothed position lives here, because the controller resets the camera every frame
    if (!rigState.init) rigState.pos.copy(desired);
    else if (rig.smooth > 0) rigState.pos.lerp(desired, 1 - Math.exp(-rig.smooth * dt));
    else rigState.pos.copy(desired);
    camera.position.copy(rigState.pos);
    rigState.init = true;
    camPitch = xClamp(camPitch, -89, 89);
  };

  // ===================================================================
  // v12 audio: Web Audio with channels, buses and 3D positioning
  // ===================================================================

  const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'weba'];
  let actx = null;
  let masterGain = null;
  const auBuses = new Map();
  const sounds = new Map(); // name -> AudioBuffer
  const channels = new Map(); // channel name -> channel
  let auSerial = 0;
  let auMasterVol = 1;

  const auCtx = () => {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      masterGain = actx.createGain();
      masterGain.gain.value = auMasterVol;
      masterGain.connect(actx.destination);
    }
    return actx;
  };

  const auBus = (name) => {
    auCtx();
    const n = str(name).trim() || 'effects';
    if (n === 'master') return { gain: masterGain, vol: auMasterVol, master: true };
    let b = auBuses.get(n);
    if (!b) {
      b = { gain: actx.createGain(), vol: 1, muted: false };
      b.gain.connect(masterGain);
      auBuses.set(n, b);
    }
    return b;
  };

  const auSetBusVolume = (name, v) => {
    const b = auBus(name);
    b.vol = Math.max(0, v);
    if (b.master) {
      auMasterVol = b.vol;
      masterGain.gain.value = b.vol;
    } else b.gain.gain.value = b.muted ? 0 : b.vol;
  };

  const auPause = (p) => {
    if (!actx) return;
    if (p) actx.suspend().catch(() => {});
    else actx.resume().catch(() => {});
  };

  const loadSound = async (name, source) => {
    const s = str(source).trim();
    const label = str(name).trim() || s;
    if (sounds.has(label)) return true;
    let data = null;
    const a = readAssets()[s];
    if (a && a.type === 'audio') data = dataURLToBuffer(a.data);
    else if (/^(https?:|data:)/i.test(s)) {
      if (!(await Scratch.canFetch(s))) return false;
      const res = await fetch(s);
      if (!res.ok) throw new Error('download failed (' + res.status + ')');
      data = await res.arrayBuffer();
    } else return false;
    const buf = await auCtx().decodeAudioData(data);
    sounds.set(label, buf);
    return true;
  };

  const chanPos = (ch, out) => {
    if (ch.follow) {
      if (isPlayerName(ch.follow)) return out.copy(camera.position);
      const o = objects.get(ch.follow);
      if (o) return o.getWorldPosition(out);
    }
    return out.copy(ch.pos);
  };

  const chanApplySpatial = (ch) => {
    if (!ch.panner) return;
    const p = ch.panner;
    p.refDistance = Math.max(0.01, ch.minDist);
    p.maxDistance = Math.max(ch.minDist + 0.01, ch.maxDist);
    p.rolloffFactor = Math.max(0, ch.rolloff);
    p.distanceModel = ch.falloff;
  };

  const chanStart = (ch, offset) => {
    const ctx = auCtx();
    const src = ctx.createBufferSource();
    src.buffer = ch.buffer;
    src.loop = ch.loop;
    src.playbackRate.value = ch.pitch;
    const serial = ++auSerial;
    ch.serial = serial;
    ch.src = src;
    ch.offset = offset;
    ch.startedAt = ctx.currentTime;
    ch.playing = true;
    ch.paused = false;
    src.connect(ch.gain);
    src.onended = () => {
      if (ch.serial !== serial || ch.paused || !ch.playing) return;
      ch.playing = false;
      fireEvent('sound ended', ch.name, ch.sound);
    };
    src.start(0, Math.min(offset, Math.max(0, ch.buffer.duration - 0.001)));
  };

  const chanTime = (ch) => {
    if (!ch.buffer) return 0;
    if (!ch.playing) return ch.offset;
    const t = ch.offset + (actx.currentTime - ch.startedAt) * ch.pitch;
    return ch.loop ? t % ch.buffer.duration : Math.min(t, ch.buffer.duration);
  };

  const chanKill = (ch) => {
    ch.serial = -1;
    ch.playing = false;
    try {
      if (ch.src) {
        ch.src.onended = null;
        ch.src.stop();
        ch.src.disconnect();
      }
      ch.gain.disconnect();
      if (ch.panner) ch.panner.disconnect();
    } catch (e) {
      /* already stopped */
    }
  };

  // opts: channel, bus, vol, pitch, loop, at [x,y,z], follow, fadeIn
  const playSound = (soundName, opts) => {
    const buf = sounds.get(str(soundName));
    if (!buf) return null;
    const o = opts || {};
    const ctx = auCtx();
    const name = o.channel ? str(o.channel) : 'sound ' + ++auSerial;
    const old = channels.get(name);
    if (old) chanKill(old);
    const ch = {
      name,
      sound: str(soundName),
      buffer: buf,
      bus: o.bus || 'effects',
      vol: o.vol === undefined ? 1 : o.vol,
      pitch: o.pitch || 1,
      loop: !!o.loop,
      follow: o.follow || '',
      pos: new THREE.Vector3(),
      spatial: !!(o.at || o.follow),
      minDist: 2,
      maxDist: 50,
      rolloff: 1,
      falloff: 'inverse',
      pan: 0,
      gain: ctx.createGain(),
      panner: null,
      stereo: null,
      src: null,
      offset: 0,
      startedAt: 0,
      playing: false,
      paused: false,
      serial: 0
    };
    if (o.at) ch.pos.set(o.at[0], o.at[1], o.at[2]);
    ch.gain.gain.value = o.fadeIn ? 0 : ch.vol;
    if (ch.spatial) {
      ch.panner = ctx.createPanner();
      ch.panner.panningModel = 'HRTF';
      chanApplySpatial(ch);
      ch.gain.connect(ch.panner);
      ch.panner.connect(auBus(ch.bus).gain);
      const p = chanPos(ch, new THREE.Vector3());
      if (ch.panner.positionX) {
        ch.panner.positionX.value = p.x;
        ch.panner.positionY.value = p.y;
        ch.panner.positionZ.value = p.z;
      }
    } else {
      ch.stereo = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (ch.stereo) {
        ch.gain.connect(ch.stereo);
        ch.stereo.connect(auBus(ch.bus).gain);
      } else ch.gain.connect(auBus(ch.bus).gain);
    }
    channels.set(name, ch);
    chanStart(ch, 0);
    if (o.fadeIn) ch.gain.gain.linearRampToValueAtTime(ch.vol, ctx.currentTime + o.fadeIn);
    return ch;
  };

  const chanFade = (ch, vol, secs, stopAfter) => {
    const ctx = auCtx();
    const g = ch.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(Math.max(0, vol), ctx.currentTime + Math.max(0.01, secs));
    ch.vol = Math.max(0, vol);
    if (stopAfter) {
      const serial = ch.serial;
      setTimeout(() => {
        if (ch.serial === serial) chanStopNow(ch);
      }, secs * 1000 + 30);
    }
  };

  const chanStopNow = (ch) => {
    chanKill(ch);
    ch.offset = 0;
    channels.delete(ch.name);
  };

  const chanTargets = (name) => {
    const n = str(name);
    if (n === 'all') return Array.from(channels.values());
    if (channels.has(n)) return [channels.get(n)];
    if (n.startsWith('bus:')) return Array.from(channels.values()).filter((c) => c.bus === n.slice(4));
    return Array.from(channels.values()).filter((c) => c.sound === n);
  };

  const updateAudio = () => {
    if (!actx) return;
    const L = actx.listener;
    camera.updateMatrixWorld();
    const p = camera.getWorldPosition(new THREE.Vector3());
    const d = camera.getWorldDirection(new THREE.Vector3());
    if (L.positionX) {
      L.positionX.value = p.x;
      L.positionY.value = p.y;
      L.positionZ.value = p.z;
      L.forwardX.value = d.x;
      L.forwardY.value = d.y;
      L.forwardZ.value = d.z;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else if (L.setPosition) {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(d.x, d.y, d.z, 0, 1, 0);
    }
    const tmp = new THREE.Vector3();
    channels.forEach((ch) => {
      if (ch.panner && ch.panner.positionX && (ch.follow || ch.dirty)) {
        chanPos(ch, tmp);
        ch.panner.positionX.value = tmp.x;
        ch.panner.positionY.value = tmp.y;
        ch.panner.positionZ.value = tmp.z;
      }
      if (!ch.playing && !ch.paused) channels.delete(ch.name);
    });
  };

  const stopAllAudio = () => {
    channels.forEach((ch) => chanKill(ch));
    channels.clear();
  };

  // ===================================================================
  // v12 animation (tweens), lights and environment
  // ===================================================================

  let tweens = [];
  let tweenSerial = 0;
  const tweenClear = () => {
    tweens = [];
  };

  const firstOpacity = (o) => {
    const m = materialsOf(o)[0];
    return m ? m.opacity * 100 : 100;
  };

  const OBJ_PROPS = {
    'position x': [(o) => o.position.x, (o, v) => (o.position.x = v)],
    'position y': [(o) => o.position.y, (o, v) => (o.position.y = v)],
    'position z': [(o) => o.position.z, (o, v) => (o.position.z = v)],
    'rotation x': [(o) => deg(o.rotation.x), (o, v) => (o.rotation.x = rad(v))],
    'rotation y': [(o) => deg(o.rotation.y), (o, v) => (o.rotation.y = rad(v))],
    'rotation z': [(o) => deg(o.rotation.z), (o, v) => (o.rotation.z = rad(v))],
    'size x': [(o) => o.scale.x, (o, v) => (o.scale.x = v)],
    'size y': [(o) => o.scale.y, (o, v) => (o.scale.y = v)],
    'size z': [(o) => o.scale.z, (o, v) => (o.scale.z = v)],
    opacity: [
      firstOpacity,
      (o, v) =>
        materialsOf(o).forEach((m) => {
          m.transparent = v < 99.9;
          m.opacity = xClamp(v / 100, 0, 1);
        })
    ],
    'light brightness': [(o) => (o.isLight ? o.intensity : 0), (o, v) => o.isLight && (o.intensity = v)],
    'light range': [(o) => (o.distance !== undefined ? o.distance : 0), (o, v) => o.distance !== undefined && (o.distance = v)]
  };
  const CAM_PROPS = {
    'camera x': [() => camera.position.x, (v) => (camera.position.x = v)],
    'camera y': [() => camera.position.y, (v) => (camera.position.y = v)],
    'camera z': [() => camera.position.z, (v) => (camera.position.z = v)],
    'camera turn': [() => camYaw, (v) => ((camYaw = v), updateCamera())],
    'camera tilt': [() => camPitch, (v) => ((camPitch = v), updateCamera())],
    'field of view': [() => fovBase, (v) => ((fovBase = xClamp(v, 10, 150)), applyProjection())],
    'camera zoom': [() => orthoSize, (v) => ((orthoSize = Math.max(0.1, v)), applyProjection())]
  };

  const tweenProps = () => Object.keys(OBJ_PROPS).concat(Object.keys(CAM_PROPS));

  const tweenStart = (target, prop, to, dur, easing, loop, key) => {
    const p = str(prop);
    const list = [];
    if (CAM_PROPS[p]) list.push({ get: CAM_PROPS[p][0], set: CAM_PROPS[p][1] });
    else if (OBJ_PROPS[p]) {
      targetsOf(target).forEach((o) => list.push({ get: () => OBJ_PROPS[p][0](o), set: (v) => OBJ_PROPS[p][1](o, v), obj: o }));
    }
    if (!list.length) return null;
    const id = str(key).trim() || (CAM_PROPS[p] ? 'camera ' : str(target) + ' ') + p;
    tweens = tweens.filter((t) => t.id !== id);
    const tw = {
      id,
      targets: list,
      from: null,
      to: num(to),
      dur: Math.max(0.001, num(dur)),
      t: 0,
      ease: easeFn(easing),
      loop: str(loop),
      dir: 1,
      speed: 1,
      paused: false,
      done: false
    };
    tweens.push(tw);
    return tw;
  };

  const tweenSelect = (name) => {
    const n = str(name).trim();
    if (n === 'all' || n === '') return tweens.slice();
    return tweens.filter((t) => t.id === n || t.id.startsWith(n + ' '));
  };

  const stepTweens = (dt) => {
    if (!tweens.length) return;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      if (tw.paused || tw.done) continue;
      if (!tw.from) tw.from = tw.targets.map((t) => t.get());
      tw.t += dt * tw.speed * tw.dir;
      let finished = false;
      if (tw.t >= tw.dur) {
        if (tw.loop === 'loop') tw.t -= tw.dur;
        else if (tw.loop === 'ping pong') {
          tw.t = tw.dur - (tw.t - tw.dur);
          tw.dir = -1;
        } else {
          tw.t = tw.dur;
          finished = true;
        }
      } else if (tw.t <= 0) {
        if (tw.loop === 'ping pong') {
          tw.t = -tw.t;
          tw.dir = 1;
        } else if (tw.dir < 0) {
          tw.t = 0;
          finished = true;
        }
      }
      const u = tw.ease(xClamp(tw.t / tw.dur, 0, 1));
      tw.targets.forEach((t, k) => t.set(xLerp(tw.from[k], tw.to, u)));
      if (finished) {
        tw.done = true;
        fireEvent('animation finished', tw.id);
      }
    }
    tweens = tweens.filter((t) => !t.done);
  };

  // ---- lights ----
  const lightToData = (o) => {
    const d = { color: o.color.getHexString(), intensity: o.intensity, cast: !!o.castShadow };
    if (o.isPointLight) {
      d.kind = 'point';
      d.distance = o.distance;
      d.decay = o.decay;
    } else if (o.isSpotLight) {
      d.kind = 'spot';
      d.distance = o.distance;
      d.decay = o.decay;
      d.angle = o.angle;
      d.penumbra = o.penumbra;
    } else if (o.isDirectionalLight) d.kind = 'directional';
    else if (o.isAmbientLight) d.kind = 'ambient';
    else if (o.isHemisphereLight) d.kind = 'ambient';
    return d;
  };

  const makeLightFromData = (d) => {
    const c = new THREE.Color('#' + d.color);
    let l;
    if (d.kind === 'spot') l = new THREE.SpotLight(c, d.intensity, d.distance, d.angle, d.penumbra, d.decay);
    else if (d.kind === 'directional') l = new THREE.DirectionalLight(c, d.intensity);
    else if (d.kind === 'ambient') l = new THREE.AmbientLight(c, d.intensity);
    else l = new THREE.PointLight(c, d.intensity, d.distance, d.decay === undefined ? 2 : d.decay);
    if (l.target) {
      l.target.position.set(0, 0, -1);
      l.add(l.target);
    }
    l.castShadow = !!d.cast && shadowsOn;
    l.userData.light = true;
    return l;
  };

  const lightMultiplier = (kind) => (kind === 'directional' || kind === 'ambient' ? 1 : 40);

  const makeLight = (kind, color, brightness) => {
    const k = str(kind);
    const intensity = num(brightness) * lightMultiplier(k);
    const base = {
      kind: k,
      color: toColor(color).getHexString(),
      intensity,
      distance: 0,
      decay: 2,
      angle: Math.PI / 5,
      penumbra: 0.3,
      cast: false
    };
    return makeLightFromData(base);
  };

  const lightKindOf = (o) => (o.isSpotLight ? 'spot' : o.isDirectionalLight ? 'directional' : o.isAmbientLight ? 'ambient' : 'point');

  const setLightProp = (o, prop, value) => {
    if (!o.isLight) return;
    const k = lightKindOf(o);
    switch (str(prop)) {
      case 'color':
        o.color.copy(toColor(value));
        break;
      case 'brightness':
        o.intensity = Math.max(0, num(value)) * lightMultiplier(k);
        break;
      case 'range':
        if (o.distance !== undefined) o.distance = Math.max(0, num(value));
        break;
      case 'cone angle':
        if (o.angle !== undefined) o.angle = xClamp(rad(num(value)), 0.01, Math.PI / 2);
        break;
      case 'softness':
        if (o.penumbra !== undefined) o.penumbra = xClamp(num(value) / 100, 0, 1);
        break;
      case 'shadows':
        o.castShadow = shadowsOn && (str(value) === 'on' || value === true || str(value) === 'true');
        break;
    }
  };

  const readLightProp = (o, prop) => {
    if (!o.isLight) return 0;
    const k = lightKindOf(o);
    switch (str(prop)) {
      case 'color':
        return xHex(o.color);
      case 'brightness':
        return o.intensity / lightMultiplier(k);
      case 'range':
        return o.distance || 0;
      case 'cone angle':
        return o.angle !== undefined ? deg(o.angle) : 0;
      case 'softness':
        return o.penumbra !== undefined ? o.penumbra * 100 : 0;
      case 'shadows':
        return !!o.castShadow;
    }
    return 0;
  };

  // ---- sky dome (a gradient that follows the camera) ----
  const removeSkyDome = () => {
    const d = scene.userData.skyDome;
    if (!d) return;
    scene.remove(d);
    d.geometry.dispose();
    d.material.dispose();
    scene.userData.skyDome = null;
  };

  const makeSkyDome = (top, horizon, bottom) => {
    removeSkyDome();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: toColor(top) },
        uHorizon: { value: toColor(horizon) },
        uBottom: { value: toColor(bottom) }
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; varying vec3 vDir;' +
        'void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.6)) : mix(uHorizon, uBottom, pow(-h, 0.5));' +
        'gl_FragColor = vec4(c, 1.0); #include <colorspace_fragment> }',
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    scene.add(dome);
    scene.userData.skyDome = dome;
    scene.background = null;
    return dome;
  };

  const updateSkyDome = () => {
    const d = scene.userData.skyDome;
    if (!d) return;
    d.position.copy(camera.position);
    const far = projection === 'orthographic' ? camera.far : camera.far;
    d.scale.setScalar(Math.max(1, far * 0.9));
  };

  // ---- day and night ----
  const day = { on: false, tod: 12, length: 120 };
  const dayCfg = {
    skyDay: '#7fb2e5',
    horizonDay: '#cfe3f2',
    skySunset: '#e8996a',
    skyNight: '#0b1020',
    sunDay: '#fff0dc',
    sunSet: '#ffb27a',
    ambientMin: 0.12,
    ambientMax: 1.1,
    sunMax: 1.15,
    fogFollow: true
  };

  const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), xClamp(t, 0, 1));

  const applyTimeOfDay = () => {
    if (!sun || !ambient) return;
    const t = ((day.tod % 24) + 24) % 24;
    const ang = ((t - 6) / 24) * Math.PI * 2; // 6h sunrise, 12h noon, 18h sunset
    const h = Math.sin(ang);
    sun.position.set(Math.cos(ang) * 60, Math.max(h, -0.2) * 80 + 4, 25);
    const dayAmt = xClamp(h * 2.2 + 0.2, 0, 1);
    const set = xClamp(1 - Math.abs(h) * 3.5, 0, 1);
    sun.intensity = dayCfg.sunMax * dayAmt;
    sun.color.copy(mixHex(dayCfg.sunDay, dayCfg.sunSet, set));
    ambient.intensity = xLerp(dayCfg.ambientMin, dayCfg.ambientMax, dayAmt);
    const top = mixHex(dayCfg.skyNight, dayCfg.skyDay, dayAmt).lerp(new THREE.Color(dayCfg.skySunset), set * 0.55 * dayAmt);
    const hor = mixHex(dayCfg.skyNight, dayCfg.horizonDay, dayAmt).lerp(new THREE.Color(dayCfg.skySunset), set * 0.8);
    const dome = scene.userData.skyDome;
    if (dome) {
      dome.material.uniforms.uTop.value.copy(top);
      dome.material.uniforms.uHorizon.value.copy(hor);
      dome.material.uniforms.uBottom.value.copy(hor).multiplyScalar(0.6);
    } else if (scene.background && scene.background.isColor) scene.background.copy(hor);
    if (scene.fog && dayCfg.fogFollow) scene.fog.color.copy(hor);
  };

  const stepDay = (dt) => {
    if (!day.on) return;
    day.tod = (day.tod + (dt * 24) / Math.max(1, day.length)) % 24;
    applyTimeOfDay();
  };

  // ---- rendering options ----
  let toneName = 'none';
  const TONES = ['none', 'linear', 'reinhard', 'cineon', 'aces', 'agx'];
  const setToneMapping = (name, exposure) => {
    const n = str(name);
    const map = {
      none: THREE.NoToneMapping,
      linear: THREE.LinearToneMapping,
      reinhard: THREE.ReinhardToneMapping,
      cineon: THREE.CineonToneMapping,
      aces: THREE.ACESFilmicToneMapping,
      agx: THREE.AgXToneMapping
    };
    toneName = map[n] !== undefined ? n : 'none';
    renderer.toneMapping = map[toneName];
    if (exposure !== undefined && exposure !== null) renderer.toneMappingExposure = Math.max(0, num(exposure));
  };

  const setShadowQuality = (q) => {
    const n = str(q);
    const size = n === 'low' ? 1024 : n === 'high' ? 4096 : 2048;
    renderer.shadowMap.type = n === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    const lights = [sun];
    for (const o of objects.values()) if (o.isLight && o.castShadow) lights.push(o);
    lights.forEach((l) => {
      if (!l || !l.shadow) return;
      l.shadow.mapSize.set(size, size);
      if (l.shadow.map) {
        l.shadow.map.dispose();
        l.shadow.map = null;
      }
    });
    for (const o of objects.values()) materialsOf(o).forEach((m) => (m.needsUpdate = true));
  };

  // ---- weather (a particle emitter that follows the player) ----
  const setWeather = (kind, amount) => {
    killEmitter('weather');
    const k = str(kind);
    if (k !== 'rain' && k !== 'snow') return;
    const e = newEmitter('weather', k);
    e.follow = 'player';
    e.offset.set(0, 9, 0);
    e.rate = e.rate * Math.max(0, num(amount) / 100);
    e.max = Math.max(e.max, 2000);
    e.data = new Float32Array(e.max * STRIDE);
    emitters.set('weather', e);
  };

  // ===================================================================
  // v12 geometry: custom meshes, terrain, water, scatter, builders
  // ===================================================================

  const plainMat = (color) =>
    new THREE.MeshStandardMaterial({
      color: toColor(color),
      roughness: 0.6,
      envMapIntensity: 0.2,
      side: THREE.DoubleSide
    });

  // ---- custom meshes ----
  // verts: [[x,y,z],...] or a flat list. faces: [[a,b,c],[a,b,c,d],...] (more than 3 corners are fanned)
  const parseMeshInput = (vertsRaw, facesRaw, normalsRaw, uvsRaw, flat) => {
    const vj = xJSON(vertsRaw, null);
    const fj = xJSON(facesRaw, null);
    if (!Array.isArray(vj) || !Array.isArray(fj)) return { error: 'vertices and faces must be lists like [[0,0,0],[1,0,0],[0,1,0]] and [[0,1,2]]' };
    const pos = [];
    if (vj.length && Array.isArray(vj[0])) vj.forEach((v) => pos.push(xNum(v[0]), xNum(v[1]), xNum(v[2])));
    else vj.forEach((v) => pos.push(xNum(v)));
    const count = Math.floor(pos.length / 3);
    pos.length = count * 3;
    const idx = [];
    for (const f of fj) {
      if (!Array.isArray(f) || f.length < 3) continue;
      for (let i = 1; i < f.length - 1; i++) {
        const a = f[0] | 0;
        const b = f[i] | 0;
        const c = f[i + 1] | 0;
        if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) return { error: 'a face uses a vertex number that does not exist' };
        idx.push(a, b, c);
      }
    }
    if (!idx.length) return { error: 'no usable faces' };
    const flatten = (raw, n) => {
      const j = xJSON(raw, null);
      if (!Array.isArray(j) || !j.length) return null;
      const out = [];
      if (Array.isArray(j[0])) j.forEach((v) => v.forEach((x) => out.push(xNum(x))));
      else j.forEach((x) => out.push(xNum(x)));
      return out.length === count * n ? out : null;
    };
    return { pos, idx, nrm: flatten(normalsRaw, 3), uv: flatten(uvsRaw, 2), flat: !!flat };
  };

  const makeCustomMesh = (data, color) => {
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
    if (data.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    geo.setIndex(data.idx);
    if (data.nrm && !data.flat) geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.nrm, 3));
    else if (data.flat) {
      geo = geo.toNonIndexed();
      geo.computeVertexNormals();
    } else geo.computeVertexNormals();
    if (!geo.getAttribute('uv')) {
      // planar uvs so a texture still shows up
      const p = geo.getAttribute('position');
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        uv[i * 2] = p.getX(i);
        uv[i * 2 + 1] = p.getZ(i);
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, plainMat(color || '#cccccc'));
    mesh.userData.customGeo = data;
    return mesh;
  };

  const meshBuilders = new Map();

  // ---- terrain ----
  const terrainHeight = (t, x, z) => {
    const n = fbm2(x / t.scale + 1000, z / t.scale + 1000, t.seed, t.octaves);
    let h = Math.pow(n, t.sharp) * t.height;
    if (t.edge > 0) {
      const d = Math.max(Math.abs(x), Math.abs(z)) / (t.size / 2);
      h *= 1 - xClamp((d - (1 - t.edge)) / t.edge, 0, 1);
    }
    return h;
  };

  const terrainRefresh = (obj) => {
    const t = obj.userData.terrain;
    const geo = obj.geometry;
    const pos = geo.getAttribute('position');
    const n = t.res + 1;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n * n; i++) {
      lo = Math.min(lo, t.heights[i]);
      hi = Math.max(hi, t.heights[i]);
    }
    const col = geo.getAttribute('color');
    const low = new THREE.Color('#' + t.low);
    const high = new THREE.Color('#' + t.high);
    const c = new THREE.Color();
    for (let i = 0; i < n * n; i++) {
      pos.setY(i, t.heights[i]);
      if (col && t.paint && t.paint[i]) {
        c.set('#' + t.paint[i]);
        col.setXYZ(i, c.r, c.g, c.b);
      } else if (col) {
        const k = hi > lo ? (t.heights[i] - lo) / (hi - lo) : 0;
        c.copy(low).lerp(high, k);
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }
    if (col) col.needsUpdate = true;
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    delete obj.userData._pc;
  };

  const makeTerrain = (params) => {
    const t = Object.assign(
      { size: 80, res: 64, height: 8, scale: 30, seed: 1, octaves: 4, sharp: 1, edge: 0, low: '8a8f84', high: 'd8d6cf', heights: null },
      params
    );
    t.res = xClamp(Math.round(t.res), 4, 160);
    const n = t.res + 1;
    const geo = new THREE.PlaneGeometry(t.size, t.size, t.res, t.res).rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    if (!t.heights || t.heights.length !== n * n) {
      t.heights = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) t.heights[i] = terrainHeight(t, pos.getX(i), pos.getZ(i));
    } else t.heights = Float32Array.from(t.heights);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: 0.15, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.terrain = t;
    terrainRefresh(mesh);
    return mesh;
  };

  const terrainHeightAt = (obj, wx, wz) => {
    const t = obj.userData.terrain;
    if (!t) return -Infinity;
    const v = new THREE.Vector3(wx, 0, wz);
    obj.worldToLocal(v);
    const half = t.size / 2;
    if (v.x < -half || v.x > half || v.z < -half || v.z > half) return -Infinity;
    const n = t.res + 1;
    const fx0 = ((v.x + half) / t.size) * t.res;
    const fz0 = ((v.z + half) / t.size) * t.res;
    const x0 = Math.min(t.res - 1, Math.floor(fx0));
    const z0 = Math.min(t.res - 1, Math.floor(fz0));
    const tx = fx0 - x0;
    const tz = fz0 - z0;
    const h00 = t.heights[z0 * n + x0];
    const h10 = t.heights[z0 * n + x0 + 1];
    const h01 = t.heights[(z0 + 1) * n + x0];
    const h11 = t.heights[(z0 + 1) * n + x0 + 1];
    v.y = xLerp(xLerp(h00, h10, tx), xLerp(h01, h11, tx), tz);
    return obj.localToWorld(v).y;
  };

  // brush: mode raise | set | smooth
  const terrainBrush = (obj, wx, wz, radius, amount, mode, color) => {
    const t = obj.userData.terrain;
    if (!t) return;
    const v = new THREE.Vector3(wx, 0, wz);
    obj.worldToLocal(v);
    const n = t.res + 1;
    const half = t.size / 2;
    const step = t.size / t.res;
    const r = Math.max(step, radius / Math.max(0.0001, obj.scale.x));
    const copy = Float32Array.from(t.heights);
    const col = obj.geometry.getAttribute('color');
    const paintC = color ? toColor(color) : null;
    if (paintC && !t.paint) t.paint = {};
    for (let zi = 0; zi < n; zi++) {
      for (let xi = 0; xi < n; xi++) {
        const px = xi * step - half;
        const pz = zi * step - half;
        const d = Math.hypot(px - v.x, pz - v.z);
        if (d > r) continue;
        const k = 0.5 + 0.5 * Math.cos((d / r) * Math.PI);
        const i = zi * n + xi;
        if (paintC) {
          col.setXYZ(i, paintC.r, paintC.g, paintC.b);
          t.paint[i] = paintC.getHexString();
        } else if (mode === 'set') t.heights[i] = xLerp(t.heights[i], amount, k);
        else if (mode === 'smooth') {
          let sum = 0;
          let c2 = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = xi + dx;
              const nz = zi + dz;
              if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
              sum += copy[nz * n + nx];
              c2++;
            }
          }
          t.heights[i] = xLerp(t.heights[i], sum / c2, k);
        } else t.heights[i] += amount * k;
      }
    }
    terrainRefresh(obj);
    if (paintC) col.needsUpdate = true;
  };

  // ---- water ----
  const makeWater = (params) => {
    const w = Object.assign({ size: 80, wave: 0.15, speed: 1, color: '4f7f9a', opacity: 0.65 }, params);
    const seg = w.wave > 0 ? 40 : 1;
    const geo = new THREE.PlaneGeometry(w.size, w.size, seg, seg).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#' + w.color),
      roughness: 0.12,
      metalness: 0,
      transparent: true,
      opacity: w.opacity,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.water = w;
    mesh.userData.solid = false;
    mesh.userData.hover = false;
    mesh.userData.base = Float32Array.from(geo.getAttribute('position').array);
    mesh.renderOrder = 1;
    return mesh;
  };

  const registerWater = (obj) => {
    if (!scene.userData.waters) scene.userData.waters = new Set();
    scene.userData.waters.add(obj);
  };

  const stepWater = (time) => {
    const set = scene.userData.waters;
    if (!set || !set.size) return;
    set.forEach((o) => {
      const w = o.userData.water;
      if (!w || w.wave <= 0 || !o.visible) return;
      const pos = o.geometry.getAttribute('position');
      const base = o.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2];
        pos.setY(i, (Math.sin(x * 0.35 + time * w.speed) + Math.sin(z * 0.28 + time * w.speed * 1.3)) * 0.5 * w.wave);
      }
      pos.needsUpdate = true;
    });
  };

  const inWater = (x, y, z) => {
    const set = scene.userData.waters;
    if (!set) return false;
    for (const o of set) {
      if (!o.visible) continue;
      const w = o.userData.water;
      const local = o.worldToLocal(new THREE.Vector3(x, y, z));
      const half = w.size / 2;
      if (Math.abs(local.x) <= half && Math.abs(local.z) <= half && local.y <= 0.05 * 0 + w.wave * 0.5) return true;
    }
    return false;
  };

  // ---- scatter (one instanced object holding thousands of copies) ----
  const makeScatter = (params) => {
    const s = Object.assign(
      { shape: 'cube', count: 200, cx: 0, cy: 0, cz: 0, sx: 40, sz: 40, min: 0.5, max: 1.2, seed: 1, snap: '', yaw: 1, color: '9a9a94' },
      params
    );
    s.count = xClamp(Math.round(s.count), 1, 50000);
    const geo = (shapes[s.shape] || shapes.cube)();
    const mat = plainMat('#' + s.color);
    const mesh = new THREE.InstancedMesh(geo, mat, s.count);
    const rnd = rngFrom(s.seed);
    const dummy = new THREE.Object3D();
    const terrain = s.snap ? objects.get(s.snap) : null;
    for (let i = 0; i < s.count; i++) {
      const x = s.cx + (rnd() - 0.5) * s.sx;
      const z = s.cz + (rnd() - 0.5) * s.sz;
      let y = s.cy;
      if (terrain) {
        const h = terrainHeightAt(terrain, x, z);
        if (isFinite(h)) y = h;
      }
      const k = xLerp(s.min, s.max, rnd());
      dummy.position.set(x, y + (s.shape === 'floor' ? 0 : k * 0.5), z);
      dummy.rotation.set(0, s.yaw ? rnd() * Math.PI * 2 : 0, 0);
      dummy.scale.setScalar(k);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.scatter = s;
    return mesh;
  };

  // ---- builders: rooms, stairs, ramps, filled regions ----
  const addChild = (parent, localName, obj, x, y, z, w, h, d) => {
    obj.position.set(x, y, z);
    if (w !== undefined) obj.scale.set(w, h, d);
    addObject(parent.userData.name + '/' + localName, obj);
    parent.add(obj);
    return obj;
  };

  const buildRoom = (name, x, y, z, w, d, h, thick, color, door) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    addObject(name, g);
    const t = Math.max(0.05, thick);
    const box = () => makeShape('cube', color);
    addChild(g, 'floor', box(), 0, -t / 2, 0, w, t, d);
    addChild(g, 'ceiling', box(), 0, h + t / 2, 0, w, t, d);
    addChild(g, 'back', box(), 0, h / 2, -d / 2 - t / 2, w + t * 2, h, t);
    addChild(g, 'left', box(), -w / 2 - t / 2, h / 2, 0, t, h, d);
    addChild(g, 'right', box(), w / 2 + t / 2, h / 2, 0, t, h, d);
    const dw = Math.min(Math.max(0, door), w - 0.2);
    if (dw > 0.1) {
      const dh = Math.min(2.2, h - 0.2);
      const side = (w - dw) / 2;
      addChild(g, 'front left', box(), -(dw / 2 + side / 2), h / 2, d / 2 + t / 2, side, h, t);
      addChild(g, 'front right', box(), dw / 2 + side / 2, h / 2, d / 2 + t / 2, side, h, t);
      addChild(g, 'front top', box(), 0, dh + (h - dh) / 2, d / 2 + t / 2, dw, h - dh, t);
    } else addChild(g, 'front', box(), 0, h / 2, d / 2 + t / 2, w + t * 2, h, t);
    return g;
  };

  const buildStairs = (name, x, y, z, steps, width, rise, run, color) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    addObject(name, g);
    const n = xClamp(Math.round(steps), 1, 200);
    for (let i = 0; i < n; i++) {
      const hgt = rise * (i + 1);
      addChild(g, 'step ' + (i + 1), makeShape('cube', color), 0, hgt / 2, -run * i - run / 2, width, hgt, run);
    }
    return g;
  };

  const buildRamp = (name, x, y, z, width, length, height, color) => {
    const w = width / 2;
    const data = {
      pos: [-w, 0, 0, w, 0, 0, w, 0, -length, -w, 0, -length, -w, height, -length, w, height, -length],
      idx: [0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2],
      nrm: null,
      uv: null,
      flat: true
    };
    // slope runs from the front edge (z = 0, height 0) up to the back edge (height)
    data.pos = [-w, 0, 0, w, 0, 0, w, 0, -length, -w, 0, -length, -w, height, -length, w, height, -length];
    const mesh = makeCustomMesh(data, color);
    mesh.position.set(x, y, z);
    addObject(name, mesh);
    return mesh;
  };

  const fillRegion = (shape, x1, y1, z1, x2, y2, z2, group, color, limit) => {
    const ax = Math.round(Math.min(x1, x2));
    const bx = Math.round(Math.max(x1, x2));
    const ay = Math.round(Math.min(y1, y2));
    const by = Math.round(Math.max(y1, y2));
    const az = Math.round(Math.min(z1, z2));
    const bz = Math.round(Math.max(z1, z2));
    const total = (bx - ax + 1) * (by - ay + 1) * (bz - az + 1);
    if (total > limit) return -1;
    const g = str(group).trim();
    let made = 0;
    for (let x = ax; x <= bx; x++) {
      for (let y = ay; y <= by; y++) {
        for (let z = az; z <= bz; z++) {
          const m = makeShape(shape, color);
          m.position.set(x, y, z);
          const name = uniqueName(g || 'block');
          addObject(name, m);
          joinGroup(m, g);
          made++;
        }
      }
    }
    return made;
  };

  // ===================================================================
  // v12 materials, shaders, atlases, resources and model instancing
  // ===================================================================

  const SKEL_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/SkeletonUtils.js/+esm';

  // ---- reusable materials ----
  const materialLib = new Map();
  const MATERIAL_PRESETS = {
    matte: { rough: 1, metal: 0, opacity: 1 },
    plastic: { rough: 0.45, metal: 0, opacity: 1 },
    rubber: { rough: 0.9, metal: 0, opacity: 1 },
    metal: { rough: 0.35, metal: 1, opacity: 1 },
    'polished metal': { rough: 0.12, metal: 1, opacity: 1 },
    glass: { rough: 0.05, metal: 0, opacity: 0.3 },
    mirror: { rough: 0.02, metal: 1, opacity: 1 }
  };

  const createMaterial = (name, color, rough, metal) => {
    const key = str(name).trim();
    if (!key) return null;
    let m = materialLib.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
      m.userData.libName = key;
      m.userData.shared = true;
      materialLib.set(key, m);
    }
    m.color.copy(toColor(color));
    applySurface(m, clamp01(rough), clamp01(metal));
    m.needsUpdate = true;
    return m;
  };

  const setObjectMaterial = (obj, mat, face) => {
    touchColor(obj);
    obj.traverse((child) => {
      if (!child.isMesh) return;
      if (Array.isArray(child.material)) {
        const f = str(face) || 'all';
        const slots = slotsFor(child.userData.shape, f);
        const list = slots === null ? child.material.map((m, i) => i) : slots;
        list.forEach((i) => {
          if (child.material[i] && !child.material[i].userData.shared) child.material[i].dispose();
          child.material[i] = mat;
        });
      } else {
        if (!child.material.userData.shared) child.material.dispose();
        child.material = mat;
      }
    });
  };

  // ---- shaders ----
  const SHADER_PRESETS = {
    gradient: 'vec3 c = mix(uColor, uColor2, vUv.y); gl_FragColor = vec4(c, 1.0);',
    pulse: 'float k = 0.5 + 0.5 * sin(uTime * 3.0); gl_FragColor = vec4(mix(uColor, uColor2, k), 1.0);',
    scanlines: 'float s = 0.6 + 0.4 * step(0.5, fract(vUv.y * 40.0 + uTime * 0.5)); gl_FragColor = vec4(uColor * s, 1.0);',
    'fresnel rim': 'vec3 V = normalize(cameraPosition - vWorld); float r = pow(1.0 - abs(dot(normalize(vNormal), V)), 3.0); gl_FragColor = vec4(mix(uColor, uColor2, r), 1.0);',
    'world stripes': 'float s = step(0.5, fract(vWorld.y * 2.0)); gl_FragColor = vec4(mix(uColor, uColor2, s), 1.0);'
  };

  const SHADER_VERT =
    'varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld;' +
    'void main(){ vUv = uv; vNormal = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';

  const shaderObjects = new Set();

  // data: { frag (a GLSL snippet that sets gl_FragColor), uniforms: {name: number | '#rrggbb'} }
  const applyShaderData = (obj, data) => {
    const uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color('#ff9acb') }, uColor2: { value: new THREE.Color('#ffffff') } };
    const store = Object.assign({ uColor: '#ff9acb', uColor2: '#ffffff' }, data.uniforms || {});
    Object.keys(store).forEach((k) => {
      const v = store[k];
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) uniforms[k] = { value: new THREE.Color(v) };
      else uniforms[k] = { value: Number(v) };
    });
    const frag =
      'varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld; uniform float uTime; uniform vec3 uColor; uniform vec3 uColor2;' +
      Object.keys(store)
        .filter((k) => k !== 'uColor' && k !== 'uColor2')
        .map((k) => (typeof store[k] === 'string' && /^#/.test(store[k]) ? 'uniform vec3 ' : 'uniform float ') + k + ';')
        .join('') +
      'void main(){ ' + data.frag + ' }';
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SHADER_VERT, fragmentShader: frag, side: THREE.DoubleSide });
    obj.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.userData.origMaterial) child.userData.origMaterial = child.material;
      child.material = mat;
    });
    obj.userData.shader = { frag: data.frag, uniforms: store };
    shaderObjects.add(obj);
    return mat;
  };

  const removeShader = (obj) => {
    obj.traverse((child) => {
      if (child.isMesh && child.userData.origMaterial) {
        if (child.material && child.material.isShaderMaterial) child.material.dispose();
        child.material = child.userData.origMaterial;
        delete child.userData.origMaterial;
      }
    });
    delete obj.userData.shader;
    shaderObjects.delete(obj);
  };

  const stepShaders = (time) => {
    shaderObjects.forEach((o) => {
      if (!o.userData.shader) {
        shaderObjects.delete(o);
        return;
      }
      o.traverse((c) => {
        if (c.isMesh && c.material && c.material.isShaderMaterial) c.material.uniforms.uTime.value = time;
      });
    });
  };

  const setShaderUniform = (obj, name, value) => {
    const s = obj.userData.shader;
    if (!s) return;
    const isColor = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    s.uniforms[name] = isColor ? value : Number(value);
    obj.traverse((c) => {
      if (!c.isMesh || !c.material || !c.material.isShaderMaterial) return;
      const u = c.material.uniforms[name];
      if (!u) return;
      if (isColor) u.value.set(value);
      else u.value = Number(value);
    });
  };

  // ---- texture atlases ----
  const atlases = new Map(); // name -> { src, cols, rows }
  const applyAtlasCell = async (mats, atlas, cell) => {
    const base = await resolveSrc(atlas.src);
    if (!base) return false;
    const idx = Math.max(0, Math.floor(cell));
    const col = idx % atlas.cols;
    const row = Math.floor(idx / atlas.cols) % atlas.rows;
    applyTexture(mats, base);
    mats.forEach((m) => {
      m.map.repeat.set(1 / atlas.cols, 1 / atlas.rows);
      m.map.offset.set(col / atlas.cols, 1 - (row + 1) / atlas.rows);
      m.map.needsUpdate = true;
    });
    return true;
  };

  // ---- models: parsed once, then copied ----
  const modelCache = new Map(); // key -> template object
  const modelSources = (src) => {
    if (src.asset) {
      const a = readAssets()[src.asset];
      if (!a || a.type !== 'model') return null;
      return { key: 'asset:' + src.asset, ext: a.ext, get: async () => dataURLToBuffer(a.data) };
    }
    if (src.url) {
      const ext = src.url.split(/[?#]/)[0].split('.').pop().toLowerCase();
      return {
        key: 'url:' + src.url,
        ext,
        get: async () => {
          if (!(await Scratch.canFetch(src.url))) throw new Error('that link is not allowed');
          const res = await fetch(src.url);
          if (!res.ok) throw new Error('download failed (' + res.status + ')');
          return res.arrayBuffer();
        }
      };
    }
    return null;
  };

  const loadModelObject = async (src) => {
    const info = modelSources(src);
    if (!info) throw new Error('model source not found');
    let tpl = modelCache.get(info.key);
    if (!tpl) {
      tpl = await buildModel(info.ext, await info.get());
      modelCache.set(info.key, tpl);
    }
    const clips = tpl.userData.clips;
    delete tpl.userData.clips;
    const { clone } = await getLoaderModule('skel', SKEL_URL);
    const obj = clone(tpl);
    if (clips) {
      tpl.userData.clips = clips;
      obj.userData.clips = clips;
    }
    obj.traverse((child) => {
      if (!child.material) return;
      child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
    });
    obj.userData.modelSrc = src;
    return obj;
  };

  // ---- resource list ----
  const resourceList = () => {
    const out = [];
    const store = readAssets();
    Object.keys(store).forEach((n) => {
      const a = store[n];
      let loaded = false;
      if (a.type === 'image') loaded = textureCache.has('asset:' + n);
      else if (a.type === 'model') loaded = modelCache.has('asset:' + n);
      else if (a.type === 'audio') loaded = sounds.has(n);
      out.push({ name: n, type: a.type, loaded });
    });
    return out;
  };

  let resourceQueue = { total: 0, done: 0 };

  // ===================================================================
  // v12 raycasts, queries, screen conversion, debug tools, page settings
  // ===================================================================

  // ---- raycasts with filters ----
  const rayCfg = { ignore: '', layers: 0xffff, nonSolid: false };
  const lastRay = { hit: false, name: '', id: '', group: '', point: null, normal: null, distance: 0, origin: null, end: null, ttl: 0 };

  const namedAncestor = (o) => {
    for (let n = o; n && n !== scene; n = n.parent) {
      if (n.userData && n.userData.name !== undefined && objects.get(n.userData.name) === n) return n;
    }
    return null;
  };

  const visibleChain = (o) => {
    for (let n = o; n && n !== scene; n = n.parent) if (!n.visible) return false;
    return true;
  };

  const castFiltered = (origin, dir, far) => {
    const d = dir.clone();
    if (d.lengthSq() < 1e-12) return null;
    d.normalize();
    raycaster.set(origin, d);
    raycaster.near = 0;
    raycaster.far = far;
    const hits = raycaster.intersectObjects(Array.from(objects.values()), true);
    const ign = rayCfg.ignore.trim();
    for (const h of hits) {
      const top = namedAncestor(h.object);
      if (!top || top.isLight || !visibleChain(h.object)) continue;
      if (top.userData.water) continue;
      if (!rayCfg.nonSolid && top.userData.solid === false) continue;
      const ph = top.userData.phys;
      if (ph && !(rayCfg.layers & bitOf(ph.layer))) continue;
      if (!ph && !(rayCfg.layers & 1)) continue;
      if (ign && nameMatches(top.userData.name, ign)) continue;
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      return { top, point: h.point, distance: h.distance, normal };
    }
    return null;
  };

  const doRay = (origin, dir, far) => {
    const hit = castFiltered(origin, dir, far);
    lastRay.origin = origin.clone();
    lastRay.hit = !!hit;
    if (hit) {
      lastRay.name = hit.top.userData.name;
      lastRay.id = hit.top.userData.id || '';
      lastRay.group = hit.top.userData.group || '';
      lastRay.point = hit.point.clone();
      lastRay.normal = hit.normal.clone();
      lastRay.distance = hit.distance;
      lastRay.end = hit.point.clone();
    } else {
      lastRay.name = '';
      lastRay.id = '';
      lastRay.group = '';
      lastRay.point = null;
      lastRay.normal = null;
      lastRay.distance = 0;
      lastRay.end = origin.clone().addScaledVector(dir.clone().normalize(), far);
    }
    lastRay.ttl = 2;
    return hit;
  };

  const objectForward = (o, out) => {
    o.updateWorldMatrix(true, false);
    return out.set(0, 0, -1).transformDirection(o.matrixWorld);
  };

  const objectsWithin = (center, radius, selector) => {
    const list = [];
    const p = new THREE.Vector3();
    const sel = str(selector).trim();
    for (const o of objects.values()) {
      if (o.isLight) continue;
      o.getWorldPosition(p);
      const d = p.distanceTo(center);
      if (d > radius) continue;
      if (sel && !selectorTest(o, sel) && o.userData.group !== sel && o.userData.name !== sel) continue;
      list.push({ o, d });
    }
    list.sort((a, b) => a.d - b.d);
    return list.map((e) => e.o);
  };

  // ---- screen conversion (stage coordinates) ----
  const stageSize = () => {
    const rt = Scratch.vm.runtime;
    return { w: rt.stageWidth || 480, h: rt.stageHeight || 360 };
  };

  const projectPoint = (v) => {
    const s = stageSize();
    const p = v.clone().project(camera);
    return { x: (p.x * s.w) / 2, y: (p.y * s.h) / 2, onScreen: Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z < 1 && p.z > -1 };
  };

  const screenToNdc = (sx, sy) => {
    const s = stageSize();
    return { x: (sx / s.w) * 2, y: (sy / s.h) * 2 };
  };

  const screenSizeOf = (o) => {
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return { w: 0, h: 0 };
    const pts = [];
    for (let i = 0; i < 8; i++) {
      pts.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    pts.forEach((v) => {
      const q = projectPoint(v);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    });
    return { w: maxX - minX, h: maxY - minY };
  };

  const inView = (o) => {
    const frustum = new THREE.Frustum();
    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.updateMatrixWorld();
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m);
    const box = new THREE.Box3().setFromObject(o);
    return !box.isEmpty() && frustum.intersectsBox(box);
  };

  // ---- performance numbers ----
  let frameMs = 0;
  const perfInfo = () => {
    const r = renderer.info;
    return {
      calls: r.render.calls,
      triangles: r.render.triangles,
      geometries: r.memory.geometries,
      textures: r.memory.textures
    };
  };

  // ---- debug tools ----
  const dbg = { stats: false, wireframe: false, axes: false, bounds: false, colliders: false, names: false, info: false, rays: false };
  let dbgGroup = null;
  let dbgEl = null;
  let dbgLast = 0;
  let dbgTemp = [];
  const dbgWatch = new Map();
  let dbgLabelBox = null;
  const dbgLabels = [];

  const debugAttach = () => {
    if (dbgGroup) scene.add(dbgGroup);
  };
  const debugDetach = () => {
    if (dbgGroup && dbgGroup.parent) dbgGroup.parent.remove(dbgGroup);
  };
  const ensureDbgGroup = () => {
    if (!dbgGroup) {
      dbgGroup = new THREE.Group();
      dbgGroup.userData.debug = true;
      dbgGroup.renderOrder = 999;
    }
    if (dbgGroup.parent !== scene) scene.add(dbgGroup);
    return dbgGroup;
  };

  const dbgDispose = (o) => {
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  };

  const lineMat = (color) => new THREE.LineBasicMaterial({ color: toColor(color), depthTest: false, transparent: true });

  const boxesToLines = (boxes, color) => {
    const pos = [];
    boxes.forEach((b) => {
      const a = b.min;
      const c = b.max;
      const v = [
        [a.x, a.y, a.z], [c.x, a.y, a.z], [c.x, c.y, a.z], [a.x, c.y, a.z],
        [a.x, a.y, c.z], [c.x, a.y, c.z], [c.x, c.y, c.z], [a.x, c.y, c.z]
      ];
      [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([i, j]) => pos.push(...v[i], ...v[j]));
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const l = new THREE.LineSegments(g, lineMat(color));
    l.frustumCulled = false;
    l.renderOrder = 999;
    return l;
  };

  const debugLine = (a, b, color, secs) => {
    const g = ensureDbgGroup();
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(geo, lineMat(color));
    l.frustumCulled = false;
    l.renderOrder = 999;
    g.add(l);
    dbgTemp.push({ o: l, ttl: Math.max(0.05, secs) });
  };

  const debugPoint = (p, color, secs, size) => {
    const g = ensureDbgGroup();
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.01, size) / 2, 8, 6),
      new THREE.MeshBasicMaterial({ color: toColor(color), depthTest: false })
    );
    m.position.copy(p);
    m.renderOrder = 999;
    g.add(m);
    dbgTemp.push({ o: m, ttl: Math.max(0.05, secs) });
  };

  const debugShape = (kind, p, size, color, secs) => {
    const g = ensureDbgGroup();
    const geo = kind === 'sphere' ? new THREE.SphereGeometry(size / 2, 16, 10) : new THREE.BoxGeometry(size, size, size);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: toColor(color), wireframe: true, depthTest: false }));
    m.position.copy(p);
    m.renderOrder = 999;
    g.add(m);
    dbgTemp.push({ o: m, ttl: Math.max(0.05, secs) });
  };

  const setWireframeAll = (on) => {
    for (const o of objects.values()) {
      materialsOf(o).forEach((m) => {
        if (m.wireframe !== undefined) m.wireframe = on;
      });
    }
  };

  const dbgDynamicKey = 'dyn';
  const updateDebug = (dt) => {
    if (!dbgGroup && !dbg.axes && !dbg.bounds && !dbg.colliders && !dbg.rays && !dbgTemp.length) return;
    const g = ensureDbgGroup();
    // temporary shapes
    dbgTemp = dbgTemp.filter((t) => {
      t.ttl -= dt;
      if (t.ttl <= 0) {
        g.remove(t.o);
        dbgDispose(t.o);
        return false;
      }
      return true;
    });
    // per frame helpers
    for (let i = g.children.length - 1; i >= 0; i--) {
      const c = g.children[i];
      if (c.userData[dbgDynamicKey]) {
        g.remove(c);
        dbgDispose(c);
      }
    }
    if (dbg.axes) {
      const ax = new THREE.AxesHelper(5);
      ax.userData[dbgDynamicKey] = true;
      ax.material.depthTest = false;
      ax.renderOrder = 999;
      g.add(ax);
    }
    if (dbg.bounds || dbg.colliders) {
      const plain = [];
      const bodies = [];
      const trig = [];
      let n = 0;
      for (const o of objects.values()) {
        if (o.isLight || !o.visible) continue;
        if (++n > 400) break;
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) continue;
        const ph = o.userData.phys;
        if (dbg.colliders && ph) (ph.trigger ? trig : bodies).push(b);
        else if (dbg.bounds) plain.push(b);
      }
      [[plain, '#d9d9d9'], [bodies, '#7bd389'], [trig, '#f0b44c']].forEach(([list, color]) => {
        if (!list.length) return;
        const l = boxesToLines(list, color);
        l.userData[dbgDynamicKey] = true;
        g.add(l);
      });
    }
    if (dbg.rays && lastRay.origin && lastRay.ttl > 0) {
      lastRay.ttl -= dt;
      const l = new THREE.BufferGeometry().setFromPoints([lastRay.origin, lastRay.end]);
      const line = new THREE.Line(l, lineMat(lastRay.hit ? '#7bd389' : '#e07a7a'));
      line.userData[dbgDynamicKey] = true;
      line.frustumCulled = false;
      line.renderOrder = 999;
      g.add(line);
    }
  };

  const ensureDbgOverlay = () => {
    if (dbgEl) return dbgEl;
    dbgEl = document.createElement('div');
    Object.assign(dbgEl.style, {
      position: 'absolute',
      left: '6px',
      top: '6px',
      padding: '4px 6px',
      background: 'rgba(24,24,26,0.82)',
      color: '#e6e6e8',
      font: '11px/1.45 ui-monospace, Menlo, Consolas, monospace',
      whiteSpace: 'pre',
      borderRadius: '2px',
      pointerEvents: 'none',
      zIndex: '30',
      display: 'none'
    });
    return dbgEl;
  };

  const updateDebugOverlay = () => {
    const now = performance.now();
    if (now - dbgLast < 120) return;
    dbgLast = now;
    const el = ensureDbgOverlay();
    const parent = stageParent();
    if (!parent) return;
    if (el.parentElement !== parent) parent.appendChild(el);
    const lines = [];
    if (dbg.stats) {
      const i = perfInfo();
      lines.push('fps ' + fps.toFixed(0) + '   frame ' + frameMs.toFixed(1) + ' ms');
      lines.push('objects ' + objects.size + '   triangles ' + i.triangles + '   draw calls ' + i.calls);
      lines.push('geometries ' + i.geometries + '   textures ' + i.textures);
    }
    if (dbg.info) {
      const hit = lookHit(1000);
      if (hit) {
        const u = hit.object.userData;
        lines.push('looking at ' + u.name + '  id ' + u.id + (u.group ? '  group ' + u.group : ''));
        lines.push('  at ' + hit.point.x.toFixed(2) + ' ' + hit.point.y.toFixed(2) + ' ' + hit.point.z.toFixed(2) + '  dist ' + hit.distance.toFixed(2));
      } else lines.push('looking at nothing');
      lines.push('camera ' + camera.position.x.toFixed(2) + ' ' + camera.position.y.toFixed(2) + ' ' + camera.position.z.toFixed(2) + '  turn ' + camYaw.toFixed(0) + ' tilt ' + camPitch.toFixed(0));
      lines.push('scene ' + currentSceneName);
    }
    dbgWatch.forEach((v, k) => lines.push(k + ': ' + v));
    el.textContent = lines.join('\n');
    el.style.display = lines.length ? 'block' : 'none';

    // name labels
    if (dbg.names) {
      if (!dbgLabelBox) {
        dbgLabelBox = document.createElement('div');
        Object.assign(dbgLabelBox.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', zIndex: '29' });
      }
      if (dbgLabelBox.parentElement !== parent) parent.appendChild(dbgLabelBox);
      const s = stageSize();
      let n = 0;
      const p = new THREE.Vector3();
      for (const o of objects.values()) {
        if (o.isLight && false) continue;
        o.getWorldPosition(p);
        const q = projectPoint(p);
        if (!q.onScreen) continue;
        if (n >= 60) break;
        let label = dbgLabels[n];
        if (!label) {
          label = document.createElement('div');
          Object.assign(label.style, { position: 'absolute', font: '10px/1.2 ui-monospace, Menlo, Consolas, monospace', color: '#e6e6e8', background: 'rgba(24,24,26,0.7)', padding: '1px 3px', transform: 'translate(-50%,-100%)', whiteSpace: 'nowrap' });
          dbgLabelBox.appendChild(label);
          dbgLabels.push(label);
        }
        label.style.display = 'block';
        label.style.left = ((q.x / s.w + 0.5) * 100).toFixed(2) + '%';
        label.style.top = ((0.5 - q.y / s.h) * 100).toFixed(2) + '%';
        label.textContent = o.userData.name + ' (' + o.userData.id + ')';
        n++;
      }
      for (let i = n; i < dbgLabels.length; i++) dbgLabels[i].style.display = 'none';
    } else if (dbgLabelBox) {
      dbgLabels.forEach((l) => (l.style.display = 'none'));
    }
  };

  // ---- page settings (these work in the editor and in packaged games) ----
  const setPageIcon = (href) => {
    let link = document.querySelector('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = href;
  };

  // ===================================================================
  // v12 blocks (definitions and code live side by side)
  // ===================================================================

  const BT = Scratch.BlockType;
  const AT = Scratch.ArgumentType;
  const V12 = { top: [], main: [], fns: {}, menus: {} };
  let sink = V12.main;
  const lab = (text) => sink.push({ blockType: BT.LABEL, text });
  const A = {
    s: (d) => ({ type: AT.STRING, defaultValue: d === undefined ? '' : d }),
    n: (d) => ({ type: AT.NUMBER, defaultValue: d === undefined ? 0 : d }),
    c: (d) => ({ type: AT.COLOR, defaultValue: d }),
    m: (menu, d) => ({ type: AT.STRING, menu, defaultValue: d })
  };
  const blk = (opcode, type, text, args, fn, extra) => {
    const def = { opcode, blockType: type, text };
    if (args) def.arguments = args;
    if (extra) Object.assign(def, extra);
    sink.push(def);
    V12.fns[opcode] = fn;
  };
  const cmd = (op, text, args, fn) => blk(op, BT.COMMAND, text, args, fn);
  const rep = (op, text, args, fn) => blk(op, BT.REPORTER, text, args, fn);
  const boo = (op, text, args, fn) => blk(op, BT.BOOLEAN, text, args, fn);
  const hat = (op, text, args, fn) => blk(op, BT.HAT, text, args, fn, { isEdgeActivated: false });
  const menu = (name, items, reporters) => {
    V12.menus[name] = { acceptReporters: !!reporters, items };
  };
  const dyn = (name, fnName, fn, reporters) => {
    V12.fns[fnName] = fn;
    V12.menus[name] = { acceptReporters: reporters !== false, items: fnName };
  };

  const firstTarget = (name) => getObj(name) || targetsOf(name)[0] || null;
  const T3 = (x, y, z) => new THREE.Vector3(num(x), num(y), num(z));
  const isOn = (v) => str(v) === 'on';
  const jsonList = (list) => JSON.stringify(list);
  const namesOf = (list) => JSON.stringify(list.map((o) => o.userData.name));
  const sceneReady = () => isReady;

  const aimObject = (o, target) => {
    const p = o.getWorldPosition(new THREE.Vector3());
    if (p.distanceToSquared(target) < 1e-10) return;
    const m = new THREE.Matrix4().lookAt(p, target, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    if (o.parent && o.parent !== scene) {
      const pq = o.parent.getWorldQuaternion(new THREE.Quaternion());
      q.premultiply(pq.invert());
    }
    o.quaternion.copy(q);
  };

  const moveTowardPoint = (o, target, steps) => {
    const p = o.getWorldPosition(new THREE.Vector3());
    const dir = target.clone().sub(p);
    const dist = dir.length();
    if (dist < 1e-6) return;
    dir.multiplyScalar(Math.min(steps, dist) / dist);
    const np = p.add(dir);
    if (o.parent && o.parent !== scene) o.parent.worldToLocal(np);
    o.position.copy(np);
  };

  const pointOf = (name) => {
    const p = posOf(name);
    if (!p) return null;
    const o = objects.get(str(name));
    return o ? o.getWorldPosition(new THREE.Vector3()) : p.clone();
  };

  // ---------------------------------------------------------------
  // top of the palette
  // ---------------------------------------------------------------
  sink = V12.top;

  lab('Quick start (a whole scene in one block)');
  cmd(
    'quickStart',
    'quick start: ground [SIZE] sky [SKY] player style [STYLE]',
    { SIZE: A.n(60), SKY: A.c('#bcd7ea'), STYLE: A.m('playerStyleMenu', 'basic') },
    async (a) => {
      await init();
      buildWorld();
      removeSkyDome();
      scene.background = toColor(a.SKY);
      const size = Math.max(1, num(a.SIZE));
      const ground = makeShape('cube', '#8a8f84');
      ground.scale.set(size, 0.4, size);
      ground.position.set(0, -0.2, 0);
      addObject('ground', ground);
      applyPlayerStyle(a.STYLE);
      player.pos.set(0, 0, 0);
      player.spawn.set(0, 0, 0);
      player.mode = 'fp';
      mouseLook = rig.mode === 'first' || rig.mode === 'third';
      player.vx = player.vy = player.vz = 0;
      player.onGround = false;
      camera.position.set(0, player.eye, 0);
      camYaw = 0;
      camPitch = 0;
      updateCamera();
      exitEditor();
    }
  );
  cmd(
    'quickTerrain',
    'quick start: terrain with hills [HEIGHT] water level [WATER] player style [STYLE]',
    { HEIGHT: A.n(8), WATER: A.n(1.5), STYLE: A.m('playerStyleMenu', 'basic') },
    async (a) => {
      await init();
      buildWorld();
      const t = makeTerrain({ size: 120, res: 80, height: Math.max(0.5, num(a.HEIGHT)), scale: 28, seed: 7, sharp: 1.25 });
      addObject('terrain', t);
      let h = terrainHeightAt(t, 0, 0);
      if (!isFinite(h)) h = 0;
      if (num(a.WATER) > 0) {
        const w = makeWater({ size: 400, wave: 0.12 });
        w.position.y = num(a.WATER);
        addObject('water', w);
        registerWater(w);
      }
      makeSkyDome('#6fa3d8', '#cfe0ee', '#9fb0ba');
      scene.fog = new THREE.Fog(toColor('#cfe0ee'), 60, 260);
      applyPlayerStyle(a.STYLE);
      player.pos.set(0, h + 0.1, 0);
      player.spawn.copy(player.pos);
      player.mode = 'fp';
      mouseLook = rig.mode === 'first' || rig.mode === 'third';
      player.vx = player.vy = player.vz = 0;
      camera.position.set(0, h + player.eye, 0);
      updateCamera();
      exitEditor();
    }
  );

  lab('Scenes (menu, level, cutscene: each has its own objects, sky and camera)');
  cmd('createSceneBlock', 'create scene [NAME]', { NAME: A.s('menu') }, async (a) => {
    await init();
    if (!createScene(a.NAME)) toast('Could not create scene "' + str(a.NAME) + '" (name taken or empty).');
  });
  cmd('switchSceneBlock', 'switch to scene [NAME]', { NAME: A.m('sceneMenu', 'menu') }, async (a) => {
    await init();
    if (!switchScene(a.NAME)) toast('There is no scene called "' + str(a.NAME) + '".');
  });
  cmd('deleteSceneBlock', 'delete scene [NAME]', { NAME: A.m('sceneMenu', 'menu') }, async (a) => {
    await init();
    deleteScene(a.NAME);
  });
  rep('currentScene', 'current scene', null, () => currentSceneName);
  rep('sceneList', 'scenes', null, () => jsonList(sceneNames()));
  boo('sceneExistsBlock', 'scene [NAME] exists?', { NAME: A.s('menu') }, (a) => sceneExists(a.NAME));
  dyn('sceneMenu', 'getSceneNames', () => sceneNames());

  lab('Pause (the 3D engine only, or the whole project)');
  menu('pauseActionMenu', ['pause', 'resume', 'toggle']);
  menu('pauseWhatMenu', [{ text: '3D engine', value: 'engine' }, { text: 'whole project', value: 'project' }]);
  cmd('pauseBlock', '[ACTION] [WHAT]', { ACTION: A.m('pauseActionMenu', 'pause'), WHAT: A.m('pauseWhatMenu', 'engine') }, async (a) => {
    await init();
    const act = str(a.ACTION);
    const project = str(a.WHAT) === 'project';
    if (project) setProjectPaused(act === 'toggle' ? !projectPaused : act === 'pause');
    else setEnginePaused(act === 'toggle' ? !enginePaused : act === 'pause');
  });
  cmd('setPauseKey', 'press [KEY] to toggle pause of [WHAT]', { KEY: A.s('escape'), WHAT: A.m('pauseWhatMenu', 'engine') }, (a) => {
    pauseKeyName = str(a.KEY).trim().toLowerCase();
    pauseKeyProject = str(a.WHAT) === 'project';
  });
  boo('isPausedBlock', '[WHAT] paused?', { WHAT: A.m('pauseWhatMenu', 'engine') }, (a) =>
    str(a.WHAT) === 'project' ? projectPaused : enginePaused || projectPaused
  );
  cmd('setTimeScale', 'set time speed to [SCALE] (1 = normal)', { SCALE: A.n(1) }, (a) => {
    TM.scale = xClamp(num(a.SCALE), 0, 10);
  });
  rep('timeScaleBlock', 'time speed', null, () => TM.scale);
  rep('deltaTimeBlock', 'delta time (seconds)', null, () => TM.dt);
  rep('engineTimeBlock', 'engine time (seconds)', null, () => Math.round(TM.time * 1000) / 1000);

  // ---------------------------------------------------------------
  // main palette
  // ---------------------------------------------------------------
  sink = V12.main;

  lab('Objects: id, name, group');
  menu('enableMenu', ['enable', 'disable']);
  rep('idOf', 'id of [NAME]', { NAME: A.s('cube') }, (a) => {
    const o = firstTarget(a.NAME);
    return o ? o.userData.id : '';
  });
  rep('nameOfId', 'name of object with id [ID]', { ID: A.s('id1') }, (a) => {
    const o = objById(a.ID);
    return o ? o.userData.name : '';
  });
  boo('idExists', 'id [ID] exists?', { ID: A.s('id1') }, (a) => !!objById(a.ID));
  cmd('setIdBlock', 'set id of [NAME] to [ID]', { NAME: A.s('cube'), ID: A.s('my id') }, (a) => {
    const o = firstTarget(a.NAME);
    if (o && !setObjectId(o, a.ID)) toast('The id "' + str(a.ID) + '" is already used by another object.');
  });
  cmd('renameBlock', 'rename [NAME] to [NEW]', { NAME: A.s('cube'), NEW: A.s('box') }, (a) => {
    const o = firstTarget(a.NAME);
    if (o && !renameObject(o.userData.name, a.NEW)) toast('Could not rename (the new name is empty or already used).');
  });
  cmd(
    'createFull',
    'create [SHAPE] named [NAME] id [ID] group [GROUP] at x [X] y [Y] z [Z] color [COLOR]',
    { SHAPE: A.m('shapeMenu', 'cube'), NAME: A.s('cube'), ID: A.s(''), GROUP: A.s(''), X: A.n(0), Y: A.n(0), Z: A.n(0), COLOR: A.c('#cccccc') },
    async (a) => {
      await init();
      const mesh = makeShape(a.SHAPE, a.COLOR);
      mesh.position.set(num(a.X), num(a.Y), num(a.Z));
      const name = str(a.NAME).trim() || uniqueName(str(a.SHAPE));
      addObject(name, mesh);
      if (str(a.ID).trim() && !setObjectId(mesh, a.ID)) toast('The id "' + str(a.ID) + '" is already used, kept an automatic id.');
      joinGroup(mesh, a.GROUP);
      lastCreated = name;
      await applyDefaultTexture(mesh);
    }
  );
  cmd('enableBlock', '[STATE] [NAME]', { STATE: A.m('enableMenu', 'enable'), NAME: A.s('cube') }, (a) =>
    targetsOf(a.NAME).forEach((o) => setObjectEnabled(o, str(a.STATE) === 'enable'))
  );
  boo('isEnabledBlock', '[NAME] enabled?', { NAME: A.s('cube') }, (a) => {
    const o = firstTarget(a.NAME);
    return !!o && o.userData.enabled !== false;
  });
  boo('isVisibleBlock', '[NAME] visible?', { NAME: A.s('cube') }, (a) => {
    const o = firstTarget(a.NAME);
    return !!o && o.visible;
  });

  lab('Moving, turning, aiming (all accept groups, ids and selectors)');
  cmd('moveBy', 'move [NAME] by x [X] y [Y] z [Z]', { NAME: A.s('cube'), X: A.n(0), Y: A.n(1), Z: A.n(0) }, (a) =>
    targetsOf(a.NAME).forEach((o) => o.position.add(T3(a.X, a.Y, a.Z)))
  );
  cmd('rotateBy', 'rotate [NAME] by x [X] y [Y] z [Z] degrees', { NAME: A.s('cube'), X: A.n(0), Y: A.n(15), Z: A.n(0) }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      o.rotation.x += rad(num(a.X));
      o.rotation.y += rad(num(a.Y));
      o.rotation.z += rad(num(a.Z));
    })
  );
  cmd('scaleBy', 'multiply size of [NAME] by [FACTOR]', { NAME: A.s('cube'), FACTOR: A.n(2) }, (a) =>
    targetsOf(a.NAME).forEach((o) => o.scale.multiplyScalar(num(a.FACTOR)))
  );
  cmd('resetTransform', 'reset position, turn and size of [NAME]', { NAME: A.s('cube') }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
    })
  );
  cmd('lookAtPos', 'point [NAME] at x [X] y [Y] z [Z]', { NAME: A.s('cube'), X: A.n(0), Y: A.n(0), Z: A.n(0) }, (a) =>
    targetsOf(a.NAME).forEach((o) => aimObject(o, T3(a.X, a.Y, a.Z)))
  );
  cmd('lookAtObject', 'point [NAME] at [TARGET]', { NAME: A.s('cube'), TARGET: A.s('player') }, (a) => {
    const t = pointOf(a.TARGET);
    if (t) targetsOf(a.NAME).forEach((o) => aimObject(o, t));
  });
  cmd('moveTowardsPos', 'move [NAME] towards x [X] y [Y] z [Z] by [STEPS]', { NAME: A.s('cube'), X: A.n(0), Y: A.n(0), Z: A.n(0), STEPS: A.n(0.1) }, (a) =>
    targetsOf(a.NAME).forEach((o) => moveTowardPoint(o, T3(a.X, a.Y, a.Z), num(a.STEPS)))
  );
  cmd('moveTowardsObject', 'move [NAME] towards [TARGET] by [STEPS]', { NAME: A.s('cube'), TARGET: A.s('player'), STEPS: A.n(0.1) }, (a) => {
    const t = pointOf(a.TARGET);
    if (t) targetsOf(a.NAME).forEach((o) => moveTowardPoint(o, t, num(a.STEPS)));
  });
  rep('worldPos', 'world [AXIS] of [NAME]', { AXIS: A.m('axisMenu', 'x'), NAME: A.s('cube') }, (a) => {
    const p = pointOf(a.NAME);
    return p ? Math.round(p[str(a.AXIS)] * 10000) / 10000 : 0;
  });

  lab('Groups and parenting');
  boo('groupExists', 'group [GROUP] exists?', { GROUP: A.s('group') }, (a) => groups.has(str(a.GROUP)));
  rep('groupList', 'groups', null, () => jsonList(Array.from(groups.keys())));
  cmd('removeFromGroup', 'remove [NAME] from its group', { NAME: A.s('cube') }, (a) => targetsOf(a.NAME).forEach((o) => leaveGroup(o)));
  cmd('attachBlock', 'attach [CHILD] to [PARENT]', { CHILD: A.s('hand'), PARENT: A.s('player body') }, (a) => {
    const c = firstTarget(a.CHILD);
    const p = firstTarget(a.PARENT);
    if (!c || !p || !attachTo(c, p)) toast('Could not attach (missing object, or it would attach to itself).');
  });
  cmd('detachBlock', 'detach [CHILD] from its parent', { CHILD: A.s('hand') }, (a) =>
    targetsOf(a.CHILD).forEach((o) => detachFromParent(o))
  );
  rep('parentOfBlock', 'parent of [NAME]', { NAME: A.s('hand') }, (a) => {
    const o = firstTarget(a.NAME);
    const p = o ? parentObject(o) : null;
    return p ? p.userData.name : '';
  });
  rep('childrenOfBlock', 'children of [NAME]', { NAME: A.s('player body') }, (a) => {
    const o = firstTarget(a.NAME);
    return o ? namesOf(childObjects(o)) : '[]';
  });
  rep('childCountBlock', 'number of children of [NAME]', { NAME: A.s('player body') }, (a) => {
    const o = firstTarget(a.NAME);
    return o ? childObjects(o).length : 0;
  });
  menu('onOffMenu2', ['on', 'off']);
  cmd('setObjShadows', 'set shadows of [NAME]: cast [CAST] receive [RECV]', { NAME: A.s('cube'), CAST: A.m('onOffMenu', 'on'), RECV: A.m('onOffMenu', 'on') }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      o.userData.noCast = !isOn(a.CAST);
      o.userData.noReceive = !isOn(a.RECV);
      applyShadowFlags(o);
    })
  );

  lab('Prefabs and templates (save an object once, spawn it anywhere)');
  const prefabNames = () => Array.from(prefabs.keys());
  cmd('savePrefab', 'save [NAME] (with its children) as prefab [PREFAB]', { NAME: A.s('cube'), PREFAB: A.s('crate') }, (a) => {
    const o = firstTarget(a.NAME);
    if (o) prefabs.set(str(a.PREFAB).trim(), captureTree(o));
  });
  cmd(
    'newPrefab',
    'new template [PREFAB]: [SHAPE] color [COLOR] size x [X] y [Y] z [Z]',
    { PREFAB: A.s('crate'), SHAPE: A.m('shapeMenu', 'cube'), COLOR: A.c('#cccccc'), X: A.n(1), Y: A.n(1), Z: A.n(1) },
    async (a) => {
      await init();
      const m = makeShape(a.SHAPE, a.COLOR);
      m.scale.set(num(a.X), num(a.Y), num(a.Z));
      m.userData.name = 'template';
      const d = serObject(m);
      d.parent = -1;
      d.id = undefined;
      disposeObject(m);
      prefabs.set(str(a.PREFAB).trim(), [d]);
    }
  );
  cmd(
    'spawnPrefab',
    'spawn [PREFAB] named [NAME] at x [X] y [Y] z [Z]',
    { PREFAB: A.m('prefabMenu', 'crate'), NAME: A.s(''), X: A.n(0), Y: A.n(0), Z: A.n(0) },
    async (a) => {
      await init();
      const list = prefabs.get(str(a.PREFAB));
      if (!list) return toast('There is no prefab called "' + str(a.PREFAB) + '".');
      const name = str(a.NAME).trim() || uniqueName(str(a.PREFAB));
      const o = await spawnTree(list, name, { pos: [num(a.X), num(a.Y), num(a.Z)], group: '' });
      if (o) lastCreated = o.userData.name;
    }
  );
  cmd(
    'spawnPrefabGroup',
    'spawn [PREFAB] at x [X] y [Y] z [Z] in group [GROUP]',
    { PREFAB: A.m('prefabMenu', 'crate'), X: A.n(0), Y: A.n(0), Z: A.n(0), GROUP: A.s('props') },
    async (a) => {
      await init();
      const list = prefabs.get(str(a.PREFAB));
      if (!list) return toast('There is no prefab called "' + str(a.PREFAB) + '".');
      const g = str(a.GROUP).trim();
      const o = await spawnTree(list, uniqueName(g || str(a.PREFAB)), { pos: [num(a.X), num(a.Y), num(a.Z)], group: g });
      if (o) lastCreated = o.userData.name;
    }
  );
  cmd('deletePrefab', 'delete prefab [PREFAB]', { PREFAB: A.m('prefabMenu', 'crate') }, (a) => prefabs.delete(str(a.PREFAB)));
  boo('prefabExists', 'prefab [PREFAB] exists?', { PREFAB: A.s('crate') }, (a) => prefabs.has(str(a.PREFAB)));
  rep('prefabListBlock', 'prefabs', null, () => jsonList(prefabNames()));
  dyn('prefabMenu', 'getPrefabNames', () => (prefabNames().length ? prefabNames() : ['none']));

  const pools = new Map();
  cmd('preparePool', 'prepare pool of [COUNT] [PREFAB] objects', { COUNT: A.n(20), PREFAB: A.m('prefabMenu', 'crate') }, async (a) => {
    await init();
    const key = str(a.PREFAB);
    const list = prefabs.get(key);
    if (!list) return toast('There is no prefab called "' + key + '".');
    const pool = pools.get(key) || { free: [] };
    pools.set(key, pool);
    const n = xClamp(Math.round(num(a.COUNT)), 1, 2000);
    for (let i = 0; i < n; i++) {
      const o = await spawnTree(list, uniqueName('pool:' + key), { group: '' });
      if (!o) continue;
      o.userData.poolOf = key;
      setObjectEnabled(o, false);
      pool.free.push(o);
    }
  });
  cmd(
    'takeFromPool',
    'take [PREFAB] from pool named [NAME] at x [X] y [Y] z [Z]',
    { PREFAB: A.m('prefabMenu', 'crate'), NAME: A.s('bullet'), X: A.n(0), Y: A.n(0), Z: A.n(0) },
    async (a) => {
      await init();
      const key = str(a.PREFAB);
      const list = prefabs.get(key);
      if (!list) return;
      const pool = pools.get(key);
      const name = str(a.NAME).trim() || uniqueName(key);
      let o = null;
      while (pool && pool.free.length && !o) {
        const c = pool.free.pop();
        if (c.userData.name !== undefined && objects.get(c.userData.name) === c) o = c;
      }
      if (!o) o = await spawnTree(list, name, { group: '' });
      else {
        renameObject(o.userData.name, name);
        setObjectEnabled(o, true);
        await applyCommon(o, list[0], false);
        o.userData.poolOf = key;
      }
      if (!o) return;
      o.position.set(num(a.X), num(a.Y), num(a.Z));
      if (o.userData.phys) {
        o.userData.phys.vel.set(0, 0, 0);
        o.userData.phys.ang.set(0, 0, 0);
      }
      lastCreated = name;
    }
  );
  cmd('returnToPool', 'return [NAME] to its pool', { NAME: A.s('bullet') }, (a) => {
    const o = firstTarget(a.NAME);
    if (!o || !o.userData.poolOf) return;
    const pool = pools.get(o.userData.poolOf) || { free: [] };
    pools.set(o.userData.poolOf, pool);
    renameObject(o.userData.name, uniqueName('pool:' + o.userData.poolOf));
    setObjectEnabled(o, false);
    pool.free.push(o);
  });
  rep('poolFree', 'free objects in pool [PREFAB]', { PREFAB: A.m('prefabMenu', 'crate') }, (a) => {
    const p = pools.get(str(a.PREFAB));
    return p ? p.free.length : 0;
  });

  // ---------------------------------------------------------------
  // variables, events, timers
  // ---------------------------------------------------------------
  lab('Engine variables (shared by everything, saved with the world)');
  cmd('setGlobal', 'set variable [KEY] to [VALUE]', { KEY: A.s('score'), VALUE: A.s('0') }, (a) => globals.set(str(a.KEY), a.VALUE));
  cmd('changeGlobal', 'change variable [KEY] by [VALUE]', { KEY: A.s('score'), VALUE: A.n(1) }, (a) =>
    globals.set(str(a.KEY), num(globals.get(str(a.KEY))) + num(a.VALUE))
  );
  rep('getGlobal', 'variable [KEY]', { KEY: A.s('score') }, (a) => (globals.has(str(a.KEY)) ? globals.get(str(a.KEY)) : 0));
  boo('hasGlobal', 'variable [KEY] exists?', { KEY: A.s('score') }, (a) => globals.has(str(a.KEY)));
  cmd('deleteGlobal', 'delete variable [KEY]', { KEY: A.s('score') }, (a) => globals.delete(str(a.KEY)));
  rep('globalList', 'variable names', null, () => jsonList(Array.from(globals.keys())));

  lab('Events (create your own, listen for the built in ones)');
  menu('contactMenu', ['collides with', 'enters trigger', 'leaves trigger']);
  dyn('eventMenu', 'getEventNames', () => BUILTIN_EVENTS.concat(Array.from(EV.names)));
  cmd('fireEventBlock', 'fire event [EVENT] with [A] [B] [C]', { EVENT: A.s('my event'), A: A.s(''), B: A.s(''), C: A.s('') }, (a) =>
    fireEvent(a.EVENT, a.A, a.B, a.C)
  );
  hat('whenEvent', 'when event [EVENT] happens', { EVENT: A.m('eventMenu', 'collided') }, (a) => {
    const n = str(a.EVENT);
    if (EV.frame.has(n)) {
      EV.matched = n;
      return true;
    }
    return false;
  });
  hat('whenContact', 'when [A] [KIND] [B]', { A: A.s('anything'), KIND: A.m('contactMenu', 'collides with'), B: A.s('anything') }, (a) => {
    const kind = str(a.KIND) === 'enters trigger' ? 'enter' : str(a.KIND) === 'leaves trigger' ? 'leave' : 'collide';
    for (const p of EV.pairsFrame) {
      if (p.kind === kind && nameMatches(p.a, a.A) && nameMatches(p.b, a.B)) {
        EV.matchedPair = p;
        return true;
      }
    }
    return false;
  });
  rep('eventArgBlock', 'event argument [N]', { N: A.n(1) }, (a) => {
    const args = EV.args.get(EV.matched) || [];
    const v = args[Math.max(0, Math.round(num(a.N)) - 1)];
    return v === undefined ? '' : v;
  });
  rep('eventArgOf', 'argument [N] of latest [EVENT]', { N: A.n(1), EVENT: A.m('eventMenu', 'collided') }, (a) => {
    const args = EV.args.get(str(a.EVENT)) || [];
    const v = args[Math.max(0, Math.round(num(a.N)) - 1)];
    return v === undefined ? '' : v;
  });
  rep('contactObject', 'contact [WHICH]', { WHICH: A.m('contactWhichMenu', 'first object') }, (a) => {
    const p = EV.matchedPair;
    if (!p) return '';
    return str(a.WHICH) === 'first object' ? p.a : p.b;
  });
  menu('contactWhichMenu', ['first object', 'second object']);
  cmd('afterSeconds', 'after [SECS] seconds fire event [EVENT] with [A]', { SECS: A.n(1), EVENT: A.s('my event'), A: A.s('') }, (a) => {
    schedule.push({ id: ++scheduleId, left: Math.max(0, num(a.SECS)), every: 0, event: str(a.EVENT), a: a.A, b: '', c: '' });
  });
  cmd('everySeconds', 'every [SECS] seconds fire event [EVENT] with [A]', { SECS: A.n(1), EVENT: A.s('tick'), A: A.s('') }, (a) => {
    const s = Math.max(0.01, num(a.SECS));
    schedule.push({ id: ++scheduleId, left: s, every: s, event: str(a.EVENT), a: a.A, b: '', c: '' });
  });
  cmd('cancelTimed', 'cancel timed events named [EVENT]', { EVENT: A.s('tick') }, (a) => {
    schedule = schedule.filter((s) => s.event !== str(a.EVENT));
  });
  cmd('timerCmd', '[ACTION] timer [NAME]', { ACTION: A.m('timerActionMenu', 'start'), NAME: A.s('timer') }, (a) => {
    const n = str(a.NAME);
    let t = timers.get(n);
    if (!t) timers.set(n, (t = { t: 0, run: false }));
    const act = str(a.ACTION);
    if (act === 'start') {
      t.t = 0;
      t.run = true;
    } else if (act === 'stop') t.run = false;
    else if (act === 'resume') t.run = true;
    else if (act === 'reset') t.t = 0;
  });
  menu('timerActionMenu', ['start', 'stop', 'resume', 'reset']);
  rep('timerValue', 'timer [NAME]', { NAME: A.s('timer') }, (a) => {
    const t = timers.get(str(a.NAME));
    return t ? Math.round(t.t * 1000) / 1000 : 0;
  });

  // ---------------------------------------------------------------
  // physics
  // ---------------------------------------------------------------
  lab('Physics (turn it on per object; every solid object is a collider)');
  menu('bodyTypeMenu', ['dynamic', 'static', 'kinematic']);
  menu('colliderMenu', ['box', 'sphere', 'capsule']);
  menu('physPropMenu', [
    'mass',
    'friction',
    'bounciness',
    { text: 'linear damping', value: 'linDamp' },
    { text: 'angular damping', value: 'angDamp' },
    { text: 'collision layer (1 to 16)', value: 'layer' }
  ]);
  menu('freezeKindMenu', ['position', 'rotation']);
  cmd('makeBody', 'make [NAME] a [TYPE] body', { NAME: A.s('ball'), TYPE: A.m('bodyTypeMenu', 'dynamic') }, async (a) => {
    await init();
    targetsOf(a.NAME).forEach((o) => ensurePhys(o, str(a.TYPE)));
  });
  cmd('removeBody', 'remove physics from [NAME]', { NAME: A.s('ball') }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      delete o.userData.phys;
    })
  );
  cmd('setPhysProp', 'set [PROP] of [NAME] body to [VALUE]', { PROP: A.m('physPropMenu', 'mass'), NAME: A.s('ball'), VALUE: A.n(1) }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      const p = ensurePhys(o);
      const k = str(a.PROP) === 'bounciness' ? 'bounce' : str(a.PROP);
      const v = num(a.VALUE);
      if (k === 'layer') p.layer = xClamp(Math.round(v), 1, 16);
      else if (k === 'mass') p.mass = Math.max(0.001, v);
      else p[k] = Math.max(0, v);
    })
  );
  cmd('setCollider', 'set collider of [NAME] to [SHAPE]', { NAME: A.s('ball'), SHAPE: A.m('colliderMenu', 'box') }, (a) =>
    targetsOf(a.NAME).forEach((o) => (ensurePhys(o).collider = str(a.SHAPE)))
  );
  cmd('setTriggerBlock', 'turn trigger [STATE] for [NAME]', { STATE: A.m('onOffMenu', 'on'), NAME: A.s('zone') }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      const p = ensurePhys(o, o.userData.phys ? undefined : 'static');
      p.trigger = isOn(a.STATE);
      if (p.trigger) o.userData.solid = false;
    })
  );
  cmd('setCollisionLayers', 'set [NAME] to collide with layers [LAYERS]', { NAME: A.s('ball'), LAYERS: A.s('all') }, (a) =>
    targetsOf(a.NAME).forEach((o) => (ensurePhys(o).mask = parseMask(a.LAYERS)))
  );
  cmd(
    'setFreeze',
    'freeze [KIND] of [NAME] x [X] y [Y] z [Z]',
    { KIND: A.m('freezeKindMenu', 'position'), NAME: A.s('ball'), X: A.m('onOffMenu', 'off'), Y: A.m('onOffMenu', 'off'), Z: A.m('onOffMenu', 'off') },
    (a) =>
      targetsOf(a.NAME).forEach((o) => {
        const p = ensurePhys(o);
        const arr = [isOn(a.X) ? 1 : 0, isOn(a.Y) ? 1 : 0, isOn(a.Z) ? 1 : 0];
        if (str(a.KIND) === 'position') p.fp = arr;
        else p.fr = arr;
      })
  );
  cmd('setBodyEnabled', 'turn physics [STATE] for [NAME]', { STATE: A.m('onOffMenu', 'on'), NAME: A.s('ball') }, (a) =>
    targetsOf(a.NAME).forEach((o) => (ensurePhys(o).enabled = isOn(a.STATE)))
  );
  cmd('setBodyGravity', 'turn gravity [STATE] for [NAME]', { STATE: A.m('onOffMenu', 'on'), NAME: A.s('ball') }, (a) =>
    targetsOf(a.NAME).forEach((o) => (ensurePhys(o).gravity = isOn(a.STATE)))
  );
  cmd('applyForce', 'apply force x [X] y [Y] z [Z] to [NAME]', { X: A.n(0), Y: A.n(10), Z: A.n(0), NAME: A.s('ball') }, (a) =>
    targetsOf(a.NAME).forEach((o) => ensurePhys(o).force.add(T3(a.X, a.Y, a.Z)))
  );
  cmd('applyImpulse', 'apply impulse x [X] y [Y] z [Z] to [NAME]', { X: A.n(0), Y: A.n(6), Z: A.n(0), NAME: A.s('ball') }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      const p = ensurePhys(o);
      p.vel.addScaledVector(T3(a.X, a.Y, a.Z), 1 / Math.max(p.mass, 0.001));
    })
  );
  cmd('applyTorque', 'apply torque x [X] y [Y] z [Z] to [NAME]', { X: A.n(0), Y: A.n(5), Z: A.n(0), NAME: A.s('ball') }, (a) =>
    targetsOf(a.NAME).forEach((o) => ensurePhys(o).torque.add(T3(a.X, a.Y, a.Z)))
  );
  cmd('setVelocity', 'set velocity of [NAME] to x [X] y [Y] z [Z]', { NAME: A.s('ball'), X: A.n(0), Y: A.n(0), Z: A.n(0) }, (a) =>
    targetsOf(a.NAME).forEach((o) => ensurePhys(o).vel.set(num(a.X), num(a.Y), num(a.Z)))
  );
  cmd('setAngVelocity', 'set spin of [NAME] to x [X] y [Y] z [Z] (radians per second)', { NAME: A.s('ball'), X: A.n(0), Y: A.n(3), Z: A.n(0) }, (a) =>
    targetsOf(a.NAME).forEach((o) => ensurePhys(o).ang.set(num(a.X), num(a.Y), num(a.Z)))
  );
  cmd('stopBody', 'stop [NAME]', { NAME: A.s('ball') }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      const p = o.userData.phys;
      if (p) {
        p.vel.set(0, 0, 0);
        p.ang.set(0, 0, 0);
      }
    })
  );
  rep('velocityOf', 'velocity [AXIS] of [NAME]', { AXIS: A.m('axisMenu', 'y'), NAME: A.s('ball') }, (a) => {
    const p = physOf(a.NAME);
    return p ? Math.round(p.vel[str(a.AXIS)] * 1000) / 1000 : 0;
  });
  rep('speedOf', 'speed of [NAME]', { NAME: A.s('ball') }, (a) => {
    const p = physOf(a.NAME);
    return p ? Math.round(p.vel.length() * 1000) / 1000 : 0;
  });
  boo('bodyOnGround', '[NAME] on ground?', { NAME: A.s('ball') }, (a) => {
    const p = physOf(a.NAME);
    return !!p && p.grounded;
  });
  rep('bodiesTouching', 'things touching [NAME]', { NAME: A.s('ball') }, (a) => {
    const p = physOf(a.NAME);
    return p ? jsonList(Array.from(p.touching)) : '[]';
  });
  rep('insideTrigger', 'objects inside trigger [NAME]', { NAME: A.s('zone') }, (a) => {
    const p = physOf(a.NAME);
    return p ? jsonList(Array.from(p.inside)) : '[]';
  });
  boo('isInsideTrigger', '[THING] inside trigger [NAME]?', { THING: A.s('player'), NAME: A.s('zone') }, (a) => {
    const p = physOf(a.NAME);
    return !!p && p.inside.has(str(a.THING));
  });
  cmd('setWorldGravity', 'set world gravity to [G] (affects bodies and the player)', { G: A.n(20) }, (a) => {
    physWorld.gravity = Math.max(0, num(a.G));
    player.gravity = physWorld.gravity;
  });
  rep('worldGravityBlock', 'world gravity', null, () => physWorld.gravity);
  cmd('setPhysicsOn', 'turn physics [STATE] for the whole world', { STATE: A.m('onOffMenu', 'on') }, (a) => (physWorld.on = isOn(a.STATE)));

  // ---------------------------------------------------------------
  // raycasts and queries
  // ---------------------------------------------------------------
  lab('Raycasting (cast, then read the result)');
  menu('rayInfoMenu', ['name', 'id', 'group', 'x', 'y', 'z', 'distance', 'normal x', 'normal y', 'normal z']);
  cmd(
    'rayFromPos',
    'cast ray from x [X] y [Y] z [Z] direction x [DX] y [DY] z [DZ] max distance [D]',
    { X: A.n(0), Y: A.n(1), Z: A.n(0), DX: A.n(0), DY: A.n(-1), DZ: A.n(0), D: A.n(100) },
    async (a) => {
      await init();
      doRay(T3(a.X, a.Y, a.Z), T3(a.DX, a.DY, a.DZ), Math.max(0, num(a.D)));
    }
  );
  cmd('rayFromCamera', 'cast ray from the camera forward, max distance [D]', { D: A.n(100) }, async (a) => {
    await init();
    camera.updateMatrixWorld();
    doRay(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldDirection(new THREE.Vector3()), Math.max(0, num(a.D)));
  });
  cmd('rayFromObject', 'cast ray from [NAME] forward, max distance [D]', { NAME: A.s('gun'), D: A.n(100) }, async (a) => {
    await init();
    const o = firstTarget(a.NAME);
    if (!o) return;
    doRay(o.getWorldPosition(new THREE.Vector3()), objectForward(o, new THREE.Vector3()), Math.max(0, num(a.D)));
  });
  cmd('rayBetween', 'cast ray from [A] towards [B]', { A: A.s('enemy'), B: A.s('player') }, async (a) => {
    await init();
    const p = pointOf(a.A);
    const q = pointOf(a.B);
    if (!p || !q) return;
    const dir = q.clone().sub(p);
    doRay(p, dir, dir.length());
  });
  cmd('rayFromScreen', 'cast ray through screen x [X] y [Y], max distance [D]', { X: A.n(0), Y: A.n(0), D: A.n(100) }, async (a) => {
    await init();
    const n = screenToNdc(num(a.X), num(a.Y));
    raycaster.setFromCamera(new THREE.Vector2(n.x, n.y), camera);
    doRay(raycaster.ray.origin.clone(), raycaster.ray.direction.clone(), Math.max(0, num(a.D)));
  });
  boo('rayHitBlock', 'ray hit something?', null, () => lastRay.hit);
  rep('rayInfoBlock', 'ray hit [INFO]', { INFO: A.m('rayInfoMenu', 'name') }, (a) => {
    if (!lastRay.hit) return str(a.INFO) === 'name' || str(a.INFO) === 'id' || str(a.INFO) === 'group' ? '' : 0;
    const r = (v) => Math.round(v * 10000) / 10000;
    switch (str(a.INFO)) {
      case 'name': return lastRay.name;
      case 'id': return lastRay.id;
      case 'group': return lastRay.group;
      case 'x': return r(lastRay.point.x);
      case 'y': return r(lastRay.point.y);
      case 'z': return r(lastRay.point.z);
      case 'distance': return r(lastRay.distance);
      case 'normal x': return r(lastRay.normal.x);
      case 'normal y': return r(lastRay.normal.y);
      case 'normal z': return r(lastRay.normal.z);
    }
    return 0;
  });
  cmd('setRayIgnore', 'rays ignore [SELECTOR]', { SELECTOR: A.s('') }, (a) => (rayCfg.ignore = str(a.SELECTOR)));
  cmd('setRayLayers', 'rays only hit layers [LAYERS]', { LAYERS: A.s('all') }, (a) => (rayCfg.layers = parseMask(a.LAYERS)));
  cmd('setRayNonSolid', 'rays hit objects that are not solid [STATE]', { STATE: A.m('onOffMenu', 'off') }, (a) => (rayCfg.nonSolid = isOn(a.STATE)));

  lab('Finding things nearby');
  rep('objectsInRadius', 'objects within [R] of x [X] y [Y] z [Z] matching [SELECTOR]', { R: A.n(5), X: A.n(0), Y: A.n(0), Z: A.n(0), SELECTOR: A.s('') }, (a) =>
    isReady ? namesOf(objectsWithin(T3(a.X, a.Y, a.Z), num(a.R), a.SELECTOR)) : '[]'
  );
  rep('objectsNear', 'objects within [R] of [NAME] matching [SELECTOR]', { R: A.n(5), NAME: A.s('player'), SELECTOR: A.s('') }, (a) => {
    if (!isReady) return '[]';
    const p = pointOf(a.NAME);
    if (!p) return '[]';
    const self = objects.get(str(a.NAME));
    return namesOf(objectsWithin(p, num(a.R), a.SELECTOR).filter((o) => o !== self));
  });
  rep('objectsInFront', 'objects in front of [NAME] within [D], angle [ANGLE]', { NAME: A.s('player'), D: A.n(5), ANGLE: A.n(45) }, (a) => {
    if (!isReady) return '[]';
    const p = pointOf(a.NAME);
    if (!p) return '[]';
    const o = objects.get(str(a.NAME));
    const fwd = new THREE.Vector3();
    if (o) objectForward(o, fwd);
    else lookDir(fwd);
    const cosA = Math.cos(rad(num(a.ANGLE)));
    const q = new THREE.Vector3();
    return namesOf(
      objectsWithin(p, num(a.D), '').filter((e) => {
        if (e === o) return false;
        e.getWorldPosition(q);
        const v = q.clone().sub(p);
        const l = v.length();
        return l < 1e-6 || v.divideScalar(l).dot(fwd) >= cosA;
      })
    );
  });

  // ---------------------------------------------------------------
  // camera
  // ---------------------------------------------------------------
  lab('Camera (projection, follow modes, shake, saved cameras)');
  menu('projMenu', ['perspective', 'orthographic']);
  menu('camModeMenu', [
    { text: 'first person', value: 'first' },
    { text: 'third person', value: 'third' },
    { text: 'top down', value: 'top' },
    { text: 'side view', value: 'side' },
    { text: 'fixed (watches the player)', value: 'fixed' }
  ]);
  menu('rigSettingMenu', [
    { text: 'distance', value: 'dist' },
    { text: 'height', value: 'height' },
    { text: 'shoulder offset', value: 'shoulder' },
    { text: 'smoothing', value: 'smooth' },
    { text: 'camera collision (0 or 1)', value: 'collide' },
    { text: 'top down tilt', value: 'pitch' },
    { text: 'top down / side turn', value: 'yaw' },
    { text: 'body turn speed', value: 'turnSpeed' }
  ]);
  menu('camInfoMenu', ['field of view', 'projection', 'mode', 'shake', 'zoom']);
  cmd('setProjectionBlock', 'set camera projection to [MODE], zoom [SIZE]', { MODE: A.m('projMenu', 'perspective'), SIZE: A.n(10) }, async (a) => {
    await init();
    orthoSize = Math.max(0.1, num(a.SIZE));
    setProjection(a.MODE);
    applyProjection();
  });
  cmd('setCamMode', 'set camera mode to [MODE]', { MODE: A.m('camModeMenu', 'third') }, async (a) => {
    await init();
    rig.mode = str(a.MODE);
    rigState.init = false;
    syncRigMouse();
    if (rig.mode === 'top' && rig.dist < 6) rig.dist = 12;
    if (rig.mode === 'side' && rig.dist < 6) rig.dist = 10;
    if (rig.mode === 'fixed') rig.fixedPos = camera.position.toArray();
  });
  cmd('setRigSetting', 'set camera [SETTING] to [VALUE]', { SETTING: A.m('rigSettingMenu', 'dist'), VALUE: A.n(5) }, (a) => {
    const k = str(a.SETTING);
    if (k in rig && typeof rig[k] === 'number') rig[k] = num(a.VALUE);
  });
  cmd('camFollow', 'camera follows [NAME] (leave empty for the player)', { NAME: A.s('') }, async (a) => {
    await init();
    const o = str(a.NAME).trim() ? firstTarget(a.NAME) : null;
    rig.target = o ? o.userData.name : '';
    rigState.init = false;
  });
  cmd('fixCameraAt', 'fix camera at x [X] y [Y] z [Z]', { X: A.n(0), Y: A.n(5), Z: A.n(8) }, (a) => {
    rig.fixedPos = [num(a.X), num(a.Y), num(a.Z)];
    rig.mode = 'fixed';
    syncRigMouse();
  });
  cmd('setPlayerBody', 'set player body to [NAME] (empty for none)', { NAME: A.s('') }, async (a) => {
    await init();
    const o = str(a.NAME).trim() ? firstTarget(a.NAME) : null;
    rig.body = o ? o.userData.name : '';
    if (o) o.userData.solid = false;
  });
  cmd('shakeCamera', 'shake camera strength [S] speed [F] for [T] seconds', { S: A.n(1), F: A.n(14), T: A.n(0.4) }, (a) =>
    addShake(Math.max(0, num(a.S)), Math.max(0.02, num(a.T)), Math.max(1, num(a.F)))
  );
  cmd('stopShake', 'stop camera shake', null, () => (fx.shakes.length = 0));
  rep('camInfo', 'camera [INFO]', { INFO: A.m('camInfoMenu', 'field of view') }, (a) => {
    if (!isReady) return 0;
    switch (str(a.INFO)) {
      case 'field of view': return Math.round(fovBase * 100) / 100;
      case 'projection': return projection;
      case 'mode': return rig.mode;
      case 'shake': return Math.round(fx.shakes.reduce((s, x) => s + x.amp * (1 - x.t / x.dur), 0) * 100) / 100;
      case 'zoom': return orthoSize;
    }
    return 0;
  });
  cmd('pointCamAtObject', 'point camera at [NAME]', { NAME: A.s('cube') }, (a) => {
    const p = pointOf(a.NAME);
    if (!p || !isReady) return;
    const dx = p.x - camera.position.x;
    const dy = p.y - camera.position.y;
    const dz = p.z - camera.position.z;
    camYaw = deg(Math.atan2(-dx, -dz));
    camPitch = deg(Math.atan2(dy, Math.hypot(dx, dz)));
    updateCamera();
  });
  cmd('saveCameraBlock', 'save camera as [NAME]', { NAME: A.s('overview') }, async (a) => {
    await init();
    saveCameraAs(a.NAME);
  });
  cmd('useCameraBlock', 'switch to camera [NAME]', { NAME: A.m('cameraMenu', 'overview') }, async (a) => {
    await init();
    if (!useCamera(a.NAME)) toast('There is no saved camera called "' + str(a.NAME) + '".');
  });
  cmd('deleteCameraBlock', 'delete saved camera [NAME]', { NAME: A.m('cameraMenu', 'overview') }, (a) => savedCameras.delete(str(a.NAME)));
  rep('cameraListBlock', 'saved cameras', null, () => jsonList(Array.from(savedCameras.keys())));
  dyn('cameraMenu', 'getCameraNames', () => (savedCameras.size ? Array.from(savedCameras.keys()) : ['none']));

  lab('Screen and 3D (build your own interface with sprites)');
  menu('screenAxisMenu', ['x', 'y']);
  menu('screenSizeMenu', ['width', 'height']);
  rep('screenOfPos', 'screen [AXIS] of x [X] y [Y] z [Z]', { AXIS: A.m('screenAxisMenu', 'x'), X: A.n(0), Y: A.n(0), Z: A.n(0) }, (a) => {
    if (!isReady) return 0;
    camera.updateMatrixWorld();
    const q = projectPoint(T3(a.X, a.Y, a.Z));
    return Math.round(q[str(a.AXIS)] * 100) / 100;
  });
  rep('screenOfObject', 'screen [AXIS] of [NAME]', { AXIS: A.m('screenAxisMenu', 'x'), NAME: A.s('cube') }, (a) => {
    if (!isReady) return 0;
    const p = pointOf(a.NAME);
    if (!p) return 0;
    camera.updateMatrixWorld();
    return Math.round(projectPoint(p)[str(a.AXIS)] * 100) / 100;
  });
  boo('onScreenBlock', '[NAME] on screen?', { NAME: A.s('cube') }, (a) => {
    if (!isReady) return false;
    const o = firstTarget(a.NAME);
    if (!o) return false;
    camera.updateMatrixWorld();
    return inView(o);
  });
  rep('screenSizeOfObject', 'screen [DIM] of [NAME]', { DIM: A.m('screenSizeMenu', 'width'), NAME: A.s('cube') }, (a) => {
    if (!isReady) return 0;
    const o = firstTarget(a.NAME);
    if (!o) return 0;
    camera.updateMatrixWorld();
    const s = screenSizeOf(o);
    return Math.round((str(a.DIM) === 'width' ? s.w : s.h) * 100) / 100;
  });
  rep('distanceToCamera', 'distance from camera to [NAME]', { NAME: A.s('cube') }, (a) => {
    if (!isReady) return 0;
    const p = pointOf(a.NAME);
    return p ? Math.round(p.distanceTo(camera.position) * 1000) / 1000 : 0;
  });

  // ---------------------------------------------------------------
  // player
  // ---------------------------------------------------------------
  lab('Player styles (each is only a starting point, tweak anything afterwards)');
  menu('playerStyleMenu', Object.keys(PLAYER_STYLES).map((k) => ({ text: k, value: k })));
  cmd('usePlayerStyle', 'use player style [STYLE]', { STYLE: A.m('playerStyleMenu', 'parkour') }, async (a) => {
    await init();
    if (!applyPlayerStyle(a.STYLE)) toast('Unknown player style "' + str(a.STYLE) + '".');
  });
  rep('playerStyleBlock', 'player style', null, () => playerStyleName);
  rep('playerStyleList', 'player styles', null, () => jsonList(Object.keys(PLAYER_STYLES)));
  rep('playerSettingValue', 'player setting [SETTING]', { SETTING: A.m('playerSettingMenu', 'walkSpeed') }, (a) => {
    const k = str(a.SETTING);
    return k in player && typeof player[k] === 'number' ? Math.round(player[k] * 1000) / 1000 : 0;
  });
  boo('playerSliding', 'player sliding?', null, () => isReady && player.sliding);
  boo('playerCrouching', 'player crouching?', null, () => isReady && player.crouched);
  boo('playerSprinting', 'player sprinting?', null, () => isReady && player.mode === 'fp' && player.sprinting);
  boo('playerInWater', 'player in water?', null, () => {
    if (!isReady) return false;
    const x = camera.position.x;
    const z = camera.position.z;
    return inWater(x, player.mode === 'fp' ? player.pos.y + 0.5 : camera.position.y - 1, z);
  });
  rep('lastLandingSpeed', 'last landing speed', null, () => Math.round(player.lastImpact * 100) / 100);
  rep('airJumpsLeft', 'air jumps left', null, () => player.jumpsLeft);
  cmd('setSpawn', 'set spawn point to x [X] y [Y] z [Z]', { X: A.n(0), Y: A.n(0), Z: A.n(0) }, async (a) => {
    await init();
    player.spawn.set(num(a.X), num(a.Y), num(a.Z));
  });
  cmd('respawnPlayer', 'respawn player', null, async () => {
    await init();
    player.pos.copy(player.spawn);
    player.vx = player.vy = player.vz = 0;
    camera.position.set(player.pos.x, player.pos.y + player.eyeNow, player.pos.z);
  });
  cmd(
    'setWorldLimits',
    'keep player inside x [X1] to [X2], y [Y1] to [Y2], z [Z1] to [Z2]',
    { X1: A.n(-50), X2: A.n(50), Y1: A.n(-20), Y2: A.n(100), Z1: A.n(-50), Z2: A.n(50) },
    (a) => {
      worldLimits.on = true;
      worldLimits.min = [Math.min(num(a.X1), num(a.X2)), Math.min(num(a.Y1), num(a.Y2)), Math.min(num(a.Z1), num(a.Z2))];
      worldLimits.max = [Math.max(num(a.X1), num(a.X2)), Math.max(num(a.Y1), num(a.Y2)), Math.max(num(a.Z1), num(a.Z2))];
    }
  );
  cmd('clearWorldLimits', 'remove player limits', null, () => (worldLimits.on = false));

  // ---------------------------------------------------------------
  // lights
  // ---------------------------------------------------------------
  lab('Lights (aim them by turning or with point at)');
  menu('lightPropMenu', ['brightness', 'range', 'cone angle', 'softness', 'shadows']);
  cmd(
    'addSpot',
    'add spotlight [NAME] color [COLOR] brightness [B] at x [X] y [Y] z [Z] pointing at x [TX] y [TY] z [TZ] cone [ANGLE]',
    { NAME: A.s('spot'), COLOR: A.c('#ffffff'), B: A.n(3), X: A.n(0), Y: A.n(5), Z: A.n(0), TX: A.n(0), TY: A.n(0), TZ: A.n(0), ANGLE: A.n(35) },
    async (a) => {
      await init();
      const l = makeLight('spot', a.COLOR, a.B);
      l.angle = xClamp(rad(num(a.ANGLE)), 0.01, Math.PI / 2);
      l.position.set(num(a.X), num(a.Y), num(a.Z));
      addObject(str(a.NAME), l);
      aimObject(l, T3(a.TX, a.TY, a.TZ));
    }
  );
  cmd(
    'addDirectional',
    'add directional light [NAME] color [COLOR] brightness [B] from x [X] y [Y] z [Z] towards x [TX] y [TY] z [TZ]',
    { NAME: A.s('sun 2'), COLOR: A.c('#ffffff'), B: A.n(1), X: A.n(5), Y: A.n(10), Z: A.n(5), TX: A.n(0), TY: A.n(0), TZ: A.n(0) },
    async (a) => {
      await init();
      const l = makeLight('directional', a.COLOR, a.B);
      l.position.set(num(a.X), num(a.Y), num(a.Z));
      addObject(str(a.NAME), l);
      aimObject(l, T3(a.TX, a.TY, a.TZ));
    }
  );
  cmd('setLightBlock', 'set light [NAME] [PROP] to [VALUE]', { NAME: A.s('spot'), PROP: A.m('lightPropMenu', 'brightness'), VALUE: A.s('3') }, (a) =>
    targetsOf(a.NAME).forEach((o) => setLightProp(o, a.PROP, a.VALUE))
  );
  cmd('setLightColor', 'set light [NAME] color to [COLOR]', { NAME: A.s('spot'), COLOR: A.c('#ffffff') }, (a) =>
    targetsOf(a.NAME).forEach((o) => setLightProp(o, 'color', a.COLOR))
  );
  rep('lightPropBlock', 'light [NAME] [PROP]', { NAME: A.s('spot'), PROP: A.m('lightPropMenu', 'brightness') }, (a) => {
    const o = firstTarget(a.NAME);
    return o ? readLightProp(o, a.PROP) : 0;
  });
  cmd('pointLightAt', 'point light [NAME] at x [X] y [Y] z [Z]', { NAME: A.s('spot'), X: A.n(0), Y: A.n(0), Z: A.n(0) }, (a) =>
    targetsOf(a.NAME).forEach((o) => o.isLight && aimObject(o, T3(a.X, a.Y, a.Z)))
  );

  // ---------------------------------------------------------------
  // materials
  // ---------------------------------------------------------------
  lab('Reusable materials (change one, every object using it changes)');
  menu('matPresetMenu', Object.keys(MATERIAL_PRESETS));
  menu('matNumberMenu', [
    { text: 'roughness %', value: 'roughness' },
    { text: 'metalness %', value: 'metalness' },
    { text: 'opacity %', value: 'opacity' },
    { text: 'emission strength', value: 'emissive' }
  ]);
  menu('matColorMenu', [{ text: 'base', value: 'base' }, { text: 'emission', value: 'emission' }]);
  menu('matFlagMenu', [
    { text: 'double sided', value: 'double' },
    { text: 'wireframe', value: 'wireframe' },
    { text: 'flat shading', value: 'flat' }
  ]);
  menu('objFlagMenu', [
    { text: 'double sided', value: 'double' },
    { text: 'wireframe', value: 'wireframe' },
    { text: 'flat shading', value: 'flat' },
    { text: 'frustum culling', value: 'culling' }
  ]);
  dyn('materialMenu', 'getMaterialNames', () => (materialLib.size ? Array.from(materialLib.keys()) : ['none']));
  const libMat = (name) => materialLib.get(str(name));
  cmd('createMaterialBlock', 'create material [MAT] color [COLOR] roughness [R] % metalness [M] %', { MAT: A.s('wall'), COLOR: A.c('#cccccc'), R: A.n(60), M: A.n(0) }, async (a) => {
    await init();
    createMaterial(a.MAT, a.COLOR, num(a.R) / 100, num(a.M) / 100);
  });
  cmd('materialPresetBlock', 'make material [MAT] a [PRESET] material', { MAT: A.m('materialMenu', 'wall'), PRESET: A.m('matPresetMenu', 'plastic') }, (a) => {
    const m = libMat(a.MAT);
    const p = MATERIAL_PRESETS[str(a.PRESET)];
    if (!m || !p) return;
    applySurface(m, p.rough, p.metal);
    m.opacity = p.opacity;
    m.transparent = p.opacity < 1;
    m.needsUpdate = true;
  });
  cmd('setMaterialNumber', 'set material [MAT] [PROP] to [VALUE]', { MAT: A.m('materialMenu', 'wall'), PROP: A.m('matNumberMenu', 'roughness'), VALUE: A.n(50) }, (a) => {
    const m = libMat(a.MAT);
    if (!m) return;
    const v = num(a.VALUE);
    const k = str(a.PROP);
    if (k === 'roughness') applySurface(m, clamp01(v / 100), m.metalness);
    else if (k === 'metalness') applySurface(m, m.roughness, clamp01(v / 100));
    else if (k === 'opacity') {
      m.opacity = clamp01(v / 100);
      m.transparent = m.opacity < 1;
    } else if (k === 'emissive') m.emissiveIntensity = Math.max(0, v);
    m.needsUpdate = true;
  });
  cmd('setMaterialColor', 'set material [MAT] [WHICH] color to [COLOR]', { MAT: A.m('materialMenu', 'wall'), WHICH: A.m('matColorMenu', 'base'), COLOR: A.c('#ffffff') }, (a) => {
    const m = libMat(a.MAT);
    if (!m) return;
    if (str(a.WHICH) === 'base') m.color.copy(toColor(a.COLOR));
    else m.emissive.copy(toColor(a.COLOR));
    m.needsUpdate = true;
  });
  cmd('setMaterialFlag', 'set material [MAT] [OPTION] [STATE]', { MAT: A.m('materialMenu', 'wall'), OPTION: A.m('matFlagMenu', 'double'), STATE: A.m('onOffMenu', 'on') }, (a) => {
    const m = libMat(a.MAT);
    if (!m) return;
    const on = isOn(a.STATE);
    if (str(a.OPTION) === 'double') m.side = on ? THREE.DoubleSide : THREE.FrontSide;
    else if (str(a.OPTION) === 'wireframe') m.wireframe = on;
    else m.flatShading = on;
    m.needsUpdate = true;
  });
  cmd('setMaterialTexture', 'set material [MAT] texture to [TEX]', { MAT: A.m('materialMenu', 'wall'), TEX: A.m('textureSourceMenu', 'none') }, async (a) => {
    await init();
    const m = libMat(a.MAT);
    if (!m) return;
    const base = await resolveTextureSource(a.TEX);
    if (base) applyTexture([m], base);
    else {
      if (m.map) m.map.dispose();
      m.map = null;
      m.needsUpdate = true;
    }
  });
  cmd('setMaterialTiling', 'set material [MAT] texture tiling [TX] [TY] offset [OX] [OY]', { MAT: A.m('materialMenu', 'wall'), TX: A.n(1), TY: A.n(1), OX: A.n(0), OY: A.n(0) }, (a) => {
    const m = libMat(a.MAT);
    if (!m || !m.map) return;
    m.map.repeat.set(num(a.TX), num(a.TY));
    m.map.offset.set(num(a.OX), num(a.OY));
  });
  cmd('assignMaterial', 'give [NAME] [FACE] the material [MAT]', { NAME: A.s('cube'), FACE: A.m('faceMenu', 'all'), MAT: A.m('materialMenu', 'wall') }, (a) => {
    const m = libMat(a.MAT);
    if (m) targetsOf(a.NAME).forEach((o) => setObjectMaterial(o, m, a.FACE));
  });
  cmd('deleteMaterialBlock', 'delete material [MAT]', { MAT: A.m('materialMenu', 'wall') }, (a) => {
    const m = libMat(a.MAT);
    if (!m) return;
    for (const o of objects.values()) {
      materialsOf(o).forEach((x) => {
        if (x === m) toast('Material "' + str(a.MAT) + '" is still used by ' + o.userData.name + '.');
      });
    }
    materialLib.delete(str(a.MAT));
  });
  boo('materialExists', 'material [MAT] exists?', { MAT: A.s('wall') }, (a) => materialLib.has(str(a.MAT)));
  rep('materialList', 'materials', null, () => jsonList(Array.from(materialLib.keys())));

  lab('Surface options for one object');
  cmd('setEmissionBlock', 'set emission of [NAME] color [COLOR] strength [S]', { NAME: A.s('cube'), COLOR: A.c('#ffffff'), S: A.n(1) }, (a) =>
    targetsOf(a.NAME).forEach((o) =>
      materialsOf(o).forEach((m) => {
        if (!m.emissive) return;
        m.emissive.copy(toColor(a.COLOR));
        m.emissiveIntensity = Math.max(0, num(a.S));
        m.needsUpdate = true;
      })
    )
  );
  cmd('setObjFlag', 'turn [OPTION] [STATE] for [NAME]', { OPTION: A.m('objFlagMenu', 'double'), STATE: A.m('onOffMenu', 'on'), NAME: A.s('cube') }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      const on = isOn(a.STATE);
      const k = str(a.OPTION);
      if (k === 'culling') o.traverse((c) => (c.frustumCulled = on));
      else
        materialsOf(o).forEach((m) => {
          if (k === 'double') m.side = on ? THREE.DoubleSide : THREE.FrontSide;
          else if (k === 'wireframe') m.wireframe = on;
          else m.flatShading = on;
          m.needsUpdate = true;
        });
    })
  );
  cmd('setNormalMap', 'set normal map of [NAME] to [TEX]', { NAME: A.s('cube'), TEX: A.m('textureSourceMenu', 'none') }, async (a) => {
    await init();
    const base = await resolveTextureSource(a.TEX);
    targetsOf(a.NAME).forEach((o) =>
      materialsOf(o).forEach((m) => {
        if (!('normalMap' in m)) return;
        if (m.normalMap) m.normalMap.dispose();
        if (base) {
          const t = base.clone();
          t.colorSpace = THREE.NoColorSpace;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.needsUpdate = true;
          m.normalMap = t;
        } else m.normalMap = null;
        m.needsUpdate = true;
      })
    );
  });
  cmd('setTexOffset', 'set texture offset of [NAME] [FACE] to x [X] y [Y]', { NAME: A.s('cube'), FACE: A.m('faceMenu', 'all'), X: A.n(0), Y: A.n(0) }, (a) =>
    targetsOf(a.NAME).forEach((o) =>
      materialsForFace(o, a.FACE).forEach((m) => {
        if (m.map) m.map.offset.set(num(a.X), num(a.Y));
      })
    )
  );

  lab('Texture atlas (many pictures in one image)');
  cmd('createAtlas', 'create atlas [ATLAS] from [TEX] with [COLS] columns and [ROWS] rows', { ATLAS: A.s('tiles'), TEX: A.m('textureSourceMenu', 'none'), COLS: A.n(4), ROWS: A.n(4) }, (a) => {
    const s = str(a.TEX).trim();
    const asset = readAssets()[s];
    atlases.set(str(a.ATLAS), {
      src: asset ? 'asset:' + s : s,
      cols: Math.max(1, Math.round(num(a.COLS))),
      rows: Math.max(1, Math.round(num(a.ROWS)))
    });
  });
  cmd('setAtlasCell', 'set texture of [NAME] [FACE] to cell [CELL] of atlas [ATLAS]', { NAME: A.s('cube'), FACE: A.m('faceMenu', 'all'), CELL: A.n(0), ATLAS: A.s('tiles') }, async (a) => {
    await init();
    const at = atlases.get(str(a.ATLAS));
    if (!at) return toast('There is no atlas called "' + str(a.ATLAS) + '".');
    for (const o of targetsOf(a.NAME)) await applyAtlasCell(materialsForFace(o, a.FACE), at, num(a.CELL));
  });
  boo('atlasExists', 'atlas [ATLAS] exists?', { ATLAS: A.s('tiles') }, (a) => atlases.has(str(a.ATLAS)));

  lab('Shaders (advanced: write the colour code yourself, or pick a preset)');
  menu('shaderPresetMenu', Object.keys(SHADER_PRESETS));
  cmd('shaderPreset', 'give [NAME] the shader [PRESET] colors [C1] and [C2]', { NAME: A.s('cube'), PRESET: A.m('shaderPresetMenu', 'gradient'), C1: A.c('#ff9acb'), C2: A.c('#ffffff') }, async (a) => {
    await init();
    targetsOf(a.NAME).forEach((o) => applyShaderData(o, { frag: SHADER_PRESETS[str(a.PRESET)] || SHADER_PRESETS.gradient, uniforms: { uColor: xHex(toColor(a.C1)), uColor2: xHex(toColor(a.C2)) } }));
  });
  cmd('shaderCode', 'give [NAME] the shader code [CODE]', { NAME: A.s('cube'), CODE: A.s('gl_FragColor = vec4(vUv, 0.5 + 0.5 * sin(uTime), 1.0);') }, async (a) => {
    await init();
    targetsOf(a.NAME).forEach((o) => {
      try {
        applyShaderData(o, { frag: str(a.CODE), uniforms: {} });
      } catch (e) {
        toast('Shader error: ' + (e && e.message ? e.message : e));
      }
    });
  });
  cmd('shaderUniform', 'set shader value [U] of [NAME] to [VALUE]', { U: A.s('uColor'), NAME: A.s('cube'), VALUE: A.s('#ff9acb') }, (a) =>
    targetsOf(a.NAME).forEach((o) => setShaderUniform(o, str(a.U), str(a.VALUE)))
  );
  cmd('removeShaderBlock', 'remove shader from [NAME]', { NAME: A.s('cube') }, (a) => targetsOf(a.NAME).forEach((o) => removeShader(o)));

  // ---------------------------------------------------------------
  // rendering and environment
  // ---------------------------------------------------------------
  lab('Rendering');
  menu('toneMenu', TONES);
  menu('shadowQualityMenu', ['low', 'medium', 'high']);
  cmd('setToneBlock', 'set tone mapping to [TONE] exposure [EXPOSURE]', { TONE: A.m('toneMenu', 'aces'), EXPOSURE: A.n(1) }, async (a) => {
    await init();
    setToneMapping(a.TONE, num(a.EXPOSURE));
  });
  cmd('setShadowQualityBlock', 'set shadow quality to [Q]', { Q: A.m('shadowQualityMenu', 'medium') }, async (a) => {
    await init();
    setShadowQuality(a.Q);
  });
  cmd('setFogExp', 'set fog color [COLOR] density [D] (smooth fog)', { COLOR: A.c('#cfe0ee'), D: A.n(0.02) }, async (a) => {
    await init();
    scene.fog = new THREE.FogExp2(toColor(a.COLOR), Math.max(0, num(a.D)));
  });

  lab('Environment (sky, time of day, weather)');
  menu('weatherMenu', ['none', 'rain', 'snow']);
  menu('dayColorMenu', [
    { text: 'day sky', value: 'skyDay' },
    { text: 'day horizon', value: 'horizonDay' },
    { text: 'sunset', value: 'skySunset' },
    { text: 'night sky', value: 'skyNight' }
  ]);
  cmd('setSkyGradient', 'set sky gradient top [TOP] horizon [HORIZON] bottom [BOTTOM]', { TOP: A.c('#6fa3d8'), HORIZON: A.c('#cfe0ee'), BOTTOM: A.c('#9fb0ba') }, async (a) => {
    await init();
    makeSkyDome(a.TOP, a.HORIZON, a.BOTTOM);
  });
  cmd('setTimeOfDay', 'set time of day to [HOUR] (0 to 24)', { HOUR: A.n(12) }, async (a) => {
    await init();
    day.tod = ((num(a.HOUR) % 24) + 24) % 24;
    applyTimeOfDay();
  });
  cmd('setDayCycle', 'turn day cycle [STATE], one day lasts [SECS] seconds', { STATE: A.m('onOffMenu', 'on'), SECS: A.n(120) }, async (a) => {
    await init();
    day.on = isOn(a.STATE);
    day.length = Math.max(1, num(a.SECS));
    if (day.on && !scene.userData.skyDome && !scene.background) scene.background = new THREE.Color('#cfe0ee');
    applyTimeOfDay();
  });
  cmd('setDayColor', 'set day cycle [WHICH] color to [COLOR]', { WHICH: A.m('dayColorMenu', 'skyDay'), COLOR: A.c('#7fb2e5') }, (a) => {
    dayCfg[str(a.WHICH)] = xHex(toColor(a.COLOR));
    if (isReady) applyTimeOfDay();
  });
  rep('timeOfDayBlock', 'time of day', null, () => Math.round(day.tod * 100) / 100);
  cmd('setWeatherBlock', 'set weather to [KIND] amount [AMOUNT] %', { KIND: A.m('weatherMenu', 'rain'), AMOUNT: A.n(100) }, async (a) => {
    await init();
    setWeather(a.KIND, a.AMOUNT);
  });

  // ---------------------------------------------------------------
  // terrain and water
  // ---------------------------------------------------------------
  lab('Terrain and water');
  menu('brushModeMenu', ['raise', 'set height', 'smooth']);
  cmd(
    'createTerrainBlock',
    'create terrain [NAME] size [SIZE] height [HEIGHT] hill size [SCALE] seed [SEED] detail [RES] at x [X] y [Y] z [Z]',
    { NAME: A.s('terrain'), SIZE: A.n(100), HEIGHT: A.n(8), SCALE: A.n(30), SEED: A.n(1), RES: A.n(64), X: A.n(0), Y: A.n(0), Z: A.n(0) },
    async (a) => {
      await init();
      const t = makeTerrain({ size: Math.max(2, num(a.SIZE)), res: num(a.RES), height: num(a.HEIGHT), scale: Math.max(1, num(a.SCALE)), seed: num(a.SEED) });
      t.position.set(num(a.X), num(a.Y), num(a.Z));
      addObject(str(a.NAME).trim() || uniqueName('terrain'), t);
    }
  );
  cmd('terrainColors', 'set terrain [NAME] colors low [LOW] high [HIGH]', { NAME: A.s('terrain'), LOW: A.c('#8a8f84'), HIGH: A.c('#d8d6cf') }, (a) =>
    targetsOf(a.NAME).forEach((o) => {
      if (!o.userData.terrain) return;
      o.userData.terrain.low = toColor(a.LOW).getHexString();
      o.userData.terrain.high = toColor(a.HIGH).getHexString();
      o.userData.terrain.paint = null;
      terrainRefresh(o);
    })
  );
  cmd('terrainBrushBlock', '[MODE] terrain [NAME] at x [X] z [Z] radius [R] amount [AMOUNT]', { MODE: A.m('brushModeMenu', 'raise'), NAME: A.s('terrain'), X: A.n(0), Z: A.n(0), R: A.n(5), AMOUNT: A.n(1) }, (a) =>
    targetsOf(a.NAME).forEach((o) => terrainBrush(o, num(a.X), num(a.Z), num(a.R), num(a.AMOUNT), str(a.MODE) === 'set height' ? 'set' : str(a.MODE) === 'smooth' ? 'smooth' : 'raise'))
  );
  cmd('terrainPaint', 'paint terrain [NAME] at x [X] z [Z] radius [R] color [COLOR]', { NAME: A.s('terrain'), X: A.n(0), Z: A.n(0), R: A.n(5), COLOR: A.c('#6f8f5a') }, (a) =>
    targetsOf(a.NAME).forEach((o) => terrainBrush(o, num(a.X), num(a.Z), num(a.R), 0, 'raise', a.COLOR))
  );
  rep('terrainHeightBlock', 'height of [NAME] at x [X] z [Z]', { NAME: A.s('terrain'), X: A.n(0), Z: A.n(0) }, (a) => {
    if (!isReady) return 0;
    const o = firstTarget(a.NAME);
    if (!o || !o.userData.terrain) return 0;
    const h = terrainHeightAt(o, num(a.X), num(a.Z));
    return isFinite(h) ? Math.round(h * 1000) / 1000 : 0;
  });
  cmd('createWaterBlock', 'create water [NAME] size [SIZE] at height [Y] waves [WAVES] color [COLOR]', { NAME: A.s('water'), SIZE: A.n(200), Y: A.n(1), WAVES: A.n(0.15), COLOR: A.c('#4f7f9a') }, async (a) => {
    await init();
    const w = makeWater({ size: Math.max(1, num(a.SIZE)), wave: Math.max(0, num(a.WAVES)), color: toColor(a.COLOR).getHexString() });
    w.position.y = num(a.Y);
    addObject(str(a.NAME).trim() || uniqueName('water'), w);
    registerWater(w);
  });

  // ---------------------------------------------------------------
  // procedural building
  // ---------------------------------------------------------------
  lab('Building and generating (one block makes many objects)');
  cmd(
    'buildRoomBlock',
    'build room [NAME] at x [X] y [Y] z [Z] width [W] depth [D] height [H] wall [T] door width [DOOR] color [COLOR]',
    { NAME: A.s('room'), X: A.n(0), Y: A.n(0), Z: A.n(0), W: A.n(8), D: A.n(8), H: A.n(3), T: A.n(0.3), DOOR: A.n(1.4), COLOR: A.c('#b8b8b0') },
    async (a) => {
      await init();
      buildRoom(uniqueName(str(a.NAME) || 'room'), num(a.X), num(a.Y), num(a.Z), Math.max(1, num(a.W)), Math.max(1, num(a.D)), Math.max(1, num(a.H)), num(a.T), a.COLOR, num(a.DOOR));
    }
  );
  cmd(
    'buildStairsBlock',
    'build stairs [NAME] at x [X] y [Y] z [Z] steps [N] width [W] rise [RISE] run [RUN] color [COLOR]',
    { NAME: A.s('stairs'), X: A.n(0), Y: A.n(0), Z: A.n(0), N: A.n(10), W: A.n(3), RISE: A.n(0.3), RUN: A.n(0.5), COLOR: A.c('#b8b8b0') },
    async (a) => {
      await init();
      buildStairs(uniqueName(str(a.NAME) || 'stairs'), num(a.X), num(a.Y), num(a.Z), num(a.N), Math.max(0.1, num(a.W)), Math.max(0.02, num(a.RISE)), Math.max(0.05, num(a.RUN)), a.COLOR);
    }
  );
  cmd(
    'buildRampBlock',
    'build ramp [NAME] at x [X] y [Y] z [Z] width [W] length [L] height [H] color [COLOR]',
    { NAME: A.s('ramp'), X: A.n(0), Y: A.n(0), Z: A.n(0), W: A.n(3), L: A.n(8), H: A.n(2), COLOR: A.c('#b8b8b0') },
    async (a) => {
      await init();
      buildRamp(uniqueName(str(a.NAME) || 'ramp'), num(a.X), num(a.Y), num(a.Z), Math.max(0.1, num(a.W)), Math.max(0.1, num(a.L)), num(a.H), a.COLOR);
    }
  );
  cmd(
    'fillRegionBlock',
    'fill [SHAPE] blocks from x [X1] y [Y1] z [Z1] to x [X2] y [Y2] z [Z2] in group [GROUP] color [COLOR]',
    { SHAPE: A.m('shapeMenu', 'cube'), X1: A.n(0), Y1: A.n(0), Z1: A.n(0), X2: A.n(4), Y2: A.n(0), Z2: A.n(4), GROUP: A.s('blocks'), COLOR: A.c('#cccccc') },
    async (a) => {
      await init();
      const n = fillRegion(a.SHAPE, num(a.X1), num(a.Y1), num(a.Z1), num(a.X2), num(a.Y2), num(a.Z2), a.GROUP, a.COLOR, 4096);
      if (n < 0) toast('That region is more than 4096 blocks. Use scatter for large amounts, or fill in smaller pieces.');
    }
  );
  cmd(
    'scatterBlock',
    'scatter [COUNT] [SHAPE] as [NAME] around x [CX] z [CZ] area [SX] by [SZ] size [MIN] to [MAX] seed [SEED] sit on [TERRAIN] color [COLOR]',
    { COUNT: A.n(500), SHAPE: A.m('shapeMenu', 'cube'), NAME: A.s('scatter'), CX: A.n(0), CZ: A.n(0), SX: A.n(60), SZ: A.n(60), MIN: A.n(0.5), MAX: A.n(1.5), SEED: A.n(1), TERRAIN: A.s(''), COLOR: A.c('#9a9a94') },
    async (a) => {
      await init();
      const m = makeScatter({ shape: str(a.SHAPE), count: num(a.COUNT), cx: num(a.CX), cz: num(a.CZ), sx: num(a.SX), sz: num(a.SZ), min: num(a.MIN), max: num(a.MAX), seed: num(a.SEED), snap: str(a.TERRAIN).trim(), color: toColor(a.COLOR).getHexString() });
      addObject(str(a.NAME).trim() || uniqueName('scatter'), m);
    }
  );
  cmd('gridCopies', 'make a grid of [NAME]: [NX] by [NZ], spaced [SX] by [SZ], in group [GROUP]', { NAME: A.s('cube'), NX: A.n(5), NZ: A.n(5), SX: A.n(2), SZ: A.n(2), GROUP: A.s('grid') }, async (a) => {
    await init();
    const src = firstTarget(a.NAME);
    if (!src) return;
    const nx = xClamp(Math.round(num(a.NX)), 1, 100);
    const nz = xClamp(Math.round(num(a.NZ)), 1, 100);
    if (nx * nz > 2500) return toast('A grid can hold at most 2500 copies.');
    const g = str(a.GROUP).trim();
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const c = copyObject(src);
        c.position.set(src.position.x + i * num(a.SX), src.position.y, src.position.z + k * num(a.SZ));
        const name = uniqueName(g || src.userData.name);
        addObject(name, c);
        registerClonedChildren(c, name);
        joinGroup(c, g);
      }
    }
  });

  lab('Custom meshes (vertices and faces)');
  cmd(
    'createMeshBlock',
    'create mesh [NAME] vertices [VERTS] faces [FACES] color [COLOR]',
    { NAME: A.s('triangle'), VERTS: A.s('[[0,0,0],[1,0,0],[0,1,0]]'), FACES: A.s('[[0,1,2]]'), COLOR: A.c('#cccccc') },
    async (a) => {
      await init();
      const d = parseMeshInput(a.VERTS, a.FACES, '', '', false);
      if (d.error) return toast('Mesh: ' + d.error);
      addObject(str(a.NAME).trim() || uniqueName('mesh'), makeCustomMesh(d, a.COLOR));
    }
  );
  cmd(
    'createMeshFull',
    'create mesh [NAME] vertices [VERTS] faces [FACES] normals [NORMALS] uvs [UVS] flat shading [FLAT]',
    { NAME: A.s('shape'), VERTS: A.s('[]'), FACES: A.s('[]'), NORMALS: A.s(''), UVS: A.s(''), FLAT: A.m('onOffMenu', 'off') },
    async (a) => {
      await init();
      const d = parseMeshInput(a.VERTS, a.FACES, a.NORMALS, a.UVS, isOn(a.FLAT));
      if (d.error) return toast('Mesh: ' + d.error);
      addObject(str(a.NAME).trim() || uniqueName('mesh'), makeCustomMesh(d, '#cccccc'));
    }
  );
  cmd('meshStart', 'start building mesh [NAME]', { NAME: A.s('shape') }, (a) => meshBuilders.set(str(a.NAME), { pos: [], idx: [] }));
  cmd('meshVertex', 'mesh [NAME] add vertex x [X] y [Y] z [Z]', { NAME: A.s('shape'), X: A.n(0), Y: A.n(0), Z: A.n(0) }, (a) => {
    const b = meshBuilders.get(str(a.NAME));
    if (b) b.pos.push(num(a.X), num(a.Y), num(a.Z));
  });
  cmd('meshFace', 'mesh [NAME] add face from vertices [I] [J] [K] [L]', { NAME: A.s('shape'), I: A.n(0), J: A.n(1), K: A.n(2), L: A.s('') }, (a) => {
    const b = meshBuilders.get(str(a.NAME));
    if (!b) return;
    const f = [num(a.I), num(a.J), num(a.K)];
    if (str(a.L).trim() !== '') f.push(num(a.L));
    for (let i = 1; i < f.length - 1; i++) b.idx.push(f[0], f[i], f[i + 1]);
  });
  rep('meshVertexCount', 'vertices in mesh [NAME]', { NAME: A.s('shape') }, (a) => {
    const b = meshBuilders.get(str(a.NAME));
    return b ? b.pos.length / 3 : 0;
  });
  cmd('meshFinish', 'finish mesh [NAME] color [COLOR] flat shading [FLAT]', { NAME: A.s('shape'), COLOR: A.c('#cccccc'), FLAT: A.m('onOffMenu', 'off') }, async (a) => {
    await init();
    const b = meshBuilders.get(str(a.NAME));
    if (!b || !b.pos.length || !b.idx.length) return toast('The mesh needs vertices and faces first.');
    const count = b.pos.length / 3;
    if (b.idx.some((i) => i < 0 || i >= count)) return toast('A face uses a vertex number that does not exist.');
    addObject(str(a.NAME).trim(), makeCustomMesh({ pos: b.pos.slice(), idx: b.idx.slice(), nrm: null, uv: null, flat: isOn(a.FLAT) }, a.COLOR));
    meshBuilders.delete(str(a.NAME));
  });

  // ---------------------------------------------------------------
  // animation
  // ---------------------------------------------------------------
  lab('Animation (time based, any number at once)');
  menu('tweenLoopMenu', [{ text: 'once', value: 'once' }, { text: 'loop', value: 'loop' }, { text: 'ping pong', value: 'ping pong' }]);
  menu('tweenActionMenu', ['pause', 'resume', 'stop', 'reverse', 'finish']);
  menu('tweenPropMenu', Object.keys(OBJ_PROPS).concat(Object.keys(CAM_PROPS)));
  menu('easingMenu', Object.keys(EASINGS));
  cmd(
    'animateBlock',
    'animate [PROP] of [NAME] to [TO] over [SECS] seconds, easing [EASE], [LOOP], call it [ANIM]',
    { PROP: A.m('tweenPropMenu', 'position y'), NAME: A.s('cube'), TO: A.n(5), SECS: A.n(1), EASE: A.m('easingMenu', 'ease in out'), LOOP: A.m('tweenLoopMenu', 'once'), ANIM: A.s('') },
    async (a) => {
      await init();
      if (!tweenStart(a.NAME, a.PROP, a.TO, a.SECS, a.EASE, a.LOOP, a.ANIM)) toast('Nothing to animate (check the object name).');
    }
  );
  cmd('animControl', '[ACTION] animation [ANIM]', { ACTION: A.m('tweenActionMenu', 'pause'), ANIM: A.s('all') }, (a) => {
    tweenSelect(a.ANIM).forEach((t) => {
      const act = str(a.ACTION);
      if (act === 'pause') t.paused = true;
      else if (act === 'resume') t.paused = false;
      else if (act === 'reverse') t.dir = -t.dir;
      else if (act === 'stop') t.done = true;
      else if (act === 'finish') {
        t.targets.forEach((x) => x.set(t.to));
        t.done = true;
        fireEvent('animation finished', t.id);
      }
    });
    tweens = tweens.filter((t) => !t.done);
  });
  cmd('animSpeed', 'set speed of animation [ANIM] to [SPEED]', { ANIM: A.s('all'), SPEED: A.n(1) }, (a) =>
    tweenSelect(a.ANIM).forEach((t) => (t.speed = Math.max(0, num(a.SPEED))))
  );
  boo('animPlaying', 'animation [ANIM] playing?', { ANIM: A.s('all') }, (a) => tweenSelect(a.ANIM).some((t) => !t.paused));
  boo('animExists', 'animation [ANIM] running?', { ANIM: A.s('') }, (a) => tweenSelect(a.ANIM).length > 0);
  rep('animProgress', 'progress of animation [ANIM] (0 to 1)', { ANIM: A.s('') }, (a) => {
    const t = tweenSelect(a.ANIM)[0];
    return t ? Math.round((t.t / t.dur) * 1000) / 1000 : 0;
  });
  rep('animList', 'running animations', null, () => jsonList(tweens.map((t) => t.id)));
  rep('easeBlock', 'ease [T] (0 to 1) using [EASE]', { T: A.n(0.5), EASE: A.m('easingMenu', 'ease in out') }, (a) =>
    Math.round(easeFn(a.EASE)(xClamp(num(a.T), 0, 1)) * 10000) / 10000
  );

  // ---------------------------------------------------------------
  // audio
  // ---------------------------------------------------------------
  lab('Audio (import sounds with the file blocks above, then play them)');
  menu('soundActionMenu', ['stop', 'pause', 'resume', 'restart']);
  menu('chanPropMenu', [
    { text: 'volume %', value: 'volume' },
    { text: 'pitch %', value: 'pitch' },
    { text: 'stereo pan (-100 to 100)', value: 'pan' },
    { text: 'looping (0 or 1)', value: 'loop' },
    { text: 'full volume distance', value: 'minDist' },
    { text: 'silent beyond distance', value: 'maxDist' },
    { text: 'fall off speed', value: 'rolloff' },
    { text: 'position in seconds', value: 'time' }
  ]);
  menu('fadeThenMenu', ['keep playing', 'then stop']);
  menu('chanInfoMenu', ['volume %', 'pitch %', 'position in seconds', 'length in seconds', 'bus']);
  dyn('audioAssetMenu', 'getAudioAssets', () => {
    const s = readAssets();
    const l = Object.keys(s).filter((k) => s[k].type === 'audio');
    return l.length ? l : ['none'];
  });
  dyn('soundMenu', 'getSoundNames', () => (sounds.size ? Array.from(sounds.keys()) : ['none']));
  dyn('busMenu', 'getBusNames', () => ['master', 'music', 'effects', 'voice'].concat(Array.from(auBuses.keys()).filter((k) => ['music', 'effects', 'voice'].indexOf(k) < 0)));
  cmd('loadSoundBlock', 'load sound [NAME] from [SOURCE]', { NAME: A.s('jump'), SOURCE: A.m('audioAssetMenu', 'none') }, async (a) => {
    try {
      resourceQueue.total++;
      if (!(await loadSound(a.NAME, a.SOURCE))) toast('Could not find "' + str(a.SOURCE) + '". Import an audio file first, or use a link.');
    } catch (e) {
      toast('Could not load that sound: ' + (e && e.message ? e.message : e));
    } finally {
      resourceQueue.done++;
    }
  });
  const soundOpts = (a, extra) =>
    Object.assign({ channel: str(a.CHANNEL).trim(), vol: num(a.VOL) / 100, pitch: Math.max(0.01, num(a.PITCH) / 100), loop: isOn(a.LOOP), bus: str(a.BUS).trim() || 'effects' }, extra || {});
  const missingSound = (n) => toast('Sound "' + str(n) + '" is not loaded. Use "load sound" first.');
  cmd(
    'playSoundBlock',
    'play sound [SOUND] as [CHANNEL] volume [VOL] % pitch [PITCH] % loop [LOOP] on bus [BUS]',
    { SOUND: A.m('soundMenu', 'jump'), CHANNEL: A.s(''), VOL: A.n(100), PITCH: A.n(100), LOOP: A.m('onOffMenu', 'off'), BUS: A.m('busMenu', 'effects') },
    (a) => {
      if (!sounds.has(str(a.SOUND))) return missingSound(a.SOUND);
      playSound(a.SOUND, soundOpts(a));
    }
  );
  cmd(
    'playSoundAt',
    'play sound [SOUND] at x [X] y [Y] z [Z] as [CHANNEL] volume [VOL] % loop [LOOP]',
    { SOUND: A.m('soundMenu', 'jump'), X: A.n(0), Y: A.n(0), Z: A.n(0), CHANNEL: A.s(''), VOL: A.n(100), LOOP: A.m('onOffMenu', 'off') },
    (a) => {
      if (!sounds.has(str(a.SOUND))) return missingSound(a.SOUND);
      playSound(a.SOUND, soundOpts(Object.assign({ PITCH: 100, BUS: 'effects' }, a), { at: [num(a.X), num(a.Y), num(a.Z)] }));
    }
  );
  cmd(
    'playSoundOn',
    'play sound [SOUND] on [NAME] as [CHANNEL] volume [VOL] % loop [LOOP]',
    { SOUND: A.m('soundMenu', 'jump'), NAME: A.s('cube'), CHANNEL: A.s(''), VOL: A.n(100), LOOP: A.m('onOffMenu', 'off') },
    (a) => {
      if (!sounds.has(str(a.SOUND))) return missingSound(a.SOUND);
      const o = firstTarget(a.NAME);
      if (!o && !isPlayerName(a.NAME)) return;
      playSound(a.SOUND, soundOpts(Object.assign({ PITCH: 100, BUS: 'effects' }, a), { follow: o ? o.userData.name : 'player' }));
    }
  );
  cmd('soundControl', '[ACTION] sound [CHANNEL] (a channel, a sound name, bus:name or all)', { ACTION: A.m('soundActionMenu', 'stop'), CHANNEL: A.s('all') }, (a) => {
    chanTargets(a.CHANNEL).forEach((ch) => {
      const act = str(a.ACTION);
      if (act === 'stop') chanStopNow(ch);
      else if (act === 'pause' && ch.playing) {
        ch.offset = chanTime(ch);
        ch.paused = true;
        ch.playing = false;
        ch.serial = -1;
        try {
          ch.src.stop();
        } catch (e) {
          /* ignore */
        }
      } else if (act === 'resume' && ch.paused) chanStart(ch, ch.offset);
      else if (act === 'restart') {
        if (ch.playing) {
          ch.serial = -1;
          try {
            ch.src.stop();
          } catch (e) {
            /* ignore */
          }
        }
        chanStart(ch, 0);
      }
    });
  });
  cmd('setChannelProp', 'set [PROP] of sound [CHANNEL] to [VALUE]', { PROP: A.m('chanPropMenu', 'volume'), CHANNEL: A.s('music'), VALUE: A.n(100) }, (a) => {
    const v = num(a.VALUE);
    chanTargets(a.CHANNEL).forEach((ch) => {
      switch (str(a.PROP)) {
        case 'volume':
          ch.vol = Math.max(0, v / 100);
          ch.gain.gain.cancelScheduledValues(0);
          ch.gain.gain.value = ch.vol;
          break;
        case 'pitch':
          ch.pitch = Math.max(0.01, v / 100);
          if (ch.src) ch.src.playbackRate.value = ch.pitch;
          break;
        case 'pan':
          if (ch.stereo) ch.stereo.pan.value = xClamp(v / 100, -1, 1);
          break;
        case 'loop':
          ch.loop = v !== 0;
          if (ch.src) ch.src.loop = ch.loop;
          break;
        case 'minDist':
          ch.minDist = Math.max(0.01, v);
          chanApplySpatial(ch);
          break;
        case 'maxDist':
          ch.maxDist = Math.max(0.1, v);
          chanApplySpatial(ch);
          break;
        case 'rolloff':
          ch.rolloff = Math.max(0, v);
          chanApplySpatial(ch);
          break;
        case 'time':
          if (ch.playing) {
            ch.serial = -1;
            try {
              ch.src.stop();
            } catch (e) {
              /* ignore */
            }
            chanStart(ch, Math.max(0, v));
          } else ch.offset = Math.max(0, v);
          break;
      }
    });
  });
  cmd('fadeSound', 'fade sound [CHANNEL] to [VOL] % over [SECS] seconds, [THEN]', { CHANNEL: A.s('music'), VOL: A.n(0), SECS: A.n(2), THEN: A.m('fadeThenMenu', 'then stop') }, (a) =>
    chanTargets(a.CHANNEL).forEach((ch) => chanFade(ch, num(a.VOL) / 100, num(a.SECS), str(a.THEN) === 'then stop'))
  );
  boo('soundPlayingBlock', 'sound [CHANNEL] playing?', { CHANNEL: A.s('music') }, (a) => chanTargets(a.CHANNEL).some((c) => c.playing));
  rep('channelInfo', '[INFO] of sound [CHANNEL]', { INFO: A.m('chanInfoMenu', 'volume %'), CHANNEL: A.s('music') }, (a) => {
    const ch = chanTargets(a.CHANNEL)[0];
    if (!ch) return str(a.INFO) === 'bus' ? '' : 0;
    const r = (v) => Math.round(v * 1000) / 1000;
    switch (str(a.INFO)) {
      case 'volume %': return r(ch.vol * 100);
      case 'pitch %': return r(ch.pitch * 100);
      case 'position in seconds': return r(chanTime(ch));
      case 'length in seconds': return r(ch.buffer.duration);
      case 'bus': return ch.bus;
    }
    return 0;
  });
  rep('soundLength', 'length of sound [SOUND] in seconds', { SOUND: A.m('soundMenu', 'jump') }, (a) => {
    const b = sounds.get(str(a.SOUND));
    return b ? Math.round(b.duration * 1000) / 1000 : 0;
  });
  rep('activeSounds', 'playing sound channels', null, () => jsonList(Array.from(channels.keys())));
  cmd('setBusVolumeBlock', 'set [BUS] volume to [VOL] %', { BUS: A.m('busMenu', 'master'), VOL: A.n(100) }, (a) => auSetBusVolume(a.BUS, num(a.VOL) / 100));
  cmd('muteBus', 'turn [BUS] sound [STATE]', { BUS: A.m('busMenu', 'music'), STATE: A.m('onOffMenu', 'off') }, (a) => {
    const b = auBus(a.BUS);
    if (b.master) return;
    b.muted = !isOn(a.STATE);
    b.gain.gain.value = b.muted ? 0 : b.vol;
  });
  rep('busVolumeBlock', 'volume of [BUS] %', { BUS: A.m('busMenu', 'master') }, (a) => Math.round(auBus(a.BUS).vol * 100));
  cmd('unloadSound', 'unload sound [NAME]', { NAME: A.m('soundMenu', 'jump') }, (a) => {
    chanTargets(a.NAME).forEach(chanStopNow);
    sounds.delete(str(a.NAME));
  });
  boo('soundLoaded', 'sound [NAME] loaded?', { NAME: A.s('jump') }, (a) => sounds.has(str(a.NAME)));

  // ---------------------------------------------------------------
  // saving
  // ---------------------------------------------------------------
  lab('Saving and progress (stored in this browser)');
  cmd('setSaveName', 'use save name [NAME] (one per game, so games do not mix saves)', { NAME: A.s('my game') }, (a) => {
    saveNs = str(a.NAME).trim() || 'game';
  });
  cmd('saveValue', 'save [VALUE] as [KEY]', { VALUE: A.s('10'), KEY: A.s('best score') }, (a) => {
    if (!storeSet('v:' + str(a.KEY), str(a.VALUE))) lastSaveError = 'browser storage is not available, the value only lives until the page closes';
  });
  rep('savedValue', 'saved [KEY]', { KEY: A.s('best score') }, (a) => {
    const v = storeGet('v:' + str(a.KEY));
    return v === undefined ? '' : v;
  });
  boo('hasSavedValue', 'saved [KEY] exists?', { KEY: A.s('best score') }, (a) => storeGet('v:' + str(a.KEY)) !== undefined);
  cmd('deleteSavedValue', 'delete saved [KEY]', { KEY: A.s('best score') }, (a) => storeDel('v:' + str(a.KEY)));
  rep('savedKeys', 'saved keys', null, () => jsonList(storeKeys('v:').map((k) => k.slice(2))));
  cmd('saveGlobalsBlock', 'save all engine variables', null, () => storeSet('globals', JSON.stringify(Object.fromEntries(globals))));
  cmd('loadGlobalsBlock', 'load saved engine variables', null, () => {
    const o = xJSON(storeGet('globals') || '{}', {});
    Object.keys(o).forEach((k) => globals.set(k, o[k]));
  });
  cmd('saveWorldSlot', 'save the world to slot [SLOT]', { SLOT: A.s('slot 1') }, async (a) => {
    await init();
    saveSlot(a.SLOT);
  });
  cmd('loadWorldSlot', 'load the world from slot [SLOT] restore player [PLAYER]', { SLOT: A.m('slotMenu', 'slot 1'), PLAYER: A.m('onOffMenu', 'on') }, async (a) => {
    await init();
    try {
      if (!(await loadSlot(a.SLOT, isOn(a.PLAYER)))) toast('Save slot "' + str(a.SLOT) + '" is empty.');
    } catch (e) {
      toast('Could not load the save: ' + (e && e.message ? e.message : e));
    }
  });
  boo('slotExists', 'slot [SLOT] has a save?', { SLOT: A.s('slot 1') }, (a) => storeGet('slot:' + str(a.SLOT).trim()) !== undefined);
  cmd('deleteSlot', 'delete slot [SLOT]', { SLOT: A.m('slotMenu', 'slot 1') }, (a) => storeDel('slot:' + str(a.SLOT).trim()));
  rep('slotList', 'save slots', null, () => jsonList(slotNames()));
  rep('slotTime', 'time of save in slot [SLOT] (seconds since 1970)', { SLOT: A.s('slot 1') }, (a) => {
    const r = readSlot(a.SLOT);
    return r ? Math.floor(r.t / 1000) : 0;
  });
  dyn('slotMenu', 'getSlotNames', () => (slotNames().length ? slotNames() : ['slot 1']));
  cmd('autosaveBlock', 'autosave to slot [SLOT] every [SECS] seconds (0 turns it off)', { SLOT: A.s('autosave'), SECS: A.n(60) }, (a) => {
    autosave.slot = str(a.SLOT).trim() || 'autosave';
    autosave.every = Math.max(0, num(a.SECS));
    autosave.t = 0;
  });
  cmd('downloadSlot', 'download slot [SLOT] as a file', { SLOT: A.m('slotMenu', 'slot 1') }, (a) => {
    const raw = storeGet('slot:' + str(a.SLOT).trim());
    if (raw === undefined) return toast('Save slot "' + str(a.SLOT) + '" is empty.');
    downloadText(str(a.SLOT).replace(/[^\w\- ]+/g, '') + '.turbo3d.json', raw);
  });
  cmd('importSlot', 'load a save file from the computer into slot [SLOT]', { SLOT: A.s('slot 1') }, async (a) => {
    const file = await pickFile('.json');
    if (!file) return;
    try {
      const text = await file.text();
      const rec = xJSON(text, null);
      if (!rec || !rec.data) return toast('That file is not a 3D Turbo save.');
      storeSet('slot:' + str(a.SLOT).trim(), text);
    } catch (e) {
      toast('Could not read that file.');
    }
  });
  rep('lastSaveErrorBlock', 'last save problem', null, () => lastSaveError);

  lab('World data (the whole scene as text)');
  rep('worldText', 'world as text', null, () => (isReady ? JSON.stringify(serializeWorld()) : ''));
  cmd('loadWorldText', 'load world from text [TEXT]', { TEXT: A.s('') }, async (a) => {
    await init();
    const d = xJSON(str(a.TEXT), null);
    if (!d || !(await loadWorldData(d, false))) toast('That text is not world data.');
  });
  cmd('clearWorldObjects', 'delete every object in this scene', null, async () => {
    await init();
    clearSceneObjects();
  });
  rep('objectAsText', '[NAME] as text', { NAME: A.s('cube') }, (a) => {
    const o = firstTarget(a.NAME);
    return o ? JSON.stringify(captureTree(o)) : '';
  });
  cmd('spawnFromText', 'spawn object from text [TEXT] named [NAME] at x [X] y [Y] z [Z]', { TEXT: A.s(''), NAME: A.s('copy'), X: A.n(0), Y: A.n(0), Z: A.n(0) }, async (a) => {
    await init();
    const list = xJSON(str(a.TEXT), null);
    if (!Array.isArray(list) || !list.length) return toast('That text is not object data.');
    await spawnTree(list, str(a.NAME).trim() || uniqueName('object'), { pos: [num(a.X), num(a.Y), num(a.Z)], group: '' });
  });

  // ---------------------------------------------------------------
  // resources
  // ---------------------------------------------------------------
  lab('Resources (load ahead of time, free memory when done)');
  menu('resourceTypeMenu', ['picture', 'model', 'sound']);
  cmd('preloadResource', 'load [TYPE] [NAME]', { TYPE: A.m('resourceTypeMenu', 'picture'), NAME: A.s('') }, async (a) => {
    await init();
    resourceQueue.total++;
    try {
      const n = str(a.NAME).trim();
      const t = str(a.TYPE);
      if (t === 'picture') await resolveTextureSource(n);
      else if (t === 'model') {
        const asset = readAssets()[n];
        const info = modelSources(asset ? { asset: n } : { url: n });
        if (info && !modelCache.has(info.key)) modelCache.set(info.key, await buildModel(info.ext, await info.get()));
      } else await loadSound(n, n);
    } catch (e) {
      toast('Could not load "' + str(a.NAME) + '": ' + (e && e.message ? e.message : e));
    } finally {
      resourceQueue.done++;
    }
  });
  cmd('unloadResource', 'unload [TYPE] [NAME]', { TYPE: A.m('resourceTypeMenu', 'picture'), NAME: A.s('') }, (a) => {
    const n = str(a.NAME).trim();
    const t = str(a.TYPE);
    if (t === 'picture') {
      const tex = textureCache.get('asset:' + n) || textureCache.get(n);
      if (tex) tex.dispose();
      textureCache.delete('asset:' + n);
      textureCache.delete(n);
    } else if (t === 'model') {
      const key = modelCache.has('asset:' + n) ? 'asset:' + n : 'url:' + n;
      const tpl = modelCache.get(key);
      if (tpl) {
        disposeObject(tpl);
        modelCache.delete(key);
      }
    } else {
      chanTargets(n).forEach(chanStopNow);
      sounds.delete(n);
    }
  });
  boo('resourceLoaded', '[TYPE] [NAME] loaded?', { TYPE: A.m('resourceTypeMenu', 'picture'), NAME: A.s('') }, (a) => {
    const n = str(a.NAME).trim();
    const t = str(a.TYPE);
    if (t === 'picture') return textureCache.has('asset:' + n) || textureCache.has(n);
    if (t === 'model') return modelCache.has('asset:' + n) || modelCache.has('url:' + n);
    return sounds.has(n);
  });
  rep('resourceListBlock', 'imported files and whether they are loaded', null, () => jsonList(resourceList()));
  rep('loadProgressBlock', 'resource loading progress %', null, () => (resourceQueue.total ? Math.round((resourceQueue.done / resourceQueue.total) * 100) : 100));
  boo('resourcesBusy', 'resources still loading?', null, () => resourceQueue.done < resourceQueue.total);
  rep('memoryUse', 'memory use (loaded textures, geometries)', null, () => (isReady ? perfInfo().textures + ' / ' + perfInfo().geometries : '0 / 0'));

  // ---------------------------------------------------------------
  // math helpers
  // ---------------------------------------------------------------
  lab('Math for 3D (vectors, noise, angles)');
  menu('compMenu', ['x', 'y', 'z']);
  rep('dist3', 'distance between x [X1] y [Y1] z [Z1] and x [X2] y [Y2] z [Z2]', { X1: A.n(0), Y1: A.n(0), Z1: A.n(0), X2: A.n(1), Y2: A.n(1), Z2: A.n(1) }, (a) =>
    Math.hypot(num(a.X1) - num(a.X2), num(a.Y1) - num(a.Y2), num(a.Z1) - num(a.Z2))
  );
  rep('dot3', 'dot product of [X1] [Y1] [Z1] and [X2] [Y2] [Z2]', { X1: A.n(1), Y1: A.n(0), Z1: A.n(0), X2: A.n(0), Y2: A.n(1), Z2: A.n(0) }, (a) =>
    num(a.X1) * num(a.X2) + num(a.Y1) * num(a.Y2) + num(a.Z1) * num(a.Z2)
  );
  rep('cross3', 'cross product [C] of [X1] [Y1] [Z1] and [X2] [Y2] [Z2]', { C: A.m('compMenu', 'x'), X1: A.n(1), Y1: A.n(0), Z1: A.n(0), X2: A.n(0), Y2: A.n(1), Z2: A.n(0) }, (a) => {
    const c = new THREE.Vector3(num(a.X1), num(a.Y1), num(a.Z1)).cross(new THREE.Vector3(num(a.X2), num(a.Y2), num(a.Z2)));
    return c[str(a.C)];
  });
  rep('normalize3', 'normalized [C] of [X] [Y] [Z]', { C: A.m('compMenu', 'x'), X: A.n(1), Y: A.n(2), Z: A.n(3) }, (a) => {
    const v = new THREE.Vector3(num(a.X), num(a.Y), num(a.Z));
    if (v.lengthSq() === 0) return 0;
    return v.normalize()[str(a.C)];
  });
  rep('lerpBlock', 'blend [A] to [B] by [T]', { A: A.n(0), B: A.n(10), T: A.n(0.5) }, (a) => xLerp(num(a.A), num(a.B), num(a.T)));
  rep('remapBlock', 'remap [V] from [A1] to [B1] into [A2] to [B2]', { V: A.n(5), A1: A.n(0), B1: A.n(10), A2: A.n(0), B2: A.n(1) }, (a) => {
    const span = num(a.B1) - num(a.A1);
    return span === 0 ? num(a.A2) : xLerp(num(a.A2), num(a.B2), (num(a.V) - num(a.A1)) / span);
  });
  rep('clampBlock', 'clamp [V] between [A] and [B]', { V: A.n(5), A: A.n(0), B: A.n(1) }, (a) => xClamp(num(a.V), Math.min(num(a.A), num(a.B)), Math.max(num(a.A), num(a.B))));
  rep('smoothstepBlock', 'smoothstep [V] from [A] to [B]', { V: A.n(0.5), A: A.n(0), B: A.n(1) }, (a) => {
    const t = xClamp((num(a.V) - num(a.A)) / (num(a.B) - num(a.A) || 1), 0, 1);
    return t * t * (3 - 2 * t);
  });
  rep('noise2dBlock', 'noise at [X] [Y] seed [SEED] (0 to 1)', { X: A.n(0.5), Y: A.n(0.5), SEED: A.n(1) }, (a) => Math.round(noise2(num(a.X), num(a.Y), num(a.SEED)) * 10000) / 10000);
  rep('noise3dBlock', 'noise at [X] [Y] [Z] seed [SEED] (0 to 1)', { X: A.n(0.5), Y: A.n(0.5), Z: A.n(0.5), SEED: A.n(1) }, (a) => Math.round(noise3(num(a.X), num(a.Y), num(a.Z), num(a.SEED)) * 10000) / 10000);
  rep('seededRandom', 'random from [A] to [B] with seed [SEED] number [N]', { A: A.n(0), B: A.n(1), SEED: A.n(1), N: A.n(1) }, (a) => {
    const r = xHash(Math.floor(num(a.N)), 7, 13, Math.floor(num(a.SEED)));
    return xLerp(num(a.A), num(a.B), r);
  });
  rep('yawBetween', 'turn angle from x [X1] z [Z1] to x [X2] z [Z2]', { X1: A.n(0), Z1: A.n(0), X2: A.n(0), Z2: A.n(-5) }, (a) =>
    Math.round(deg(Math.atan2(-(num(a.X2) - num(a.X1)), -(num(a.Z2) - num(a.Z1)))) * 1000) / 1000
  );

  // ---------------------------------------------------------------
  // debug and performance
  // ---------------------------------------------------------------
  lab('Debug and performance');
  menu('debugFeatureMenu', [
    { text: 'stats', value: 'stats' },
    { text: 'look at info', value: 'info' },
    { text: 'axes', value: 'axes' },
    { text: 'bounding boxes', value: 'bounds' },
    { text: 'colliders', value: 'colliders' },
    { text: 'names and ids', value: 'names' },
    { text: 'last ray', value: 'rays' },
    { text: 'wireframe', value: 'wireframe' }
  ]);
  menu('perfStatMenu', ['fps', 'frame ms', 'objects', 'triangles', 'draw calls', 'geometries', 'textures', 'scenes']);
  menu('debugShapeMenu', ['box', 'sphere']);
  cmd('setDebug', 'turn debug [FEATURE] [STATE]', { FEATURE: A.m('debugFeatureMenu', 'stats'), STATE: A.m('onOffMenu', 'on') }, async (a) => {
    await init();
    const k = str(a.FEATURE);
    const on = isOn(a.STATE);
    dbg[k] = on;
    if (k === 'wireframe') setWireframeAll(on);
    if (!on && k === 'names') updateDebugOverlay();
  });
  cmd('debugLineBlock', 'draw debug line from x [X1] y [Y1] z [Z1] to x [X2] y [Y2] z [Z2] color [COLOR] for [SECS] seconds', { X1: A.n(0), Y1: A.n(0), Z1: A.n(0), X2: A.n(0), Y2: A.n(2), Z2: A.n(0), COLOR: A.c('#ffcc00'), SECS: A.n(2) }, async (a) => {
    await init();
    debugLine(T3(a.X1, a.Y1, a.Z1), T3(a.X2, a.Y2, a.Z2), a.COLOR, num(a.SECS));
  });
  cmd('debugPointBlock', 'draw debug point at x [X] y [Y] z [Z] size [SIZE] color [COLOR] for [SECS] seconds', { X: A.n(0), Y: A.n(0), Z: A.n(0), SIZE: A.n(0.2), COLOR: A.c('#ffcc00'), SECS: A.n(2) }, async (a) => {
    await init();
    debugPoint(T3(a.X, a.Y, a.Z), a.COLOR, num(a.SECS), num(a.SIZE));
  });
  cmd('debugShapeBlock', 'draw debug [SHAPE] at x [X] y [Y] z [Z] size [SIZE] color [COLOR] for [SECS] seconds', { SHAPE: A.m('debugShapeMenu', 'box'), X: A.n(0), Y: A.n(0), Z: A.n(0), SIZE: A.n(1), COLOR: A.c('#ffcc00'), SECS: A.n(2) }, async (a) => {
    await init();
    debugShape(str(a.SHAPE), T3(a.X, a.Y, a.Z), Math.max(0.01, num(a.SIZE)), a.COLOR, num(a.SECS));
  });
  cmd('debugText', 'show [LABEL]: [VALUE] in the debug text', { LABEL: A.s('score'), VALUE: A.s('0') }, (a) => {
    dbgWatch.set(str(a.LABEL), str(a.VALUE));
    if (isReady) updateDebugOverlay();
  });
  cmd('clearDebugText', 'clear debug text', null, () => {
    dbgWatch.clear();
    if (isReady) updateDebugOverlay();
  });
  rep('perfStat', '[STAT]', { STAT: A.m('perfStatMenu', 'fps') }, (a) => {
    if (!isReady) return 0;
    const i = perfInfo();
    switch (str(a.STAT)) {
      case 'fps': return Math.round(fps);
      case 'frame ms': return Math.round(frameMs * 100) / 100;
      case 'objects': return objects.size;
      case 'triangles': return i.triangles;
      case 'draw calls': return i.calls;
      case 'geometries': return i.geometries;
      case 'textures': return i.textures;
      case 'scenes': return sceneNames().length;
    }
    return 0;
  });

  // ---------------------------------------------------------------
  // page / packaging
  // ---------------------------------------------------------------
  lab('Game window (works in the editor and in packaged games)');
  cmd('setPageTitle', 'set window title to [TITLE]', { TITLE: A.s('My Game') }, (a) => {
    document.title = str(a.TITLE);
  });
  cmd('setPageIconBlock', 'set window icon to [TEX]', { TEX: A.m('textureSourceMenu', 'none') }, (a) => {
    const s = str(a.TEX).trim();
    const asset = readAssets()[s];
    if (asset && asset.type === 'image') setPageIcon(asset.data);
    else if (/^(https?:|data:)/i.test(s)) setPageIcon(s);
  });
  cmd('setPageBackground', 'set page background color to [COLOR]', { COLOR: A.c('#000000') }, (a) => {
    document.body.style.backgroundColor = toColor(a.COLOR) ? '#' + toColor(a.COLOR).getHexString() : '';
  });

  // ===================================================================
  // v12 glue: runtime hooks and block registration
  // ===================================================================

  const autosave = { every: 0, slot: 'autosave', t: 0 };
  let pauseKeyProject = false;

  const keyMatches = (e, name) => {
    if (!name) return false;
    return keyCodes(name).indexOf(e.code) >= 0;
  };

  const setupV12 = () => {
    const rt = Scratch.vm.runtime;
    rt.on('BEFORE_EXECUTE', flushEvents);
    const restart = () => {
      if (projectPaused) setProjectPaused(false);
      if (enginePaused) setEnginePaused(false);
      TM.scale = 1;
    };
    rt.on('PROJECT_START', restart);
    rt.on('PROJECT_STOP_ALL', () => {
      restart();
      stopAllAudio();
      tweenClear();
      schedule = [];
      EV.now.clear();
      EV.pairsNow = [];
    });
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.repeat || !pauseKeyName || !keyMatches(e, pauseKeyName)) return;
      if (pauseKeyProject) setProjectPaused(!projectPaused);
      else setEnginePaused(!enginePaused);
    });
    const unlock = () => {
      if (actx && actx.state === 'suspended' && !isFrozen()) actx.resume().catch(() => {});
    };
    ['pointerdown', 'keydown'].forEach((n) => window.addEventListener(n, unlock, true));
    window.addEventListener('beforeunload', () => {
      if (projectPaused) setProjectPaused(false);
    });
  };

  const v12Extend = (info) => {
    const cut = info.blocks.findIndex((b) => b && b.opcode === 'loadProgress');
    info.blocks.splice(cut + 1, 0, ...V12.top);
    info.blocks.push(...V12.main);
    Object.assign(info.menus, V12.menus);
    const ps = info.menus.playerSettingMenu.items;
    [
      ['crouch speed (multiplier)', 'crouchSpeed'],
      ['crouch eye height', 'crouchEye'],
      ['slide (0 or 1)', 'slide'],
      ['slide speed boost', 'slideBoost'],
      ['slide duration', 'slideTime'],
      ['slide friction', 'slideFriction'],
      ['extra air jumps', 'airJumps'],
      ['wall jump (0 or 1)', 'wallJump'],
      ['wall jump push', 'wallKick'],
      ['jump cut (1 = off, 0.4 = short hops)', 'jumpCut'],
      ['coyote time', 'coyoteTime'],
      ['jump buffer time', 'jumpBuffer'],
      ['view bob', 'bob'],
      ['view bob speed', 'bobSpeed'],
      ['sprint field of view boost', 'sprintFov'],
      ['slide field of view boost', 'slideFov'],
      ['lean when strafing', 'lean'],
      ['landing shake', 'landShake'],
      ['landing dip', 'landDip'],
      ['sprint shake', 'sprintShake'],
      ['slide shake', 'slideShake'],
      ['fall reset height', 'fallY']
    ].forEach(([text, value]) => ps.push({ text, value }));
    info.menus.playerKeyMenu.items.push({ text: 'crouch / slide', value: 'crouch' });
  };


  class Turbo3D {
    constructor(category = null) {
      this.category = category;
    }

    getInfo() {
      const S = Scratch.ArgumentType.STRING;
      const N = Scratch.ArgumentType.NUMBER;
      const C = Scratch.ArgumentType.COLOR;
      const info = {
        id: 'turbo3d',
        name: '3D Turbo',
        color1: '#ff9acb',
        color2: '#ff7ab8',
        color3: '#e85aa0',
        blocks: [
          { blockType: Scratch.BlockType.LABEL, text: 'Version 12 (scenes, physics, audio, prefabs, saving, player styles, terrain)' },
          { blockType: Scratch.BlockType.LABEL, text: 'Loading (build your own loading screen with these)' },
          {
            opcode: 'loadWorld',
            blockType: Scratch.BlockType.COMMAND,
            text: 'load 3D world and wait'
          },
          { opcode: 'worldReady', blockType: Scratch.BlockType.BOOLEAN, text: '3D world ready?' },
          { opcode: 'whenWorldReady', blockType: Scratch.BlockType.HAT, text: 'when 3D world is ready' },
          { opcode: 'loadProgress', blockType: Scratch.BlockType.REPORTER, text: 'loading progress (0 to 100)' },
          { blockType: Scratch.BlockType.LABEL, text: 'Ready-made blocks' },
          {
            opcode: 'createBlockType',
            blockType: Scratch.BlockType.COMMAND,
            text: 'create [TYPE] block named [NAME] at x [X] y [Y] z [Z]',
            arguments: {
              TYPE: { type: S, menu: 'blockTypeMenu', defaultValue: 'grass' },
              NAME: { type: S, defaultValue: 'box' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'applyBlockType',
            blockType: Scratch.BlockType.COMMAND,
            text: 'make [NAME] a [TYPE] block',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              TYPE: { type: S, menu: 'blockTypeMenu', defaultValue: 'stone' }
            }
          },
          {
            opcode: 'setBlockTypeSurface',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set all [TYPE] blocks roughness [ROUGH] % metalness [METAL] %',
            arguments: {
              TYPE: { type: S, menu: 'blockTypeMenu', defaultValue: 'stone' },
              ROUGH: { type: N, defaultValue: 80 },
              METAL: { type: N, defaultValue: 0 }
            }
          },
          { opcode: 'blockTypes', blockType: Scratch.BlockType.REPORTER, text: 'block types' },
          { blockType: Scratch.BlockType.LABEL, text: 'World' },
          {
            opcode: 'showHide',
            blockType: Scratch.BlockType.COMMAND,
            text: '[STATE] 3D view',
            arguments: { STATE: { type: S, menu: 'viewMenu', defaultValue: 'show' } }
          },
          { opcode: 'resetWorld', blockType: Scratch.BlockType.COMMAND, text: 'reset 3D world' },
          {
            opcode: 'setBackground',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set sky color to [COLOR]',
            arguments: { COLOR: { type: C, defaultValue: '#ffe3f1' } }
          },
          {
            opcode: 'setSkyTexture',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set sky picture to link [URL]',
            arguments: { URL: { type: S, defaultValue: 'https://example.com/sky.jpg' } }
          },
          {
            opcode: 'setSkyAsset',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set sky picture to imported [ASSET]',
            arguments: { ASSET: { type: S, menu: 'imageMenu' } }
          },
          { opcode: 'clearBackground', blockType: Scratch.BlockType.COMMAND, text: 'make sky see through' },
          {
            opcode: 'setFog',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set fog color [COLOR] from [NEAR] to [FAR]',
            arguments: {
              COLOR: { type: C, defaultValue: '#ffe3f1' },
              NEAR: { type: N, defaultValue: 5 },
              FAR: { type: N, defaultValue: 30 }
            }
          },
          { opcode: 'fogOff', blockType: Scratch.BlockType.COMMAND, text: 'turn fog off' },

          { blockType: Scratch.BlockType.LABEL, text: 'My files' },
          {
            opcode: 'importFile',
            blockType: Scratch.BlockType.COMMAND,
            text: 'import file from my computer as [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'wall' } }
          },
          {
            opcode: 'deleteAsset',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete imported file [ASSET]',
            arguments: { ASSET: { type: S, menu: 'assetMenu' } }
          },
          { opcode: 'listAssets', blockType: Scratch.BlockType.REPORTER, text: 'imported files' },

          { blockType: Scratch.BlockType.LABEL, text: 'Objects' },
          {
            opcode: 'createShape',
            blockType: Scratch.BlockType.COMMAND,
            text: 'create [SHAPE] named [NAME] color [COLOR]',
            arguments: {
              SHAPE: { type: S, menu: 'shapeMenu', defaultValue: 'cube' },
              NAME: { type: S, defaultValue: 'box' },
              COLOR: { type: C, defaultValue: '#ff6fb5' }
            }
          },
          {
            opcode: 'cloneObject',
            blockType: Scratch.BlockType.COMMAND,
            text: 'clone [NAME] as [NEW]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              NEW: { type: S, defaultValue: 'box2' }
            }
          },
          {
            opcode: 'deleteObject',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          {
            opcode: 'setVisible',
            blockType: Scratch.BlockType.COMMAND,
            text: '[STATE] [NAME]',
            arguments: {
              STATE: { type: S, menu: 'viewMenu', defaultValue: 'show' },
              NAME: { type: S, defaultValue: 'box' }
            }
          },
          {
            opcode: 'setColor',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set color of [NAME] [FACE] to [COLOR]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              COLOR: { type: C, defaultValue: '#ff6fb5' }
            }
          },
          {
            opcode: 'setOpacity',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set opacity of [NAME] to [PERCENT] %',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              PERCENT: { type: N, defaultValue: 100 }
            }
          },
          {
            opcode: 'setSolid',
            blockType: Scratch.BlockType.COMMAND,
            text: 'make [NAME] [SOLID] for the player',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              SOLID: { type: S, menu: 'solidMenu', defaultValue: 'solid' }
            }
          },
          {
            opcode: 'setSurface',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set surface of [NAME] [FACE] shininess [SHINE] % metal [METAL] %',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              SHINE: { type: N, defaultValue: 0 },
              METAL: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'setRoughMetal',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set [NAME] [FACE] roughness [ROUGH] % metalness [METAL] %',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              ROUGH: { type: N, defaultValue: 60 },
              METAL: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'objectExists',
            blockType: Scratch.BlockType.BOOLEAN,
            text: '[NAME] exists?',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Groups (manage lots of blocks)' },
          {
            opcode: 'createAt',
            blockType: Scratch.BlockType.COMMAND,
            text: 'create [SHAPE] at x [X] y [Y] z [Z] in group [GROUP] color [COLOR]',
            arguments: {
              SHAPE: { type: S, menu: 'shapeMenu', defaultValue: 'cube' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 },
              GROUP: { type: S, defaultValue: 'blocks' },
              COLOR: { type: C, defaultValue: '#ff6fb5' }
            }
          },
          {
            opcode: 'stampCopy',
            blockType: Scratch.BlockType.COMMAND,
            text: 'place a copy of [NAME] at x [X] y [Y] z [Z] in group [GROUP]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 },
              GROUP: { type: S, defaultValue: 'blocks' }
            }
          },
          { opcode: 'lastCreated', blockType: Scratch.BlockType.REPORTER, text: 'last created object' },
          { blockType: Scratch.BlockType.LABEL, text: 'Create with textures (no color needed)' },
          {
            opcode: 'createTextured',
            blockType: Scratch.BlockType.COMMAND,
            text: 'create [SHAPE] named [NAME] with texture [TEX]',
            arguments: {
              SHAPE: { type: S, menu: 'shapeMenu', defaultValue: 'cube' },
              NAME: { type: S, defaultValue: 'box' },
              TEX: { type: S, menu: 'textureSourceMenu' }
            }
          },
          {
            opcode: 'createAtTextured',
            blockType: Scratch.BlockType.COMMAND,
            text: 'create [SHAPE] at x [X] y [Y] z [Z] in group [GROUP] with texture [TEX]',
            arguments: {
              SHAPE: { type: S, menu: 'shapeMenu', defaultValue: 'cube' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 },
              GROUP: { type: S, defaultValue: 'blocks' },
              TEX: { type: S, menu: 'textureSourceMenu' }
            }
          },
          {
            opcode: 'setTextureSource',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set texture of [NAME] [FACE] to [TEX]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              TEX: { type: S, menu: 'textureSourceMenu' }
            }
          },
          {
            opcode: 'setDefaultTexture',
            blockType: Scratch.BlockType.COMMAND,
            text: 'every new object I create gets texture [TEX] (no color needed)',
            arguments: { TEX: { type: S, menu: 'textureSourceMenu' } }
          },
          { opcode: 'clearDefaultTexture', blockType: Scratch.BlockType.COMMAND, text: 'new objects use plain colors again' },

          {
            opcode: 'addToGroup',
            blockType: Scratch.BlockType.COMMAND,
            text: 'add [NAME] to group [GROUP]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              GROUP: { type: S, defaultValue: 'blocks' }
            }
          },
          {
            opcode: 'groupOf',
            blockType: Scratch.BlockType.REPORTER,
            text: 'group of [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          {
            opcode: 'deleteGroup',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete everything in group [GROUP]',
            arguments: { GROUP: { type: S, defaultValue: 'blocks' } }
          },
          {
            opcode: 'groupCount',
            blockType: Scratch.BlockType.REPORTER,
            text: 'number of objects in group [GROUP]',
            arguments: { GROUP: { type: S, defaultValue: 'blocks' } }
          },
          {
            opcode: 'groupItem',
            blockType: Scratch.BlockType.REPORTER,
            text: 'object [N] in group [GROUP]',
            arguments: {
              N: { type: N, defaultValue: 1 },
              GROUP: { type: S, defaultValue: 'blocks' }
            }
          },
          {
            opcode: 'listGroup',
            blockType: Scratch.BlockType.REPORTER,
            text: 'objects in group [GROUP]',
            arguments: { GROUP: { type: S, defaultValue: 'blocks' } }
          },
          {
            opcode: 'objectAt',
            blockType: Scratch.BlockType.REPORTER,
            text: 'object at x [X] y [Y] z [Z]',
            arguments: {
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Textures (face = whole thing or one side)' },
          {
            opcode: 'setTextureAsset',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set texture of [NAME] [FACE] to imported [ASSET]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              ASSET: { type: S, menu: 'imageMenu' }
            }
          },
          {
            opcode: 'setTextureCostume',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set texture of [NAME] [FACE] to costume [COSTUME] of this sprite',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              COSTUME: { type: S, menu: 'costumeMenu' }
            }
          },
          {
            opcode: 'setTextureURL',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set texture of [NAME] [FACE] to link [URL]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              URL: { type: S, defaultValue: 'https://example.com/texture.png' }
            }
          },
          {
            opcode: 'repeatTexture',
            blockType: Scratch.BlockType.COMMAND,
            text: 'repeat texture of [NAME] [FACE] x [X] y [Y] times',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              X: { type: N, defaultValue: 1 },
              Y: { type: N, defaultValue: 1 }
            }
          },
          {
            opcode: 'textureFilter',
            blockType: Scratch.BlockType.COMMAND,
            text: 'make texture of [NAME] [FACE] [FILTER]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' },
              FILTER: { type: S, menu: 'filterMenu', defaultValue: 'pixelated' }
            }
          },
          {
            opcode: 'removeTexture',
            blockType: Scratch.BlockType.COMMAND,
            text: 'remove texture from [NAME] [FACE]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              FACE: { type: S, menu: 'faceMenu', defaultValue: 'all' }
            }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Models' },
          {
            opcode: 'loadModelAsset',
            blockType: Scratch.BlockType.COMMAND,
            text: 'load imported model [ASSET] named [NAME]',
            arguments: {
              ASSET: { type: S, menu: 'modelMenu' },
              NAME: { type: S, defaultValue: 'model' }
            }
          },
          {
            opcode: 'loadModel',
            blockType: Scratch.BlockType.COMMAND,
            text: 'load model from link [URL] named [NAME]',
            arguments: {
              URL: { type: S, defaultValue: 'https://example.com/model.glb' },
              NAME: { type: S, defaultValue: 'model' }
            }
          },
          {
            opcode: 'fitSize',
            blockType: Scratch.BlockType.COMMAND,
            text: 'make [NAME] about [SIZE] units big',
            arguments: {
              NAME: { type: S, defaultValue: 'model' },
              SIZE: { type: N, defaultValue: 2 }
            }
          },
          {
            opcode: 'playAnimation',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play animation [ANIM] on [NAME]',
            arguments: {
              ANIM: { type: S, defaultValue: '1' },
              NAME: { type: S, defaultValue: 'model' }
            }
          },
          {
            opcode: 'stopAnimation',
            blockType: Scratch.BlockType.COMMAND,
            text: 'stop animations on [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'model' } }
          },
          {
            opcode: 'listAnimations',
            blockType: Scratch.BlockType.REPORTER,
            text: 'animations of [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'model' } }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Moving things' },
          {
            opcode: 'setPosition',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set [NAME] position to x [X] y [Y] z [Z]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'setRotation',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set [NAME] rotation to x [X] y [Y] z [Z]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'setScale',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set [NAME] size to x [X] y [Y] z [Z]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              X: { type: N, defaultValue: 1 },
              Y: { type: N, defaultValue: 1 },
              Z: { type: N, defaultValue: 1 }
            }
          },
          {
            opcode: 'setProp',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set [PROP] [AXIS] of [NAME] to [VALUE]',
            arguments: {
              PROP: { type: S, menu: 'propMenu', defaultValue: 'position' },
              AXIS: { type: S, menu: 'axisMenu', defaultValue: 'y' },
              NAME: { type: S, defaultValue: 'box' },
              VALUE: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'changeProp',
            blockType: Scratch.BlockType.COMMAND,
            text: 'change [PROP] [AXIS] of [NAME] by [VALUE]',
            arguments: {
              PROP: { type: S, menu: 'propMenu', defaultValue: 'position' },
              AXIS: { type: S, menu: 'axisMenu', defaultValue: 'y' },
              NAME: { type: S, defaultValue: 'box' },
              VALUE: { type: N, defaultValue: 1 }
            }
          },
          {
            opcode: 'getProp',
            blockType: Scratch.BlockType.REPORTER,
            text: '[PROP] [AXIS] of [NAME]',
            arguments: {
              PROP: { type: S, menu: 'propMenu', defaultValue: 'position' },
              AXIS: { type: S, menu: 'axisMenu', defaultValue: 'y' },
              NAME: { type: S, defaultValue: 'box' }
            }
          },
          {
            opcode: 'moveForward',
            blockType: Scratch.BlockType.COMMAND,
            text: 'move [NAME] [STEPS] steps forward',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              STEPS: { type: N, defaultValue: 1 }
            }
          },
          {
            opcode: 'distance',
            blockType: Scratch.BlockType.REPORTER,
            text: 'distance from [A] to [B]',
            arguments: {
              A: { type: S, defaultValue: 'player' },
              B: { type: S, defaultValue: 'box' }
            }
          },
          {
            opcode: 'touching',
            blockType: Scratch.BlockType.BOOLEAN,
            text: '[A] touching [B]?',
            arguments: {
              A: { type: S, defaultValue: 'box' },
              B: { type: S, defaultValue: 'model' }
            }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Player (premade)' },
          {
            opcode: 'setPlayerMode',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set player controls to [MODE]',
            arguments: { MODE: { type: S, menu: 'playerModeMenu', defaultValue: 'fp' } }
          },
          {
            opcode: 'teleportPlayer',
            blockType: Scratch.BlockType.COMMAND,
            text: 'teleport player to x [X] y [Y] z [Z]',
            arguments: {
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'setPlayerSetting',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set player [SETTING] to [VALUE]',
            arguments: {
              SETTING: { type: S, menu: 'playerSettingMenu', defaultValue: 'walkSpeed' },
              VALUE: { type: N, defaultValue: 4 }
            }
          },
          {
            opcode: 'setPlayerKey',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set player [ACTION] key to [KEY]',
            arguments: {
              ACTION: { type: S, menu: 'playerKeyMenu', defaultValue: 'forward' },
              KEY: { type: S, defaultValue: 'w' }
            }
          },
          {
            opcode: 'setFloor',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set invisible floor [STATE] at height [Y]',
            arguments: {
              STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' },
              Y: { type: N, defaultValue: 0 }
            }
          },
          { opcode: 'playerOnGround', blockType: Scratch.BlockType.BOOLEAN, text: 'player on ground?' },
          { opcode: 'playerX', blockType: Scratch.BlockType.REPORTER, text: 'player x' },
          { opcode: 'playerY', blockType: Scratch.BlockType.REPORTER, text: 'player y (feet)' },
          { opcode: 'playerZ', blockType: Scratch.BlockType.REPORTER, text: 'player z' },
          {
            opcode: 'playerInfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'player [INFO]',
            arguments: { INFO: { type: S, menu: 'playerInfoMenu', defaultValue: 'eye y' } }
          },


          { blockType: Scratch.BlockType.LABEL, text: 'Camera (manual)' },
          {
            opcode: 'setCamPos',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set camera position to x [X] y [Y] z [Z]',
            arguments: {
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 1.6 },
              Z: { type: N, defaultValue: 5 }
            }
          },
          {
            opcode: 'moveCam',
            blockType: Scratch.BlockType.COMMAND,
            text: 'move camera [DIR] by [STEPS]',
            arguments: {
              DIR: { type: S, menu: 'camDirMenu', defaultValue: 'forward' },
              STEPS: { type: N, defaultValue: 0.1 }
            }
          },
          {
            opcode: 'moveCamBy',
            blockType: Scratch.BlockType.COMMAND,
            text: 'move camera forward [F] right [R] up [U]',
            arguments: {
              F: { type: N, defaultValue: 0 },
              R: { type: N, defaultValue: 0 },
              U: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'setCamAngle',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set camera turn [YAW] tilt [PITCH]',
            arguments: {
              YAW: { type: N, defaultValue: 0 },
              PITCH: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'turnCam',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn camera by [YAW] tilt by [PITCH]',
            arguments: {
              YAW: { type: N, defaultValue: 2 },
              PITCH: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'pointCam',
            blockType: Scratch.BlockType.COMMAND,
            text: 'point camera at x [X] y [Y] z [Z]',
            arguments: {
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'setFlyMode',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set manual camera movement to [MODE]',
            arguments: { MODE: { type: S, menu: 'modeMenu', defaultValue: 'fly' } }
          },
          {
            opcode: 'getCam',
            blockType: Scratch.BlockType.REPORTER,
            text: 'camera [PROP]',
            arguments: { PROP: { type: S, menu: 'camPropMenu', defaultValue: 'x' } }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Mouse' },
          {
            opcode: 'setMouseLook',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn mouse look [STATE]',
            arguments: { STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' } }
          },
          { opcode: 'releaseMouse', blockType: Scratch.BlockType.COMMAND, text: 'release mouse' },
          {
            opcode: 'mouseDelta',
            blockType: Scratch.BlockType.REPORTER,
            text: 'mouse moved [AXIS] this frame',
            arguments: { AXIS: { type: S, menu: 'deltaMenu', defaultValue: 'x' } }
          },
          { opcode: 'mouseLocked', blockType: Scratch.BlockType.BOOLEAN, text: 'mouse captured?' },

          { blockType: Scratch.BlockType.LABEL, text: 'Reach, looking and clicking' },
          {
            opcode: 'setReach',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set reach to [DIST]',
            arguments: { DIST: { type: N, defaultValue: 5 } }
          },
          { opcode: 'reachValue', blockType: Scratch.BlockType.REPORTER, text: 'reach' },
          { opcode: 'lookingAt', blockType: Scratch.BlockType.REPORTER, text: 'object I am looking at' },
          {
            opcode: 'lookingAtWithin',
            blockType: Scratch.BlockType.REPORTER,
            text: 'object I am looking at within [DIST]',
            arguments: { DIST: { type: N, defaultValue: 3 } }
          },
          { opcode: 'lookingAtAnything', blockType: Scratch.BlockType.BOOLEAN, text: 'looking at anything in reach?' },
          {
            opcode: 'lookingAtObject',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'looking at [NAME] in reach?',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          {
            opcode: 'lookingAtObjectWithin',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'looking at [NAME] within [DIST]?',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              DIST: { type: N, defaultValue: 3 }
            }
          },
          {
            opcode: 'inReach',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'is [NAME] within reach of player?',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          {
            opcode: 'lookHitInfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'looked at spot [INFO]',
            arguments: { INFO: { type: S, menu: 'hitMenu', defaultValue: 'x' } }
          },
          {
            opcode: 'whenLookingAt',
            blockType: Scratch.BlockType.HAT,
            isEdgeActivated: true,
            text: 'when I look at [NAME] in reach',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          {
            opcode: 'whenClicked',
            blockType: Scratch.BlockType.HAT,
            isEdgeActivated: true,
            text: 'when I [BUTTON] click [NAME] in reach',
            arguments: {
              BUTTON: { type: S, menu: 'buttonMenu', defaultValue: 'left' },
              NAME: { type: S, defaultValue: 'box' }
            }
          },
          {
            opcode: 'whenClickedAny',
            blockType: Scratch.BlockType.HAT,
            isEdgeActivated: true,
            text: 'when I [BUTTON] click anything in reach',
            arguments: { BUTTON: { type: S, menu: 'buttonMenu', defaultValue: 'left' } }
          },
          {
            opcode: 'mouseHeld',
            blockType: Scratch.BlockType.BOOLEAN,
            text: '[BUTTON] mouse button held?',
            arguments: { BUTTON: { type: S, menu: 'buttonMenu', defaultValue: 'left' } }
          },
          {
            opcode: 'setHoverShade',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn hover shade [STATE] darkness [PERCENT] %',
            arguments: {
              STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' },
              PERCENT: { type: N, defaultValue: 25 }
            }
          },
          {
            opcode: 'setObjectHover',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn hover shade on [NAME] [STATE]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' }
            }
          },
          {
            opcode: 'playerTouching',
            blockType: Scratch.BlockType.BOOLEAN,
            text: '[NAME] touching player?',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          {
            opcode: 'whatTouching',
            blockType: Scratch.BlockType.REPORTER,
            text: 'object touching [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          {
            opcode: 'countTouching',
            blockType: Scratch.BlockType.REPORTER,
            text: 'number of objects touching [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          {
            opcode: 'setHighlight',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn highlight on [NAME] [STATE]',
            arguments: {
              NAME: { type: S, defaultValue: 'box' },
              STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' }
            }
          },
          {
            opcode: 'setCrosshair',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn crosshair [STATE]',
            arguments: { STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' } }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Editor (gizmo)' },
          {
            opcode: 'setGizmo',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set gizmo to [GIZMO]',
            arguments: { GIZMO: { type: S, menu: 'gizmoMenu', defaultValue: 'translate' } }
          },
          {
            opcode: 'setGizmoSpace',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set gizmo space to [SPACE]',
            arguments: { SPACE: { type: S, menu: 'spaceMenu', defaultValue: 'world' } }
          },
          {
            opcode: 'setSnap',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set shift snapping: move [MOVE] rotate [ROT] size [SIZE]',
            arguments: {
              MOVE: { type: N, defaultValue: 0.5 },
              ROT: { type: N, defaultValue: 15 },
              SIZE: { type: N, defaultValue: 0.25 }
            }
          },
          {
            opcode: 'selectObjectBlock',
            blockType: Scratch.BlockType.COMMAND,
            text: 'select [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'box' } }
          },
          { opcode: 'deselectBlock', blockType: Scratch.BlockType.COMMAND, text: 'deselect' },
          { opcode: 'selectedObject', blockType: Scratch.BlockType.REPORTER, text: 'selected object' },

          { blockType: Scratch.BlockType.LABEL, text: 'Sprites (always in front of the 3D background)' },
          {
            opcode: 'setUiSprite',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn on-top-of-3D [STATE] for this sprite (default: on)',
            arguments: { STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' } }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Particles' },
          {
            opcode: 'particleBurst',
            blockType: Scratch.BlockType.COMMAND,
            text: 'burst [COUNT] particles at x [X] y [Y] z [Z] colors [C1] and [C2] size [SIZE] speed [SPEED]',
            arguments: {
              COUNT: { type: N, defaultValue: 20 },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 1 },
              Z: { type: N, defaultValue: 0 },
              C1: { type: C, defaultValue: '#ff9a3c' },
              C2: { type: C, defaultValue: '#ffd84a' },
              SIZE: { type: N, defaultValue: 0.15 },
              SPEED: { type: N, defaultValue: 4 }
            }
          },
          {
            opcode: 'particleBurstFrom',
            blockType: Scratch.BlockType.COMMAND,
            text: 'burst [COUNT] particles from [NAME] using its colors size [SIZE] speed [SPEED]',
            arguments: {
              COUNT: { type: N, defaultValue: 16 },
              NAME: { type: S, defaultValue: 'box' },
              SIZE: { type: N, defaultValue: 0.15 },
              SPEED: { type: N, defaultValue: 3 }
            }
          },
          {
            opcode: 'setParticleSettings',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set particles: life [LIFE] seconds gravity [GRAVITY] shape [SHAPE]',
            arguments: {
              LIFE: { type: N, defaultValue: 1 },
              GRAVITY: { type: N, defaultValue: 14 },
              SHAPE: { type: S, menu: 'particleShapeMenu', defaultValue: 'cube' }
            }
          },
          { opcode: 'clearParticlesBlock', blockType: Scratch.BlockType.COMMAND, text: 'clear all particles' },
          { opcode: 'particleCount', blockType: Scratch.BlockType.REPORTER, text: 'particle count' },

          { blockType: Scratch.BlockType.LABEL, text: 'Particle emitters (like Unity: make one, tweak it, attach it to things)' },
          {
            opcode: 'createEmitter',
            blockType: Scratch.BlockType.COMMAND,
            text: 'create emitter [NAME] from preset [PRESET] at x [X] y [Y] z [Z]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              PRESET: { type: S, menu: 'presetMenu', defaultValue: 'fire' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'emitterAction',
            blockType: Scratch.BlockType.COMMAND,
            text: '[ACTION] emitter [NAME]',
            arguments: {
              ACTION: { type: S, menu: 'emitterActionMenu', defaultValue: 'play' },
              NAME: { type: S, defaultValue: 'fire1' }
            }
          },
          {
            opcode: 'emitNow',
            blockType: Scratch.BlockType.COMMAND,
            text: 'emit [COUNT] particles now from emitter [NAME]',
            arguments: {
              COUNT: { type: N, defaultValue: 20 },
              NAME: { type: S, defaultValue: 'fire1' }
            }
          },
          {
            opcode: 'moveEmitter',
            blockType: Scratch.BlockType.COMMAND,
            text: 'move emitter [NAME] to x [X] y [Y] z [Z]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'attachEmitter',
            blockType: Scratch.BlockType.COMMAND,
            text: 'attach emitter [NAME] to [TARGET] with offset x [X] y [Y] z [Z]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              TARGET: { type: S, defaultValue: 'player' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 1 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'detachEmitter',
            blockType: Scratch.BlockType.COMMAND,
            text: 'detach emitter [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'fire1' } }
          },
          {
            opcode: 'aimEmitter',
            blockType: Scratch.BlockType.COMMAND,
            text: 'aim emitter [NAME] direction x [X] y [Y] z [Z]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 1 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'aimEmitterLook',
            blockType: Scratch.BlockType.COMMAND,
            text: 'aim emitter [NAME] where the player looks',
            arguments: { NAME: { type: S, defaultValue: 'fire1' } }
          },
          {
            opcode: 'setEmitterNum',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set emitter [NAME] [SETTING] to [VALUE]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              SETTING: { type: S, menu: 'emitterSettingMenu', defaultValue: 'rate' },
              VALUE: { type: N, defaultValue: 20 }
            }
          },
          {
            opcode: 'setEmitterColor',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set emitter [NAME] [WHICH] to [COLOR]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              WHICH: { type: S, menu: 'emitterColorMenu', defaultValue: 'start color' },
              COLOR: { type: C, defaultValue: '#ff9a3c' }
            }
          },
          {
            opcode: 'setEmitterShape',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set emitter [NAME] spawn shape to [SHAPE]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              SHAPE: { type: S, menu: 'emitShapeMenu', defaultValue: 'cone' }
            }
          },
          {
            opcode: 'setEmitterLook',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set emitter [NAME] particle look to [LOOK]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              LOOK: { type: S, menu: 'emitLookMenu', defaultValue: 'soft glow' }
            }
          },
          {
            opcode: 'setEmitterToggle',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn [OPTION] [STATE] for emitter [NAME]',
            arguments: {
              OPTION: { type: S, menu: 'emitterToggleMenu', defaultValue: 'additive glow' },
              STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' },
              NAME: { type: S, defaultValue: 'fire1' }
            }
          },
          {
            opcode: 'setEmitterFloor',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set emitter [NAME] floor behavior to [FLOOR]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              FLOOR: { type: S, menu: 'emitFloorMenu', defaultValue: 'bounce' }
            }
          },
          {
            opcode: 'setEmitterTexture',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set emitter [NAME] texture to [TEX]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              TEX: { type: S, menu: 'textureSourceMenu' }
            }
          },
          {
            opcode: 'clearEmitterTexture',
            blockType: Scratch.BlockType.COMMAND,
            text: 'remove texture from emitter [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'fire1' } }
          },
          {
            opcode: 'emitterInfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'emitter [NAME] [INFO]',
            arguments: {
              NAME: { type: S, defaultValue: 'fire1' },
              INFO: { type: S, menu: 'emitterInfoMenu', defaultValue: 'particles alive' }
            }
          },
          {
            opcode: 'emitterExists',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'emitter [NAME] exists?',
            arguments: { NAME: { type: S, defaultValue: 'fire1' } }
          },
          {
            opcode: 'emitterPlaying',
            blockType: Scratch.BlockType.BOOLEAN,
            text: 'emitter [NAME] is emitting?',
            arguments: { NAME: { type: S, defaultValue: 'fire1' } }
          },
          { opcode: 'listEmitters', blockType: Scratch.BlockType.REPORTER, text: 'emitters' },
          { opcode: 'emitterParticleTotal', blockType: Scratch.BlockType.REPORTER, text: 'emitter particles alive (all)' },

          { blockType: Scratch.BlockType.LABEL, text: 'One-shot effects (spawn and forget, they clean up by themselves)' },
          {
            opcode: 'playEffect',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play effect [PRESET] at x [X] y [Y] z [Z] (continuous ones last [SECS] s)',
            arguments: {
              PRESET: { type: S, menu: 'presetMenu', defaultValue: 'explosion' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 1 },
              Z: { type: N, defaultValue: 0 },
              SECS: { type: N, defaultValue: 3 }
            }
          },
          {
            opcode: 'playEffectAtPlayer',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play effect [PRESET] at player [PLACE] (continuous ones last [SECS] s)',
            arguments: {
              PRESET: { type: S, menu: 'presetMenu', defaultValue: 'dust' },
              PLACE: { type: S, menu: 'playerPlaceMenu', defaultValue: 'feet' },
              SECS: { type: N, defaultValue: 3 }
            }
          },
          {
            opcode: 'playEffectAtObject',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play effect [PRESET] at the middle of [NAME] (continuous ones last [SECS] s)',
            arguments: {
              PRESET: { type: S, menu: 'presetMenu', defaultValue: 'sparks' },
              NAME: { type: S, defaultValue: 'box' },
              SECS: { type: N, defaultValue: 3 }
            }
          },
          {
            opcode: 'playEffectAtLook',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play effect [PRESET] where I am looking (continuous ones last [SECS] s)',
            arguments: {
              PRESET: { type: S, menu: 'presetMenu', defaultValue: 'sparks' },
              SECS: { type: N, defaultValue: 3 }
            }
          },
          {
            opcode: 'playEffectFromObject',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play effect [PRESET] out of [NAME] using its colors / texture',
            arguments: {
              PRESET: { type: S, menu: 'presetMenu', defaultValue: 'debris' },
              NAME: { type: S, defaultValue: 'box' }
            }
          },


          { blockType: Scratch.BlockType.LABEL, text: 'Lights' },
          {
            opcode: 'setAmbient',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set ambient light color [COLOR] brightness [B]',
            arguments: {
              COLOR: { type: C, defaultValue: '#ffffff' },
              B: { type: N, defaultValue: 0.8 }
            }
          },
          {
            opcode: 'setSun',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set sun color [COLOR] brightness [B] from x [X] y [Y] z [Z]',
            arguments: {
              COLOR: { type: C, defaultValue: '#ffffff' },
              B: { type: N, defaultValue: 2 },
              X: { type: N, defaultValue: 3 },
              Y: { type: N, defaultValue: 6 },
              Z: { type: N, defaultValue: 4 }
            }
          },
          {
            opcode: 'addPointLight',
            blockType: Scratch.BlockType.COMMAND,
            text: 'add point light [NAME] color [COLOR] brightness [B] at x [X] y [Y] z [Z]',
            arguments: {
              NAME: { type: S, defaultValue: 'lamp' },
              COLOR: { type: C, defaultValue: '#ffb3d9' },
              B: { type: N, defaultValue: 1 },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 3 },
              Z: { type: N, defaultValue: 0 }
            }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Settings' },
          {
            opcode: 'setFov',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set field of view to [FOV]',
            arguments: { FOV: { type: N, defaultValue: 70 } }
          },
          {
            opcode: 'setViewDistance',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set view distance to [DIST]',
            arguments: { DIST: { type: N, defaultValue: 200 } }
          },
          {
            opcode: 'setSensitivity',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set mouse sensitivity to [SENS]',
            arguments: { SENS: { type: N, defaultValue: 0.15 } }
          },
          {
            opcode: 'setShadows',
            blockType: Scratch.BlockType.COMMAND,
            text: 'turn shadows [STATE]',
            arguments: { STATE: { type: S, menu: 'onOffMenu', defaultValue: 'on' } }
          },
          {
            opcode: 'setQuality',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set render quality to [PERCENT] %',
            arguments: { PERCENT: { type: N, defaultValue: 100 } }
          },
          { opcode: 'getFps', blockType: Scratch.BlockType.REPORTER, text: 'fps' },
          { opcode: 'objectCount', blockType: Scratch.BlockType.REPORTER, text: 'object count' },

          { blockType: Scratch.BlockType.LABEL, text: 'Selectors, tags and data (every [NAME] box in the extension understands these)' },
          { blockType: Scratch.BlockType.LABEL, text: 'box*  box{1-25}  #tag  @cube  $hp>3  a,b  @cube&#red  !#dead  *' },
          {
            opcode: 'addTag',
            blockType: Scratch.BlockType.COMMAND,
            text: 'tag [NAME] as [TAG]',
            arguments: {
              NAME: { type: S, defaultValue: 'box{1-25}' },
              TAG: { type: S, defaultValue: 'enemy' }
            }
          },
          {
            opcode: 'removeTag',
            blockType: Scratch.BlockType.COMMAND,
            text: 'remove tag [TAG] from [NAME]',
            arguments: {
              TAG: { type: S, defaultValue: 'enemy' },
              NAME: { type: S, defaultValue: '#enemy' }
            }
          },
          {
            opcode: 'hasTag',
            blockType: Scratch.BlockType.BOOLEAN,
            text: '[NAME] has tag [TAG]?',
            arguments: {
              NAME: { type: S, defaultValue: 'box1' },
              TAG: { type: S, defaultValue: 'enemy' }
            }
          },
          {
            opcode: 'tagsOfObject',
            blockType: Scratch.BlockType.REPORTER,
            text: 'tags of [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'box1' } }
          },
          {
            opcode: 'setData',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set data [KEY] of [NAME] to [VALUE]',
            arguments: {
              KEY: { type: S, defaultValue: 'hp' },
              NAME: { type: S, defaultValue: '#enemy' },
              VALUE: { type: S, defaultValue: 10 }
            }
          },
          {
            opcode: 'changeData',
            blockType: Scratch.BlockType.COMMAND,
            text: 'change data [KEY] of [NAME] by [VALUE]',
            arguments: {
              KEY: { type: S, defaultValue: 'hp' },
              NAME: { type: S, defaultValue: '#enemy' },
              VALUE: { type: N, defaultValue: -1 }
            }
          },
          {
            opcode: 'deleteData',
            blockType: Scratch.BlockType.COMMAND,
            text: 'delete data [KEY] of [NAME]',
            arguments: {
              KEY: { type: S, defaultValue: 'hp' },
              NAME: { type: S, defaultValue: '#enemy' }
            }
          },
          {
            opcode: 'getData',
            blockType: Scratch.BlockType.REPORTER,
            text: 'data [KEY] of [NAME]',
            arguments: {
              KEY: { type: S, defaultValue: 'hp' },
              NAME: { type: S, defaultValue: 'box1' }
            }
          },
          {
            opcode: 'copyFrom',
            blockType: Scratch.BlockType.COMMAND,
            text: 'copy [WHAT] from [FROM] to [TO]',
            arguments: {
              WHAT: { type: S, menu: 'copyMenu', defaultValue: 'all data' },
              FROM: { type: S, defaultValue: 'box1' },
              TO: { type: S, defaultValue: 'box{2-25}' }
            }
          },

          { blockType: Scratch.BlockType.LABEL, text: 'Finding and reading many objects at once' },
          {
            opcode: 'matchingList',
            blockType: Scratch.BlockType.REPORTER,
            text: 'objects matching [SELECTOR]',
            arguments: { SELECTOR: { type: S, defaultValue: '@cube' } }
          },
          {
            opcode: 'matchingCount',
            blockType: Scratch.BlockType.REPORTER,
            text: 'how many match [SELECTOR]',
            arguments: { SELECTOR: { type: S, defaultValue: '#enemy' } }
          },
          {
            opcode: 'matchingNth',
            blockType: Scratch.BlockType.REPORTER,
            text: 'object [N] matching [SELECTOR]',
            arguments: {
              N: { type: N, defaultValue: 1 },
              SELECTOR: { type: S, defaultValue: '#enemy' }
            }
          },
          {
            opcode: 'typeOfObject',
            blockType: Scratch.BlockType.REPORTER,
            text: 'type of [NAME]',
            arguments: { NAME: { type: S, defaultValue: 'box1' } }
          },
          {
            opcode: 'objectInfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'info of [NAME] (as JSON)',
            arguments: { NAME: { type: S, defaultValue: 'box1' } }
          },
          {
            opcode: 'statProp',
            blockType: Scratch.BlockType.REPORTER,
            text: '[AGG] of [PROP] [AXIS] over [SELECTOR]',
            arguments: {
              AGG: { type: S, menu: 'aggMenu', defaultValue: 'average' },
              PROP: { type: S, menu: 'propMenu', defaultValue: 'position' },
              AXIS: { type: S, menu: 'axisMenu', defaultValue: 'y' },
              SELECTOR: { type: S, defaultValue: '@cube' }
            }
          },
          {
            opcode: 'statData',
            blockType: Scratch.BlockType.REPORTER,
            text: '[AGG] of data [KEY] over [SELECTOR]',
            arguments: {
              AGG: { type: S, menu: 'aggMenu', defaultValue: 'sum' },
              KEY: { type: S, defaultValue: 'hp' },
              SELECTOR: { type: S, defaultValue: '#enemy' }
            }
          },
          {
            opcode: 'nearestTo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'nearest of [SELECTOR] to x [X] y [Y] z [Z]',
            arguments: {
              SELECTOR: { type: S, defaultValue: '#enemy' },
              X: { type: N, defaultValue: 0 },
              Y: { type: N, defaultValue: 0 },
              Z: { type: N, defaultValue: 0 }
            }
          },
          {
            opcode: 'nearestToPlayer',
            blockType: Scratch.BlockType.REPORTER,
            text: 'nearest of [SELECTOR] to the player',
            arguments: { SELECTOR: { type: S, defaultValue: '#enemy' } }
          },
          { blockType: Scratch.BlockType.LABEL, text: 'Loop: one object per frame, unless it sits in a "run without screen refresh" custom block' },
          {
            opcode: 'forEachObject',
            blockType: Scratch.BlockType.LOOP,
            text: 'for each object matching [SELECTOR]',
            arguments: { SELECTOR: { type: S, defaultValue: '#enemy' } }
          },
          { opcode: 'eachObject', blockType: Scratch.BlockType.REPORTER, text: 'each object' },
          { opcode: 'eachIndex', blockType: Scratch.BlockType.REPORTER, text: 'each index' }

        ],
        menus: {
          viewMenu: { acceptReporters: false, items: ['show', 'hide'] },
          onOffMenu: { acceptReporters: false, items: ['on', 'off'] },
          shapeMenu: { acceptReporters: false, items: ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'floor'] },
          propMenu: { acceptReporters: false, items: ['position', 'rotation', 'size'] },
          axisMenu: { acceptReporters: false, items: ['x', 'y', 'z'] },
          camDirMenu: { acceptReporters: false, items: ['forward', 'back', 'left', 'right', 'up', 'down'] },
          camPropMenu: { acceptReporters: false, items: ['x', 'y', 'z', 'turn', 'tilt'] },
          deltaMenu: { acceptReporters: false, items: ['x', 'y'] },
          hitMenu: {
            acceptReporters: false,
            items: ['x', 'y', 'z', 'distance', 'face', 'normal x', 'normal y', 'normal z']
          },
          filterMenu: { acceptReporters: false, items: ['pixelated', 'smooth'] },
          faceMenu: {
            acceptReporters: false,
            items: [
              { text: 'all sides', value: 'all' },
              { text: 'top', value: 'top' },
              { text: 'bottom', value: 'bottom' },
              { text: 'sides (all four)', value: 'sides' },
              { text: 'front', value: 'front' },
              { text: 'back', value: 'back' },
              { text: 'left', value: 'left' },
              { text: 'right', value: 'right' }
            ]
          },
          particleShapeMenu: { acceptReporters: false, items: ['cube', 'sphere'] },
          modeMenu: { acceptReporters: false, items: ['walk', 'fly'] },
          solidMenu: {
            acceptReporters: false,
            items: [
              { text: 'solid', value: 'solid' },
              { text: 'walk through', value: 'through' }
            ]
          },
          playerModeMenu: {
            acceptReporters: false,
            items: [
              { text: 'first person', value: 'fp' },
              { text: 'fly (setup mode)', value: 'fly' },
              { text: 'editor (move things)', value: 'editor' },
              { text: 'off', value: 'off' }
            ]
          },
          playerSettingMenu: {
            acceptReporters: false,
            items: [
              { text: 'walk speed', value: 'walkSpeed' },
              { text: 'sprint multiplier', value: 'sprint' },
              { text: 'jump height', value: 'jump' },
              { text: 'gravity', value: 'gravity' },
              { text: 'ground acceleration', value: 'accel' },
              { text: 'ground stopping', value: 'friction' },
              { text: 'air acceleration', value: 'airAccel' },
              { text: 'air stopping', value: 'airFriction' },
              { text: 'edge forgiveness', value: 'edge' },
              { text: 'eye height', value: 'eye' },
              { text: 'body radius', value: 'radius' },
              { text: 'step height', value: 'step' },
              { text: 'fly speed', value: 'flySpeed' },
              { text: 'fly sprint multiplier', value: 'flySprint' }
            ]
          },
          playerKeyMenu: {
            acceptReporters: false,
            items: [
              { text: 'forward', value: 'forward' },
              { text: 'back', value: 'back' },
              { text: 'left', value: 'left' },
              { text: 'right', value: 'right' },
              { text: 'jump / fly up', value: 'jump' },
              { text: 'sprint', value: 'sprint' },
              { text: 'fly down', value: 'down' }
            ]
          },
          buttonMenu: {
            acceptReporters: false,
            items: [
              { text: 'left', value: 'left' },
              { text: 'right', value: 'right' }
            ]
          },
          gizmoMenu: {
            acceptReporters: false,
            items: [
              { text: 'move', value: 'translate' },
              { text: 'rotate', value: 'rotate' },
              { text: 'size', value: 'scale' }
            ]
          },
          spaceMenu: { acceptReporters: false, items: ['world', 'local'] },
          blockTypeMenu: { acceptReporters: true, items: 'getBlockTypes' },
          costumeMenu: { acceptReporters: true, items: 'getCostumes' },
          imageMenu: { acceptReporters: true, items: 'getImageAssets' },
          modelMenu: { acceptReporters: true, items: 'getModelAssets' },
          assetMenu: { acceptReporters: true, items: 'getAllAssets' },
          presetMenu: { acceptReporters: true, items: Object.keys(PRESETS) },
          emitterActionMenu: {
            acceptReporters: false,
            items: ['play', 'stop emitting', 'pause', 'resume', 'restart', 'clear particles', 'delete']
          },
          emitterSettingMenu: {
            acceptReporters: false,
            items: [
              { text: 'particles per second', value: 'rate' },
              { text: 'burst size', value: 'burstCount' },
              { text: 'burst every (s, 0 = once)', value: 'burstEvery' },
              { text: 'max particles', value: 'max' },
              { text: 'lifetime (s)', value: 'life' },
              { text: 'lifetime random +/-', value: 'lifeRand' },
              { text: 'start speed', value: 'speed' },
              { text: 'speed random +/-', value: 'speedRand' },
              { text: 'start size', value: 'size' },
              { text: 'size random +/-', value: 'sizeRand' },
              { text: 'end size (x start size)', value: 'sizeEnd' },
              { text: 'start opacity %', value: 'alpha' },
              { text: 'end opacity %', value: 'alphaEnd' },
              { text: 'gravity', value: 'gravity' },
              { text: 'drag (air resistance)', value: 'drag' },
              { text: 'wind x', value: 'windX' },
              { text: 'wind y', value: 'windY' },
              { text: 'wind z', value: 'windZ' },
              { text: 'turbulence (wobble)', value: 'turbulence' },
              { text: 'swirl', value: 'swirl' },
              { text: 'spin (deg/s)', value: 'spin' },
              { text: 'spin random +/-', value: 'spinRand' },
              { text: 'spread angle', value: 'angle' },
              { text: 'shape radius', value: 'radius' },
              { text: 'shape height (box)', value: 'height' },
              { text: 'bounciness %', value: 'bounce' },
              { text: 'floor height', value: 'floorY' },
              { text: 'duration (s, 0 = forever)', value: 'duration' },
              { text: 'time speed (1 = normal)', value: 'timeScale' }
            ]
          },
          emitterColorMenu: {
            acceptReporters: false,
            items: ['start color', 'second start color (random mix)', 'end color']
          },
          emitShapeMenu: {
            acceptReporters: false,
            items: ['point', 'sphere', 'hemisphere', 'cone', 'box', 'circle', 'edge']
          },
          emitLookMenu: {
            acceptReporters: false,
            items: ['soft glow', 'circle', 'square', 'star', 'ring', 'spark', 'cube', 'sphere']
          },
          emitterToggleMenu: {
            acceptReporters: false,
            items: [
              'additive glow',
              'lit by lights',
              'looping',
              'local space',
              'delete when finished',
              'color change over life',
              'spawn on edge only'
            ]
          },
          emitFloorMenu: {
            acceptReporters: false,
            items: [
              { text: 'pass through', value: 'none' },
              { text: 'bounce', value: 'bounce' },
              { text: 'stop', value: 'stop' },
              { text: 'disappear', value: 'die' }
            ]
          },
          emitterInfoMenu: {
            acceptReporters: false,
            items: [
              'particles alive',
              'x',
              'y',
              'z',
              { text: 'particles per second', value: 'rate' },
              { text: 'lifetime (s)', value: 'life' },
              { text: 'start speed', value: 'speed' },
              { text: 'start size', value: 'size' },
              { text: 'gravity', value: 'gravity' },
              { text: 'spread angle', value: 'angle' },
              { text: 'max particles', value: 'max' }
            ]
          },
          playerPlaceMenu: {
            acceptReporters: false,
            items: ['feet', 'eyes', 'above head', 'in front']
          },
          playerInfoMenu: {
            acceptReporters: false,
            items: ['eye y', 'turn', 'tilt', 'look x', 'look y', 'look z', 'speed', 'speed x', 'speed y', 'speed z']
          },
          copyMenu: {
            acceptReporters: false,
            items: ['position', 'rotation', 'size', 'color', 'visibility', 'all data', 'tags', 'everything']
          },
          aggMenu: { acceptReporters: false, items: ['sum', 'average', 'min', 'max'] },
          textureSourceMenu: { acceptReporters: true, items: 'getTextureSources' }

        }
      };
      v12Extend(info);

      // Each original label becomes its own expandable extension category.
      // The blocks themselves and their implementation remain untouched.
      if (this.category) {
        info.id = this.category.id;
        info.name = this.category.name;
        info.color1 = this.category.color1;
        info.color2 = this.category.color2;
        info.color3 = this.category.color3;
        info.blocks = this.category.blocks;
      }
      return info;
    }

    getCostumes() {
      const target = Scratch.vm.editingTarget;
      if (!target) return ['costume1'];
      const names = target.getCostumes().map((c) => c.name);
      return names.length ? names : ['costume1'];
    }

    getBlockTypes() {
      return allBlockTypes();
    }

    getImageAssets() {
      return assetNames('image');
    }

    getModelAssets() {
      return assetNames('model');
    }

    getAllAssets() {
      return assetNames();
    }

    // World

    async showHide({ STATE }) {
      const want = str(STATE) === 'show';
      // hiding before the world exists: start hidden so the first frame never flashes
      if (!isReady && !loading && !want) enabled = false;
      await init();
      enabled = want;
      if (enabled) {
        // draw one finished frame first, then reveal it
        resizeToStage();
        renderer.render(scene, camera);
      }
      canvas.style.display = enabled ? 'block' : 'none';
      if (uiLayer) uiLayer.style.display = enabled ? 'block' : 'none';
      if (!enabled) clearHover();
    }

    async resetWorld() {
      await init();
      buildWorld();
    }

    async setBackground({ COLOR }) {
      await init();
      removeSkyDome();
      scene.background = toColor(COLOR);
    }

    async setSkyTexture({ URL }) {
      await init();
      const url = str(URL);
      if (!(await Scratch.canFetch(url))) return;
      try {
        makeSky(await loadTexture(url, url));
      } catch (e) {
        console.warn('3D Turbo could not load sky picture', url, e);
      }
    }

    async setSkyAsset({ ASSET }) {
      await init();
      const name = str(ASSET);
      const a = readAssets()[name];
      if (!a || a.type !== 'image') return;
      try {
        makeSky(await loadTexture('asset:' + name, a.data));
      } catch (e) {
        console.warn('3D Turbo could not use imported sky picture', e);
      }
    }

    async clearBackground() {
      await init();
      removeSkyDome();
      scene.background = null;
    }

    async setFog({ COLOR, NEAR, FAR }) {
      await init();
      scene.fog = new THREE.Fog(toColor(COLOR), num(NEAR), num(FAR));
    }

    async fogOff() {
      await init();
      scene.fog = null;
    }

    // Loading screen

    async loadWorld() {
      await init();
    }

    worldReady() {
      return isReady;
    }

    whenWorldReady() {
      return isReady;
    }

    loadProgress() {
      return Math.round(loadPct);
    }

    // My files

    async importFile({ NAME }) {
      const file = await pickFile('');
      if (!file) return;
      const ext = file.name.split('.').pop().toLowerCase();
      let type = null;
      if (MODEL_EXTS.includes(ext)) type = 'model';
      else if (IMAGE_EXTS.includes(ext) || (file.type || '').startsWith('image/')) type = 'image';
      else if (AUDIO_EXTS.includes(ext) || (file.type || '').startsWith('audio/')) type = 'audio';
      if (!type) {
        toast('Cannot use .' + ext + ' files. Use glb, gltf, obj, fbx, dae, stl, a picture or a sound (mp3, wav, ogg).');
        return;
      }
      try {
        if (ext === 'gltf') {
          const json = JSON.parse(await file.text());
          const external = []
            .concat(json.buffers || [], json.images || [])
            .some((item) => item.uri && !String(item.uri).startsWith('data:'));
          if (external) {
            toast('This .gltf needs separate files next to it. Export it as .glb (one file) instead.');
            return;
          }
        }
        const data = await readDataURL(file);
        const name = str(NAME).trim() || file.name.replace(/\.[^.]+$/, '');
        const store = readAssets();
        store[name] = { type, ext, data };
        textureCache.delete('asset:' + name);
        writeAssets();
        toast('Imported ' + type + ' "' + name + '" (' + (file.size / 1048576).toFixed(1) + ' MB)');
      } catch (e) {
        toast('Could not import that file: ' + (e && e.message ? e.message : e));
      }
    }

    deleteAsset({ ASSET }) {
      const name = str(ASSET);
      const store = readAssets();
      if (!(name in store)) return;
      delete store[name];
      textureCache.delete('asset:' + name);
      writeAssets();
    }

    listAssets() {
      const store = readAssets();
      return JSON.stringify(Object.keys(store));
    }

    // Objects

    async createShape({ SHAPE, NAME, COLOR }) {
      await init();
      addObject(str(NAME), makeShape(SHAPE, COLOR));
      await applyDefaultTexture(getObj(NAME));
    }

    async cloneObject({ NAME, NEW }) {
      await init();
      const src = getObj(NAME);
      if (!src) return;
      addObject(str(NEW), copyObject(src));
    }

    async deleteObject({ NAME }) {
      await init();
      targetsOf(NAME).forEach((o) => removeObject(o.userData.name));
    }

    setVisible({ STATE, NAME }) {
      const show = str(STATE) === 'show';
      targetsOf(NAME).forEach((o) => (o.visible = show));
    }

    setColor({ NAME, FACE, COLOR }) {
      const color = toColor(COLOR);
      targetsOf(NAME).forEach((o) => {
        materialsForFace(o, FACE).forEach((m) => m.color && m.color.copy(color));
      });
    }

    setOpacity({ NAME, PERCENT }) {
      const o = Math.max(0, Math.min(1, num(PERCENT) / 100));
      targetsOf(NAME).forEach((obj) => {
        materialsOf(obj).forEach((m) => {
          m.transparent = o < 1;
          m.opacity = o;
          m.needsUpdate = true;
        });
      });
    }

    setSolid({ NAME, SOLID }) {
      const solid = str(SOLID) === 'solid';
      targetsOf(NAME).forEach((o) => (o.userData.solid = solid));
    }

    setSurface({ NAME, FACE, SHINE, METAL }) {
      const rough = 1 - Math.max(0, Math.min(1, num(SHINE) / 100));
      const metal = Math.max(0, Math.min(1, num(METAL) / 100));
      targetsOf(NAME).forEach((o) => {
        materialsForFace(o, FACE).forEach((m) => applySurface(m, rough, metal));
      });
    }

    // roughness 0 = mirror smooth, 100 = fully matte. metalness 0 = plastic / stone, 100 = metal
    setRoughMetal({ NAME, FACE, ROUGH, METAL }) {
      const rough = num(ROUGH) / 100;
      const metal = num(METAL) / 100;
      targetsOf(NAME).forEach((o) => {
        materialsForFace(o, FACE).forEach((m) => applySurface(m, rough, metal));
      });
    }

    async createBlockType({ TYPE, NAME, X, Y, Z }) {
      await init();
      const t = str(TYPE);
      let obj;
      if (BLOCKS[t]) obj = makeBlockMesh(t);
      else return;
      obj.position.set(num(X), num(Y), num(Z));
      addObject(str(NAME), obj);
      lastCreated = str(NAME);
    }

    async applyBlockType({ NAME, TYPE }) {
      await init();
      const t = str(TYPE);
      const obj = getObj(NAME);
      if (!obj || !obj.isMesh || !BLOCKS[t]) return;
      touchColor(obj);
      const old = Array.isArray(obj.material) ? obj.material : [obj.material];
      old.forEach((m) => {
        if (m.map && !(m.map.userData && m.map.userData.shared)) m.map.dispose();
        m.dispose();
      });
      obj.material = FACE_ORDER.map((f) => makeBlockMat(BLOCKS[t], f));
      obj.userData.shape = 'cube';
      obj.userData.blockType = t;
    }

    setBlockTypeSurface({ TYPE, ROUGH, METAL }) {
      if (!isReady) return;
      setTypeSurface(str(TYPE), num(ROUGH) / 100, num(METAL) / 100);
    }

    blockTypes() {
      return JSON.stringify(allBlockTypes());
    }

    objectExists({ NAME }) {
      return isReady && targetsOf(NAME).length > 0;
    }

    // Groups

    async createAt({ SHAPE, X, Y, Z, GROUP, COLOR }) {
      await init();
      const g = str(GROUP).trim();
      const name = uniqueName(g || 'object');
      const mesh = makeShape(SHAPE, COLOR);
      mesh.position.set(num(X), num(Y), num(Z));
      addObject(name, mesh);
      joinGroup(mesh, g);
      lastCreated = name;
      await applyDefaultTexture(mesh);
    }

    async stampCopy({ NAME, X, Y, Z, GROUP }) {
      await init();
      const src = getObj(NAME);
      if (!src) return;
      const g = str(GROUP).trim();
      const name = uniqueName(g || str(NAME));
      const copy = copyObject(src);
      copy.position.set(num(X), num(Y), num(Z));
      copy.visible = true;
      addObject(name, copy);
      joinGroup(copy, g);
      lastCreated = name;
    }

    lastCreated() {
      return lastCreated;
    }

    async addToGroup({ NAME, GROUP }) {
      await init();
      const obj = getObj(NAME);
      if (obj) joinGroup(obj, GROUP);
    }

    groupOf({ NAME }) {
      const obj = getObj(NAME);
      return obj && obj.userData.group ? obj.userData.group : '';
    }

    async deleteGroup({ GROUP }) {
      await init();
      const g = groups.get(str(GROUP));
      if (!g) return;
      Array.from(g).forEach((n) => removeObject(n));
    }

    groupCount({ GROUP }) {
      const g = groups.get(str(GROUP));
      return g ? g.size : 0;
    }

    groupItem({ N, GROUP }) {
      const g = groups.get(str(GROUP));
      if (!g) return '';
      const i = Math.round(num(N)) - 1;
      const list = Array.from(g);
      return i >= 0 && i < list.length ? list[i] : '';
    }

    listGroup({ GROUP }) {
      const g = groups.get(str(GROUP));
      return JSON.stringify(g ? Array.from(g) : []);
    }

    objectAt({ X, Y, Z }) {
      if (!isReady) return '';
      const p = new THREE.Vector3(num(X), num(Y), num(Z));
      const box = new THREE.Box3();
      for (const [n, o] of objects) {
        if (o.isLight || !o.visible) continue;
        box.setFromObject(o);
        if (!box.isEmpty() && box.containsPoint(p)) return n;
      }
      return '';
    }

    // Textures

    async setTextureAsset({ NAME, FACE, ASSET }) {
      await init();
      const name = str(ASSET);
      const a = readAssets()[name];
      if (!a || a.type !== 'image') return;
      try {
        const base = await loadTexture('asset:' + name, a.data);
        targetsOf(NAME).forEach((o) => applyTexture(materialsForFace(o, FACE), base));
      } catch (e) {
        console.warn('3D Turbo could not use imported texture', e);
      }
    }

    async setTextureURL({ NAME, FACE, URL }) {
      await init();
      const url = str(URL);
      if (!targetsOf(NAME).length) return;
      if (!(await Scratch.canFetch(url))) return;
      try {
        const base = await loadTexture(url, url);
        targetsOf(NAME).forEach((o) => applyTexture(materialsForFace(o, FACE), base));
      } catch (e) {
        console.warn('3D Turbo could not load texture', url, e);
      }
    }

    async setTextureCostume({ NAME, FACE, COSTUME }, util) {
      await init();
      if (!targetsOf(NAME).length) return;
      const costumes = util.target.getCostumes();
      const wanted = str(COSTUME);
      const costume = costumes.find((c) => c.name === wanted) || costumes[Math.round(num(COSTUME)) - 1];
      if (!costume || !costume.asset) return;
      try {
        const key = 'costume:' + costume.asset.assetId;
        const base = await loadTexture(key, costume.asset.encodeDataURI());
        targetsOf(NAME).forEach((o) => applyTexture(materialsForFace(o, FACE), base));
      } catch (e) {
        console.warn('3D Turbo could not use costume as texture', e);
      }
    }

    repeatTexture({ NAME, FACE, X, Y }) {
      targetsOf(NAME).forEach((o) => {
        materialsForFace(o, FACE).forEach((m) => {
          if (m.map) {
            m.map.repeat.set(num(X), num(Y));
            m.map.needsUpdate = true;
          }
        });
      });
    }

    textureFilter({ NAME, FACE, FILTER }) {
      const pixel = str(FILTER) === 'pixelated';
      targetsOf(NAME).forEach((o) => {
        materialsForFace(o, FACE).forEach((m) => {
          if (!m.map) return;
          m.map.magFilter = pixel ? THREE.NearestFilter : THREE.LinearFilter;
          m.map.minFilter = pixel ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
          m.map.generateMipmaps = !pixel;
          m.map.needsUpdate = true;
          m.needsUpdate = true;
        });
      });
    }

    removeTexture({ NAME, FACE }) {
      targetsOf(NAME).forEach((o) => {
        materialsForFace(o, FACE).forEach((m) => {
          if (m.map) m.map.dispose();
          m.map = null;
          m.needsUpdate = true;
        });
      });
    }

    // Models

    async loadModelAsset({ ASSET, NAME }) {
      await init();
      const a = readAssets()[str(ASSET)];
      if (!a || a.type !== 'model') {
        toast('No imported model called "' + str(ASSET) + '". Run the import block first, then pick it in the dropdown.');
        return;
      }
      try {
        addObject(str(NAME), await loadModelObject({ asset: str(ASSET) }));
      } catch (e) {
        toast('Could not load model "' + str(ASSET) + '": ' + (e && e.message ? e.message : e));
      }
    }

    async loadModel({ URL, NAME }) {
      await init();
      const url = str(URL);
      if (!(await Scratch.canFetch(url))) return;
      const ext = url.split(/[?#]/)[0].split('.').pop().toLowerCase();
      try {
        addObject(str(NAME), await loadModelObject({ url }));
      } catch (e) {
        toast('Could not load model from link: ' + (e && e.message ? e.message : e));
      }
    }

    fitSize({ NAME, SIZE }) {
      const obj = getObj(NAME);
      if (!obj) return;
      const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
      const biggest = Math.max(size.x, size.y, size.z);
      if (biggest > 0) obj.scale.multiplyScalar(num(SIZE) / biggest);
    }

    playAnimation({ ANIM, NAME }) {
      const obj = getObj(NAME);
      if (!obj || !obj.userData.clips) return;
      const clips = obj.userData.clips;
      const wanted = str(ANIM);
      const clip = clips.find((c) => c.name === wanted) || clips[Math.round(num(ANIM)) - 1];
      if (!clip) return;
      const key = str(NAME);
      let mixer = mixers.get(key);
      if (!mixer) {
        mixer = new THREE.AnimationMixer(obj);
        mixers.set(key, mixer);
      }
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
    }

    stopAnimation({ NAME }) {
      const mixer = mixers.get(str(NAME));
      if (mixer) mixer.stopAllAction();
    }

    listAnimations({ NAME }) {
      const obj = getObj(NAME);
      if (!obj || !obj.userData.clips) return '[]';
      return JSON.stringify(obj.userData.clips.map((c) => c.name));
    }

    // Moving things

    setPosition({ NAME, X, Y, Z }) {
      const obj = getObj(NAME);
      if (obj) obj.position.set(num(X), num(Y), num(Z));
    }

    setRotation({ NAME, X, Y, Z }) {
      const obj = getObj(NAME);
      if (obj) obj.rotation.set(rad(num(X)), rad(num(Y)), rad(num(Z)));
    }

    setScale({ NAME, X, Y, Z }) {
      const obj = getObj(NAME);
      if (obj) obj.scale.set(num(X), num(Y), num(Z));
    }

    readProp(obj, PROP, AXIS) {
      const axis = str(AXIS);
      const prop = str(PROP);
      if (prop === 'rotation') return deg(obj.rotation[axis]);
      if (prop === 'size') return obj.scale[axis];
      return obj.position[axis];
    }

    writeProp(obj, PROP, AXIS, value) {
      const axis = str(AXIS);
      const prop = str(PROP);
      if (prop === 'rotation') obj.rotation[axis] = rad(value);
      else if (prop === 'size') obj.scale[axis] = value;
      else obj.position[axis] = value;
    }

    setProp({ PROP, AXIS, NAME, VALUE }) {
      targetsOf(NAME).forEach((o) => this.writeProp(o, PROP, AXIS, num(VALUE)));
    }

    changeProp({ PROP, AXIS, NAME, VALUE }) {
      targetsOf(NAME).forEach((o) =>
        this.writeProp(o, PROP, AXIS, this.readProp(o, PROP, AXIS) + num(VALUE))
      );
    }

    getProp({ PROP, AXIS, NAME }) {
      const obj = getObj(NAME) || targetsOf(NAME)[0];
      if (obj) return this.readProp(obj, PROP, AXIS);
      if (isReady && isPlayerName(NAME)) {
        const prop = str(PROP);
        const axis = str(AXIS);
        if (prop === 'position') return camera.position[axis];
        if (prop === 'rotation') return axis === 'y' ? camYaw : axis === 'x' ? camPitch : 0;
        return 1;
      }
      return 0;
    }

    moveForward({ NAME, STEPS }) {
      const obj = getObj(NAME);
      if (obj) obj.translateZ(-num(STEPS));
    }

    distance({ A, B }) {
      if (!isReady) return 0;
      const a = posOf(A);
      const b = posOf(B);
      if (!a || !b) return 0;
      return a.distanceTo(b);
    }

    touching({ A, B }) {
      if (!isReady) return false;
      const a = boxOf(A);
      const b = boxOf(B);
      if (!a || !b || a.isEmpty() || b.isEmpty()) return false;
      return a.intersectsBox(b);
    }

    // Player (premade)

    async setPlayerMode({ MODE }) {
      await init();
      const mode = str(MODE);
      if (mode === 'fp') {
        player.pos.copy(camera.position);
        player.pos.y -= player.eye;
        player.spawn.copy(player.pos);
        player.vy = 0;
        player.vx = 0;
        player.vz = 0;
        player.onGround = false;
        mouseLook = rig.mode === 'first' || rig.mode === 'third';
      } else if (mode === 'fly') {
        mouseLook = true;
      } else if (mode === 'editor') {
        enterEditor();
      }
      if (mode !== 'editor') exitEditor();
      player.mode = mode;
    }

    async teleportPlayer({ X, Y, Z }) {
      await init();
      player.pos.set(num(X), num(Y), num(Z));
      player.spawn.copy(player.pos);
      player.vy = 0;
      player.vx = 0;
      player.vz = 0;
      player.onGround = false;
      camera.position.set(num(X), num(Y) + player.eye, num(Z));
    }

    setPlayerSetting({ SETTING, VALUE }) {
      const key = str(SETTING);
      if (!(key in player) || typeof player[key] !== 'number') return;
      const mins = { eye: 0.5, radius: 0.05, step: 0, gravity: 0, jump: 0, crouchEye: 0.3, fallY: -1e9 };
      player[key] = Math.max(mins[key] !== undefined ? mins[key] : 0, num(VALUE));
      if (key === 'eye' && !player.crouched) player.eyeNow = player[key];
    }

    setPlayerKey({ ACTION, KEY }) {
      const action = str(ACTION);
      if (action in player.keys) player.keys[action] = str(KEY).trim().toLowerCase();
    }

    setFloor({ STATE, Y }) {
      player.floorOn = str(STATE) === 'on';
      player.floorY = num(Y);
    }

    playerOnGround() {
      return player.mode === 'fp' && player.onGround;
    }

    // Camera (manual)

    setCamPos({ X, Y, Z }) {
      if (isReady) camera.position.set(num(X), num(Y), num(Z));
    }

    moveCam({ DIR, STEPS }) {
      if (!isReady) return;
      const s = num(STEPS);
      switch (str(DIR)) {
        case 'forward': translateCam(s, 0, 0); break;
        case 'back': translateCam(-s, 0, 0); break;
        case 'right': translateCam(0, s, 0); break;
        case 'left': translateCam(0, -s, 0); break;
        case 'up': translateCam(0, 0, s); break;
        case 'down': translateCam(0, 0, -s); break;
      }
    }

    moveCamBy({ F, R, U }) {
      if (!isReady) return;
      let f = num(F);
      let r = num(R);
      const len = Math.hypot(f, r);
      const biggest = Math.max(Math.abs(f), Math.abs(r));
      const k = len > 0 ? biggest / len : 0;
      f *= k;
      r *= k;
      translateCam(f, r, num(U));
    }

    setCamAngle({ YAW, PITCH }) {
      if (!isReady) return;
      camYaw = num(YAW);
      camPitch = num(PITCH);
      updateCamera();
    }

    turnCam({ YAW, PITCH }) {
      if (!isReady) return;
      camYaw += num(YAW);
      camPitch += num(PITCH);
      updateCamera();
    }

    pointCam({ X, Y, Z }) {
      if (!isReady) return;
      const dx = num(X) - camera.position.x;
      const dy = num(Y) - camera.position.y;
      const dz = num(Z) - camera.position.z;
      camYaw = deg(Math.atan2(-dx, -dz));
      camPitch = deg(Math.atan2(dy, Math.hypot(dx, dz)));
      updateCamera();
    }

    setFlyMode({ MODE }) {
      flyMode = str(MODE) === 'fly';
    }

    getCam({ PROP }) {
      if (!isReady) return 0;
      switch (str(PROP)) {
        case 'x': return camera.position.x;
        case 'y': return camera.position.y;
        case 'z': return camera.position.z;
        case 'turn': return camYaw;
        case 'tilt': return camPitch;
      }
      return 0;
    }

    // Mouse

    async setMouseLook({ STATE }) {
      await init();
      mouseLook = str(STATE) === 'on';
    }

    releaseMouse() {
      if (document.pointerLockElement) document.exitPointerLock();
    }

    mouseDelta({ AXIS }) {
      return str(AXIS) === 'y' ? deltaY : deltaX;
    }

    mouseLocked() {
      return !!document.pointerLockElement;
    }

    // Reach, looking and clicking

    reachValue() {
      return reach;
    }

    lookingAt() {
      const hit = lookHit();
      return hit ? hit.name : '';
    }

    lookingAtWithin({ DIST }) {
      const hit = lookHit(Math.max(0, num(DIST)));
      return hit ? hit.name : '';
    }

    lookingAtAnything() {
      return !!lookHit();
    }

    lookingAtObject({ NAME }) {
      return matchesHit(lookHit(), NAME);
    }

    lookingAtObjectWithin({ NAME, DIST }) {
      return matchesHit(lookHit(Math.max(0, num(DIST))), NAME);
    }

    inReach({ NAME }) {
      if (!isReady) return false;
      for (const o of targetsOf(NAME)) {
        if (!o.visible) continue;
        const box = new THREE.Box3().setFromObject(o);
        if (!box.isEmpty() && box.distanceToPoint(camera.position) <= reach) return true;
      }
      return false;
    }

    lookHitInfo({ INFO }) {
      const info = str(INFO);
      const hit = lookHit();
      if (info === 'face') {
        if (!hit) return '';
        const n = hit.normal;
        const ax = Math.abs(n.x);
        const ay = Math.abs(n.y);
        const az = Math.abs(n.z);
        if (ay >= ax && ay >= az) return n.y > 0 ? 'top' : 'bottom';
        if (az >= ax) return n.z > 0 ? 'front' : 'back';
        return n.x > 0 ? 'right' : 'left';
      }
      if (!hit) return 0;
      switch (info) {
        case 'x': return hit.point.x;
        case 'y': return hit.point.y;
        case 'z': return hit.point.z;
        case 'distance': return hit.distance;
        case 'normal x': return hit.normal.x;
        case 'normal y': return hit.normal.y;
        case 'normal z': return hit.normal.z;
      }
      return 0;
    }

    whenLookingAt({ NAME }) {
      return matchesHit(lookHit(), NAME);
    }

    whenClicked({ BUTTON, NAME }) {
      const b = str(BUTTON) === 'right' ? 2 : 0;
      if (!pressedThisFrame.has(b)) return false;
      return matchesHit(lookHit(), NAME);
    }

    whenClickedAny({ BUTTON }) {
      const b = str(BUTTON) === 'right' ? 2 : 0;
      if (!pressedThisFrame.has(b)) return false;
      return !!lookHit();
    }

    mouseHeld({ BUTTON }) {
      return mouseButtons.has(str(BUTTON) === 'right' ? 2 : 0);
    }

    setHoverShade({ STATE, PERCENT }) {
      hoverShade.on = str(STATE) === 'on';
      hoverShade.amount = Math.max(0, Math.min(0.9, num(PERCENT) / 100));
      if (isReady) clearHover();
    }

    setObjectHover({ NAME, STATE }) {
      const on = str(STATE) === 'on';
      targetsOf(NAME).forEach((o) => {
        o.userData.hover = on;
        if (!on && hoverObj === o) clearHover();
      });
    }

    playerTouching({ NAME }) {
      const obj = getObj(NAME);
      if (!obj || !isReady) return false;
      const box = new THREE.Box3().setFromObject(obj);
      return !box.isEmpty() && box.intersectsBox(playerBox());
    }

    whatTouching({ NAME }) {
      if (!isReady) return '';
      const list = touchingList(str(NAME));
      return list.length ? list[0] : '';
    }

    countTouching({ NAME }) {
      if (!isReady) return 0;
      return touchingList(str(NAME)).length;
    }

    setHighlight({ NAME, STATE }) {
      const on = str(STATE) === 'on';
      targetsOf(NAME).forEach((obj) => {
        materialsOf(obj).forEach((m) => {
          if (!m.emissive) return;
          if (!m.userData.baseEmissive) m.userData.baseEmissive = m.emissive.clone();
          if (on) m.emissive.set(0xff5fa8).multiplyScalar(0.35);
          else m.emissive.copy(m.userData.baseEmissive);
        });
      });
    }

    setCrosshair({ STATE }) {
      crosshairOn = str(STATE) === 'on';
    }

    // Editor (gizmo)

    async setGizmo({ GIZMO }) {
      await init();
      tc.setMode(str(GIZMO));
    }

    async setGizmoSpace({ SPACE }) {
      await init();
      tc.setSpace(str(SPACE));
    }

    setSnap({ MOVE, ROT, SIZE }) {
      snap.move = Math.max(0.001, num(MOVE));
      snap.rotate = Math.max(0.1, num(ROT));
      snap.scale = Math.max(0.001, num(SIZE));
    }

    async selectObjectBlock({ NAME }) {
      await init();
      const obj = getObj(NAME);
      if (obj) selectObject(obj);
    }

    deselectBlock() {
      if (isReady) deselect();
    }

    selectedObject() {
      return selected ? selected.userData.name : '';
    }

    // UI

    async setUiSprite({ STATE }, util) {
      await init();
      const t = util.target;
      if (!t || t.isStage) return;
      if (str(STATE) === 'on') {
        uiOptOut.delete(t.id);
        if (!uiItems.has(t.id)) uiItems.set(t.id, { img: null, key: '' });
      } else {
        uiOptOut.add(t.id);
        const item = uiItems.get(t.id);
        if (item && item.img) item.img.remove();
        uiItems.delete(t.id);
      }
    }

    // Particles

    async particleBurst({ COUNT, X, Y, Z, C1, C2, SIZE, SPEED }) {
      await init();
      spawnBurst(
        num(COUNT),
        new THREE.Vector3(num(X), num(Y), num(Z)),
        new THREE.Vector3(0.05, 0.05, 0.05),
        [toColor(C1), toColor(C2)],
        num(SIZE),
        num(SPEED)
      );
    }

    async particleBurstFrom({ COUNT, NAME, SIZE, SPEED }) {
      await init();
      const list = targetsOf(NAME).slice(0, 50);
      const each = Math.max(1, Math.floor(num(COUNT)));
      list.forEach((obj) => {
        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.4);
        spawnBurst(each, center, half, sampleColors(obj, each), num(SIZE), num(SPEED));
      });
    }

    async setParticleSettings({ LIFE, GRAVITY, SHAPE }) {
      particleCfg.life = Math.max(0.05, num(LIFE));
      particleCfg.gravity = num(GRAVITY);
      particleCfg.shape = str(SHAPE) === 'sphere' ? 'sphere' : 'cube';
    }

    clearParticlesBlock() {
      if (isReady) clearParticles();
    }

    particleCount() {
      return totalParticles;
    }

    // Lights

    async setAmbient({ COLOR, B }) {
      await init();
      ambient.color.copy(toColor(COLOR));
      ambient.intensity = num(B);
    }

    async setSun({ COLOR, B, X, Y, Z }) {
      await init();
      sun.color.copy(toColor(COLOR));
      sun.intensity = num(B);
      sun.position.set(num(X), num(Y), num(Z));
    }

    async addPointLight({ NAME, COLOR, B, X, Y, Z }) {
      await init();
      const light = new THREE.PointLight(toColor(COLOR), num(B) * 40, 0, 2);
      light.position.set(num(X), num(Y), num(Z));
      addObject(str(NAME), light);
    }

    // Settings

    setFov({ FOV }) {
      if (!isReady) return;
      fovBase = Math.max(10, Math.min(150, num(FOV)));
      applyProjection();
    }

    setViewDistance({ DIST }) {
      if (!isReady) return;
      camera.far = Math.max(1, num(DIST));
      camera.updateProjectionMatrix();
    }

    setSensitivity({ SENS }) {
      sensitivity = Math.max(0, num(SENS));
    }

    setReach({ DIST }) {
      reach = Math.max(0, num(DIST));
    }

    async setShadows({ STATE }) {
      await init();
      shadowsOn = str(STATE) === 'on';
      renderer.shadowMap.enabled = shadowsOn;
      sun.castShadow = shadowsOn;
      for (const obj of objects.values()) {
        applyShadowFlags(obj);
        materialsOf(obj).forEach((m) => (m.needsUpdate = true));
      }
    }

    setQuality({ PERCENT }) {
      quality = Math.max(0.25, Math.min(2, num(PERCENT) / 100));
      lastW = 0;
    }

    getFps() {
      return Math.round(fps);
    }

    objectCount() {
      return objects.size;
    }

    // ===== Player info =====

    playerX() {
      if (!isReady) return 0;
      ensureTmp();
      return playerFeet(emitterTmp.a).x;
    }

    playerY() {
      if (!isReady) return 0;
      ensureTmp();
      return playerFeet(emitterTmp.a).y;
    }

    playerZ() {
      if (!isReady) return 0;
      ensureTmp();
      return playerFeet(emitterTmp.a).z;
    }

    playerInfo({ INFO }) {
      if (!isReady) return 0;
      ensureTmp();
      const v = playerVelocity();
      switch (str(INFO)) {
        case 'eye y': return camera.position.y;
        case 'turn': return camYaw;
        case 'tilt': return camPitch;
        case 'look x': return lookDir(emitterTmp.a).x;
        case 'look y': return lookDir(emitterTmp.a).y;
        case 'look z': return lookDir(emitterTmp.a).z;
        case 'speed': return Math.hypot(v.x, v.z);
        case 'speed x': return v.x;
        case 'speed y': return v.y;
        case 'speed z': return v.z;
      }
      return 0;
    }

    // ===== Textured creation =====

    getTextureSources() {
      const items = [];
      const store = readAssets();
      Object.keys(store).forEach((n) => {
        if (store[n].type === 'image') items.push({ text: n, value: n });
      });
      return items;
    }

    async createTextured({ SHAPE, NAME, TEX }) {
      await init();
      const mesh = makeShape(SHAPE, '#ffffff');
      addObject(str(NAME), mesh);
      lastCreated = str(NAME);
      try {
        const base = await resolveTextureSource(TEX);
        if (base) applyTexture(materialsOf(mesh), base);
      } catch (e) {
        console.warn('3D Turbo could not load that texture', e);
      }
    }

    async createAtTextured({ SHAPE, X, Y, Z, GROUP, TEX }) {
      await init();
      const g = str(GROUP).trim();
      const name = uniqueName(g || 'object');
      const mesh = makeShape(SHAPE, '#ffffff');
      mesh.position.set(num(X), num(Y), num(Z));
      addObject(name, mesh);
      joinGroup(mesh, g);
      lastCreated = name;
      try {
        const base = await resolveTextureSource(TEX);
        if (base) applyTexture(materialsOf(mesh), base);
      } catch (e) {
        console.warn('3D Turbo could not load that texture', e);
      }
    }

    async setTextureSource({ NAME, FACE, TEX }) {
      await init();
      if (!targetsOf(NAME).length) return;
      try {
        const base = await resolveTextureSource(TEX);
        if (base) targetsOf(NAME).forEach((o) => applyTexture(materialsForFace(o, FACE), base));
      } catch (e) {
        console.warn('3D Turbo could not load that texture', e);
      }
    }

    setDefaultTexture({ TEX }) {
      const s = str(TEX).trim();
      defaultTextureSrc = s && s !== 'none' ? s : null;
    }

    clearDefaultTexture() {
      defaultTextureSrc = null;
    }

    // ===== Tags, data and selectors =====

    addTag({ NAME, TAG }) {
      const tags = str(TAG).split(',').map((t) => t.trim()).filter(Boolean);
      targetsOf(NAME).forEach((o) => {
        const list = tagList(o);
        tags.forEach((t) => {
          if (!list.includes(t)) list.push(t);
        });
      });
    }

    removeTag({ TAG, NAME }) {
      const tags = str(TAG).split(',').map((t) => t.trim()).filter(Boolean);
      targetsOf(NAME).forEach((o) => {
        o.userData.tags = tagList(o).filter((t) => !tags.includes(t));
      });
    }

    hasTag({ NAME, TAG }) {
      const list = targetsOf(NAME);
      const tag = str(TAG).trim();
      return list.length > 0 && list.every((o) => tagList(o).includes(tag));
    }

    tagsOfObject({ NAME }) {
      const o = targetsOf(NAME)[0];
      return o ? JSON.stringify(tagList(o)) : '[]';
    }

    setData({ KEY, NAME, VALUE }) {
      const key = str(KEY).trim();
      if (!key) return;
      targetsOf(NAME).forEach((o) => (dataStore(o)[key] = VALUE));
    }

    changeData({ KEY, NAME, VALUE }) {
      const key = str(KEY).trim();
      if (!key) return;
      targetsOf(NAME).forEach((o) => {
        const d = dataStore(o);
        d[key] = num(d[key]) + num(VALUE);
      });
    }

    deleteData({ KEY, NAME }) {
      const key = str(KEY).trim();
      targetsOf(NAME).forEach((o) => {
        if (o.userData.data) delete o.userData.data[key];
      });
    }

    getData({ KEY, NAME }) {
      const key = str(KEY).trim();
      const o = targetsOf(NAME)[0];
      if (!o || !o.userData.data || !(key in o.userData.data)) return '';
      return o.userData.data[key];
    }

    copyFrom({ WHAT, FROM, TO }) {
      const src = targetsOf(FROM)[0];
      if (!src) return;
      const what = str(WHAT);
      const all = what === 'everything';
      touchColor(src);
      const srcMat = materialsOf(src).find((m) => m.color);
      targetsOf(TO).forEach((t) => {
        if (t === src) return;
        if (all || what === 'position') t.position.copy(src.position);
        if (all || what === 'rotation') t.rotation.copy(src.rotation);
        if (all || what === 'size') t.scale.copy(src.scale);
        if (all || what === 'visibility') t.visible = src.visible;
        if ((all || what === 'color') && srcMat) {
          touchColor(t);
          materialsOf(t).forEach((m) => m.color && m.color.copy(srcMat.color));
        }
        if (all || what === 'all data') t.userData.data = JSON.parse(JSON.stringify(src.userData.data || {}));
        if (all || what === 'tags') t.userData.tags = tagList(src).slice();
      });
    }

    matchingList({ SELECTOR }) {
      return JSON.stringify(targetsOf(SELECTOR).map((o) => o.userData.name));
    }

    matchingCount({ SELECTOR }) {
      return targetsOf(SELECTOR).length;
    }

    matchingNth({ N, SELECTOR }) {
      const o = targetsOf(SELECTOR)[Math.round(num(N)) - 1];
      return o ? o.userData.name : '';
    }

    typeOfObject({ NAME }) {
      const o = targetsOf(NAME)[0];
      return o ? typeOfObj(o) : isPlayerName(NAME) ? 'player' : '';
    }

    objectInfo({ NAME }) {
      const describe = (o) => ({
        name: o.userData.name,
        type: typeOfObj(o),
        group: o.userData.group || '',
        tags: tagList(o).slice(),
        x: o.position.x,
        y: o.position.y,
        z: o.position.z,
        rotX: deg(o.rotation.x),
        rotY: deg(o.rotation.y),
        rotZ: deg(o.rotation.z),
        sizeX: o.scale.x,
        sizeY: o.scale.y,
        sizeZ: o.scale.z,
        visible: o.visible,
        solid: o.userData.solid !== false,
        data: Object.assign({}, o.userData.data || {})
      });
      const list = targetsOf(NAME);
      if (objects.has(str(NAME)) && list.length === 1) return JSON.stringify(describe(list[0]));
      return JSON.stringify(list.map(describe));
    }

    statProp({ AGG, PROP, AXIS, SELECTOR }) {
      const values = targetsOf(SELECTOR).map((o) => this.readProp(o, PROP, AXIS));
      return aggregate(str(AGG), values);
    }

    statData({ AGG, KEY, SELECTOR }) {
      const key = str(KEY).trim();
      const values = [];
      targetsOf(SELECTOR).forEach((o) => {
        if (o.userData.data && key in o.userData.data) values.push(num(o.userData.data[key]));
      });
      return aggregate(str(AGG), values);
    }

    nearestTo({ SELECTOR, X, Y, Z }) {
      let best = '';
      let bestD = Infinity;
      const x = num(X);
      const y = num(Y);
      const z = num(Z);
      targetsOf(SELECTOR).forEach((o) => {
        const d = (o.position.x - x) ** 2 + (o.position.y - y) ** 2 + (o.position.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = o.userData.name;
        }
      });
      return best;
    }

    nearestToPlayer({ SELECTOR }) {
      if (!isReady) return '';
      const p = camera.position;
      return this.nearestTo({ SELECTOR, X: p.x, Y: p.y, Z: p.z });
    }

    forEachObject({ SELECTOR }, util) {
      const f = util.stackFrame;
      if (f.list === undefined) {
        f.list = targetsOf(SELECTOR).map((o) => o.userData.name);
        f.i = 0;
        f.prev = eachCur;
        f.prevI = eachIdx;
      }
      if (f.i < f.list.length) {
        eachCur = f.list[f.i];
        eachIdx = f.i + 1;
        f.i++;
        util.startBranch(1, true);
      } else {
        eachCur = f.prev;
        eachIdx = f.prevI;
      }
    }

    eachObject() {
      return eachCur;
    }

    eachIndex() {
      return eachIdx;
    }

    // ===== Particle emitters =====

    emTargets(NAME) {
      const n = str(NAME);
      return selectNames(n, emitters.keys()).map((k) => emitters.get(k));
    }

    async createEmitter({ NAME, PRESET, X, Y, Z }) {
      await init();
      const name = str(NAME).trim() || 'emitter';
      killEmitter(name);
      const e = newEmitter(name, str(PRESET));
      e.pos.set(num(X), num(Y), num(Z));
      emitters.set(name, e);
    }

    emitterAction({ ACTION, NAME }) {
      if (!isReady) return;
      const action = str(ACTION);
      this.emTargets(NAME).forEach((e) => {
        switch (action) {
          case 'play':
            startEmitter(e);
            break;
          case 'stop emitting':
            e.emitting = false;
            break;
          case 'pause':
            e.playing = false;
            break;
          case 'resume':
            e.playing = true;
            break;
          case 'restart':
            e.n = 0;
            if (e.mesh) e.mesh.count = 0;
            startEmitter(e);
            break;
          case 'clear particles':
            e.n = 0;
            if (e.mesh) e.mesh.count = 0;
            break;
          case 'delete':
            killEmitter(e.name);
            break;
        }
      });
    }

    async emitNow({ COUNT, NAME }) {
      await init();
      this.emTargets(NAME).forEach((e) => emitterBurst(e, num(COUNT)));
    }

    moveEmitter({ NAME, X, Y, Z }) {
      this.emTargets(NAME).forEach((e) => {
        e.follow = null;
        e.pos.set(num(X), num(Y), num(Z));
      });
    }

    attachEmitter({ NAME, TARGET, X, Y, Z }) {
      this.emTargets(NAME).forEach((e) => {
        e.follow = str(TARGET);
        e.offset.set(num(X), num(Y), num(Z));
      });
    }

    detachEmitter({ NAME }) {
      this.emTargets(NAME).forEach((e) => (e.follow = null));
    }

    aimEmitter({ NAME, X, Y, Z }) {
      if (!isReady) return;
      this.emTargets(NAME).forEach((e) => {
        e.dirX = num(X);
        e.dirY = num(Y);
        e.dirZ = num(Z);
        applyEmitterDir(e);
      });
    }

    aimEmitterLook({ NAME }) {
      if (!isReady) return;
      ensureTmp();
      const d = lookDir(emitterTmp.a);
      this.emTargets(NAME).forEach((e) => {
        e.dirX = d.x;
        e.dirY = d.y;
        e.dirZ = d.z;
        applyEmitterDir(e);
      });
    }

    setEmitterNum({ NAME, SETTING, VALUE }) {
      const key = str(SETTING);
      const range = NUM_SETTINGS[key];
      if (!range) return;
      let v = num(VALUE);
      if (range[2]) v /= 100;
      v = Math.max(range[0], Math.min(range[1], v));
      if (key === 'max') v = Math.floor(v);
      this.emTargets(NAME).forEach((e) => {
        e[key] = v;
        if (MESH_KEYS.has(key)) e.dirty = true;
        if (key === 'burstCount' || key === 'burstEvery') e.burstPending = e.burstCount > 0 && e.emitting;
      });
    }

    setEmitterColor({ NAME, WHICH, COLOR }) {
      if (!isReady) return;
      const c = toColor(COLOR);
      const which = str(WHICH);
      this.emTargets(NAME).forEach((e) => {
        if (which.startsWith('start')) {
          e.colorA.copy(c);
          e.colorB.copy(c);
          e.palette = null;
        } else if (which.startsWith('second')) {
          e.colorB.copy(c);
          e.palette = null;
        } else {
          e.colorEnd.copy(c);
          e.useEnd = true;
        }
      });
    }

    setEmitterShape({ NAME, SHAPE }) {
      const s = str(SHAPE);
      if (!['point', 'sphere', 'hemisphere', 'cone', 'box', 'circle', 'edge'].includes(s)) return;
      this.emTargets(NAME).forEach((e) => (e.shape = s));
    }

    setEmitterLook({ NAME, LOOK }) {
      const s = str(LOOK);
      if (!['soft glow', 'circle', 'square', 'star', 'ring', 'spark', 'cube', 'sphere'].includes(s)) return;
      this.emTargets(NAME).forEach((e) => {
        e.look = s;
        e.dirty = true;
      });
    }

    setEmitterToggle({ OPTION, STATE, NAME }) {
      const on = str(STATE) === 'on';
      const opt = str(OPTION);
      this.emTargets(NAME).forEach((e) => {
        switch (opt) {
          case 'additive glow':
            e.additive = on;
            e.dirty = true;
            break;
          case 'lit by lights':
            e.lit = on;
            e.dirty = true;
            break;
          case 'looping':
            e.looping = on;
            break;
          case 'local space':
            e.space = on ? 'local' : 'world';
            break;
          case 'delete when finished':
            e.autoDelete = on;
            break;
          case 'color change over life':
            e.useEnd = on;
            break;
          case 'spawn on edge only':
            e.edgeOnly = on;
            break;
        }
      });
    }

    setEmitterFloor({ NAME, FLOOR }) {
      const f = str(FLOOR);
      if (!['none', 'bounce', 'stop', 'die'].includes(f)) return;
      this.emTargets(NAME).forEach((e) => (e.floor = f));
    }

    async setEmitterTexture({ NAME, TEX }) {
      await init();
      const list = this.emTargets(NAME);
      if (!list.length) return;
      try {
        const base = await resolveTextureSource(TEX);
        if (!base) return;
        list.forEach((e) => {
          const t = base.clone();
          t.colorSpace = THREE.SRGBColorSpace;
          t.needsUpdate = true;
          if (e.texture) e.texture.dispose();
          e.texture = t;
          e.dirty = true;
        });
      } catch (err) {
        console.warn('3D Turbo could not use that texture for the emitter', err);
      }
    }

    clearEmitterTexture({ NAME }) {
      this.emTargets(NAME).forEach((e) => {
        if (e.texture) e.texture.dispose();
        e.texture = null;
        e.dirty = true;
      });
    }

    emitterInfo({ NAME, INFO }) {
      const e = this.emTargets(NAME)[0];
      if (!e) return 0;
      const info = str(INFO);
      if (info === 'particles alive') return e.n;
      if (info === 'x') return e.pos.x;
      if (info === 'y') return e.pos.y;
      if (info === 'z') return e.pos.z;
      const range = NUM_SETTINGS[info];
      if (!range) return 0;
      if (info === 'floorY') return e.floorY !== null ? e.floorY : player.floorY;
      return range[2] ? e[info] * 100 : e[info];
    }

    emitterExists({ NAME }) {
      return this.emTargets(NAME).length > 0;
    }

    emitterPlaying({ NAME }) {
      return this.emTargets(NAME).some((e) => e.playing && e.emitting);
    }

    listEmitters() {
      return JSON.stringify(Array.from(emitters.keys()));
    }

    emitterParticleTotal() {
      return totalEmitterParticles();
    }

    async playEffect({ PRESET, X, Y, Z, SECS }) {
      await init();
      playEffect(PRESET, num(X), num(Y), num(Z), num(SECS));
    }

    async playEffectAtPlayer({ PRESET, PLACE, SECS }) {
      await init();
      ensureTmp();
      const p = new THREE.Vector3();
      const place = str(PLACE);
      playerFeet(p);
      if (place === 'eyes') p.y += player.eye;
      else if (place === 'above head') p.y += player.eye + 0.4;
      else if (place === 'in front') p.copy(camera.position).addScaledVector(lookDir(emitterTmp.a), 2.5);
      playEffect(PRESET, p.x, p.y, p.z, num(SECS));
    }

    async playEffectAtObject({ PRESET, NAME, SECS }) {
      await init();
      targetsOf(NAME).slice(0, 50).forEach((o) => {
        const box = new THREE.Box3().setFromObject(o);
        if (box.isEmpty()) return;
        const c = box.getCenter(new THREE.Vector3());
        playEffect(PRESET, c.x, c.y, c.z, num(SECS));
      });
    }

    async playEffectAtLook({ PRESET, SECS }) {
      await init();
      const hit = lookHit();
      if (!hit) return;
      const p = hit.point.clone().addScaledVector(hit.normal, 0.05);
      playEffect(PRESET, p.x, p.y, p.z, num(SECS));
    }

    async playEffectFromObject({ PRESET, NAME }) {
      await init();
      targetsOf(NAME).slice(0, 50).forEach((o) => {
        const box = new THREE.Box3().setFromObject(o);
        if (box.isEmpty()) return;
        const c = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        playEffect(PRESET, c.x, c.y, c.z, 1, sampleColors(o, 12), {
          radius: Math.max(size.x, size.z) * 0.4,
          height: size.y * 0.8
        });
      });
    }
  }

  Object.keys(V12.fns).forEach((k) => {
    Turbo3D.prototype[k] = V12.fns[k];
  });

  // Register each palette section as an independent extension category.
  // Namespace opcodes per category to prevent collisions between extensions.
  const completeInfo = new Turbo3D().getInfo();
  const sections = [];
  let activeSection = null;

  const categoryNames = [
    'Loading', 'Ready-made', 'World', 'Files', 'Objects', 'Groups',
    'Textures', 'Texture tools', 'Models', 'Movement', 'Player',
    'Camera', 'Mouse', 'Interaction', 'Editor', 'Sprites',
    'Particles', 'Emitters', 'Effects', 'Lights', 'Settings',
    'Selectors', 'Find objects', 'Per-frame loop'
  ];

  for (const originalBlock of completeInfo.blocks) {
    if (originalBlock && originalBlock.blockType === Scratch.BlockType.LABEL) {
      const heading = String(originalBlock.text || '').trim();
      if (!heading || heading.startsWith('Version ')) continue;

      // This is explanatory text inside the Selectors section, not a category.
      if (heading.startsWith('box*')) {
        if (activeSection) activeSection.blocks.push({ ...originalBlock });
        continue;
      }

      activeSection = {
        name: categoryNames[sections.length] || heading.split('(')[0].trim(),
        blocks: [],
        opcodeMap: []
      };
      sections.push(activeSection);
      continue;
    }

    if (activeSection && originalBlock && originalBlock.opcode) {
      const originalOpcode = originalBlock.opcode;
      const uniqueOpcode = 'cat' + sections.length + '_' + originalOpcode;
      const block = { ...originalBlock, opcode: uniqueOpcode };

      if (originalBlock.arguments) {
        block.arguments = Object.fromEntries(
          Object.entries(originalBlock.arguments).map(([key, value]) => [
            key,
            value && typeof value === 'object' ? { ...value } : value
          ])
        );
      }

      activeSection.blocks.push(block);
      activeSection.opcodeMap.push({ uniqueOpcode, originalOpcode });
    }
  }

  const pinks = [
    ['#ff9acb', '#ff7ab8', '#e85aa0'],
    ['#ffadd5', '#ff8fc5', '#ed70ad'],
    ['#f58fc5', '#e96eaf', '#d94d98'],
    ['#ffc0df', '#ff9dce', '#ed79b7'],
    ['#ee9acb', '#df78b4', '#c95698'],
    ['#ffa6d0', '#f282bd', '#df5ca5'],
    ['#f7b2d5', '#ee91c3', '#dc6aaa']
  ];

  sections.forEach((section, index) => {
    if (!section.blocks.length) return;

    const colors = pinks[index % pinks.length];
    const category = {
      id: 'turbo3dcat' + index,
      name: '3D ' + section.name,
      blocks: section.blocks,
      color1: colors[0],
      color2: colors[1],
      color3: colors[2]
    };

    const extension = new Turbo3D(category);

    // Preserve the original block implementations through per-category wrappers.
    for (const { uniqueOpcode, originalOpcode } of section.opcodeMap) {
      extension[uniqueOpcode] = function (...args) {
        return this[originalOpcode](...args);
      };
    }

    Scratch.extensions.register(extension);
  });
})(Scratch);
