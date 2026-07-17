// ---------------------------------------------------------------------------
// Macintosh 128K (1984) — 高精度程序化 three.js 模型
//
// * 按真实尺寸建模（米制）：主机 0.244 × 0.345 × 0.278 m，
//   M0110 键盘、M0100 单键鼠标、400K 软盘均按实物比例。
// * 物理正确渲染：three.js 物理光照单位（lux / candela）、
//   MeshPhysicalMaterial（清漆层塑料 / CRT 玻璃）、ACES 色调映射、
//   基于图像的环境光照（PMREM RoomEnvironment）、PCF 软阴影。
// * 细节：前面板倒角挤出 + 屏幕/软驱/徽标/亮度轮真实凹槽、顶部提手
//   凹槽与横梁、背部散热缝与接口区、螺旋键盘线、CRT 曲面玻璃、
//   System 1 桌面画面（Canvas 程序绘制）、六色苹果徽标。
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// ============================================================== 基础 & 渲染器

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;          // 软阴影
renderer.toneMapping = THREE.ACESFilmicToneMapping;        // 物理色调映射
renderer.toneMappingExposure = 0.95;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x24211c);

// 基于图像的环境光照（IBL）：让清漆塑料与 CRT 玻璃有真实反射
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(
  38, window.innerWidth / window.innerHeight, 0.01, 40);

// 支持 ?cam=x,y,z&tgt=x,y,z 便于截图调试
const q = new URLSearchParams(location.search);
const v3 = (s, d) => {
  if (!s) return d;
  const a = s.split(',').map(Number);
  return a.length === 3 && a.every(Number.isFinite) ? new THREE.Vector3(...a) : d;
};
camera.position.copy(v3(q.get('cam'), new THREE.Vector3(0.48, 0.42, 0.86)));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(v3(q.get('tgt'), new THREE.Vector3(0, 0.14, 0)));
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 0.15;
controls.maxDistance = 4;
controls.maxPolarAngle = Math.PI * 0.52;
controls.autoRotateSpeed = 1.2;

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') controls.autoRotate = !controls.autoRotate;
  if (e.key === 'e' || e.key === 'E') downloadGLB();
});

// ============================================================== GLB 导出

async function exportGLB() {
  const exporter = new GLTFExporter();
  // 只导出设备组（不含房间、灯光、相机）
  return exporter.parseAsync(setup, { binary: true });
}

async function downloadGLB() {
  const buf = await exportGLB();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
  a.download = 'macintosh-128k.glb';
  a.click();
  URL.revokeObjectURL(a.href);
}

// 供自动化脚本调用：返回 base64 编码的 GLB
window.exportGLB = async () => {
  const bytes = new Uint8Array(await exportGLB());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

// ============================================================== 材质（PBR）

const ENV = 0.3; // 环境反射强度基准

function plastic(color, rough = 0.42, clearcoat = 0.22) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: rough, metalness: 0.0,
    clearcoat, clearcoatRoughness: 0.38, envMapIntensity: ENV,
  });
}

const M = {
  case:      plastic(0xd9d0bb),                 // 主机外壳（经典米灰 Pantone 453 风）
  caseDark:  plastic(0xc7bda7, 0.5, 0.1),       // 底座
  bezelDark: new THREE.MeshPhysicalMaterial({   // 屏幕内框（哑光深灰）
    color: 0x2e2a25, roughness: 0.6, metalness: 0, envMapIntensity: 0.25 }),
  slot: new THREE.MeshStandardMaterial({        // 软驱缝 / 散热缝（近黑）
    color: 0x151109, roughness: 0.85, metalness: 0 }),
  kbCase:    plastic(0xded5c0),                 // 键盘壳
  key:       plastic(0xe6dfca, 0.4, 0.3),       // 键帽
  wheel: new THREE.MeshStandardMaterial({       // 亮度调节轮
    color: 0x3b362e, roughness: 0.7, flatShading: true }),
  cable: new THREE.MeshStandardMaterial({       // 线缆
    color: 0x847c6d, roughness: 0.62, metalness: 0 }),
  metal: new THREE.MeshStandardMaterial({       // 软盘金属滑门
    color: 0xb9bdc4, roughness: 0.32, metalness: 0.9, envMapIntensity: 0.8 }),
};
// 凹槽/薄片统一双面，避免视角穿帮
M.caseDS = M.case.clone(); M.caseDS.side = THREE.DoubleSide;
M.bezelDarkDS = M.bezelDark.clone(); M.bezelDarkDS.side = THREE.DoubleSide;

// ============================================================== 几何工具函数

// 圆角矩形轮廓点（XY 平面，逆时针，闭合环，点数 = 4*(cseg+1)）
function roundedRectPoints(w, h, r, cseg = 8) {
  const pts = [];
  const hw = w / 2, hh = h / 2;
  r = Math.min(r, hw, hh);
  const corners = [
    [hw - r, hh - r, 0], [-hw + r, hh - r, 90],
    [-hw + r, -hh + r, 180], [hw - r, -hh + r, 270],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= cseg; i++) {
      const a = (a0 + (90 * i) / cseg) * Math.PI / 180;
      pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
    }
  }
  return pts;
}

function roundedRectShape(w, h, r, cseg = 8) {
  const shape = new THREE.Shape();
  const pts = roundedRectPoints(w, h, r, cseg);
  shape.setFromPoints(pts);
  shape.closePath();
  return shape;
}

function roundedRectPath(w, h, r, cx = 0, cy = 0, cseg = 8) {
  const path = new THREE.Path();
  const pts = roundedRectPoints(w, h, r, cseg).map(
    (p) => new THREE.Vector2(p.x + cx, p.y + cy));
  path.setFromPoints(pts);
  path.closePath();
  return path;
}

// 两个轮廓环之间放样出斜壁（用于模具式凹槽：外环在 z0，内环缩进到 z1）
function loftRing(outer, inner, z0, z1, material) {
  const n = outer.length;
  const pos = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    pos.set([outer[i].x, outer[i].y, z0], i * 3);
    pos.set([inner[i].x, inner[i].y, z1], (n + i) * 3);
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + j, i, n + j, n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

// 平底圆角矩形板
function plate(w, h, r, material) {
  return new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(w, h, r)), material);
}

function rbox(w, h, d, r, material, seg = 3) {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), material);
}

// ============================================================== 主机尺寸常量

const MAC = {
  W: 0.244, H: 0.345, D: 0.278,       // 整机
  bezelT: 0.048,                      // 前面板厚度
  screen: { cx: 0, cy: 0.235, w: 0.202, h: 0.157, r: 0.016 }, // 屏幕开口（世界系）
  floppy: { cx: 0.0585, cy: 0.0995, w: 0.094, h: 0.030, r: 0.006 },
  badge:  { cx: -0.087, cy: 0.100, w: 0.015, h: 0.019, r: 0.0035 },
  dial:   { cx: -0.062, cy: 0.146, w: 0.020, h: 0.006, r: 0.0025 },
};
const BEV = 0.0015;                   // 前面板倒角尺寸

// 设备组：主机 + 外设，可整体导出为 GLB（按 E）
const setup = new THREE.Group();
setup.name = 'Macintosh128K';
scene.add(setup);

const mac = new THREE.Group();
mac.name = 'Mac';
setup.add(mac);

// ---------------------------------------------------------------- 前面板

{
  const shellH = 0.331;               // 挤出轮廓高（倒角后 0.334，底 0.010 → 顶 0.345 附近）
  const cy = 0.010 + (0.345 - 0.010) / 2;   // 面板中心高度
  const shape = roundedRectShape(0.240, shellH, 0.012);

  const holes = [MAC.screen, MAC.floppy, MAC.badge, MAC.dial].map((o) =>
    roundedRectPath(o.w, o.h, o.r, o.cx, o.cy - cy));
  shape.holes.push(...holes);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.042, bevelEnabled: true, bevelThickness: 0.003,
    bevelSize: BEV, bevelSegments: 4, curveSegments: 8,
  });
  const bezel = new THREE.Mesh(geo, M.case);
  // 几何 z ∈ [-0.003, 0.045]，平移使正面盖板停在 z = 0
  bezel.position.set(0, cy, -0.045);
  mac.add(bezel);
}

// ---------------------------------------------------------------- 屏幕组件

{
  const s = MAC.screen;
  const g = new THREE.Group();
  g.position.set(s.cx, s.cy, 0);
  mac.add(g);

  // 斜壁凹槽（画框式，从开口收进到 CRT 框）
  const outer = roundedRectPoints(s.w - 2 * BEV - 0.001, s.h - 2 * BEV - 0.001, 0.0145);
  const inner = roundedRectPoints(0.180, 0.135, 0.008);
  g.add(loftRing(outer, inner, -0.0028, -0.021, M.caseDS));

  // 哑光深色内框
  const frameShape = roundedRectShape(0.181, 0.136, 0.008);
  frameShape.holes.push(roundedRectPath(0.172, 0.127, 0.006));
  const frame = new THREE.Mesh(new THREE.ShapeGeometry(frameShape), M.bezelDarkDS);
  frame.position.z = -0.0212;
  g.add(frame);

  // CRT：轻微外凸曲面（球面鼓形），玻璃清漆 + 自发光画面
  const crtGeo = new THREE.PlaneGeometry(0.176, 0.131, 48, 36);
  const posAttr = crtGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const nx = posAttr.getX(i) / 0.088, ny = posAttr.getY(i) / 0.0655;
    posAttr.setZ(i, 0.008 *
      Math.cos(nx * 0.9 * Math.PI / 2) * Math.cos(ny * 0.9 * Math.PI / 2));
  }
  crtGeo.computeVertexNormals();

  const screenTex = makeScreenTexture();
  const crtMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a0a0c, roughness: 0.09, metalness: 0,   // 玻璃面：高光小而锐
    clearcoat: 0.35, clearcoatRoughness: 0.08, envMapIntensity: 0.4,
    emissive: 0xffffff, emissiveMap: screenTex, emissiveIntensity: 1.25,
  });
  const crt = new THREE.Mesh(crtGeo, crtMat);
  crt.position.z = -0.0295;
  g.add(crt);
  mac.userData.crtMat = crtMat;

  // 屏幕对场景的真实照明贡献（微弱冷白点光，物理衰减）
  const glow = new THREE.PointLight(0xcfe0ff, 0.28, 0.9, 2);
  glow.position.set(0, 0, 0.07);
  g.add(glow);
}

// ---------------------------------------------------------------- 软驱槽

{
  const f = MAC.floppy;
  const g = new THREE.Group();
  g.position.set(f.cx, f.cy, 0);
  mac.add(g);

  const outer = roundedRectPoints(f.w - 2 * BEV - 0.001, f.h - 2 * BEV - 0.001, 0.005);
  const inner = roundedRectPoints(0.082, 0.018, 0.003);
  g.add(loftRing(outer, inner, -0.0028, -0.009, M.caseDS));

  const back = plate(0.083, 0.019, 0.003, M.caseDS);
  back.position.z = -0.0092;
  g.add(back);

  // 400K 软驱插入缝
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.070, 0.0045, 0.002), M.slot);
  slit.position.z = -0.0085;
  g.add(slit);
}

// ---------------------------------------------------------------- 六色苹果徽标

{
  const b = MAC.badge;
  const g = new THREE.Group();
  g.position.set(b.cx, b.cy, 0);
  mac.add(g);

  const outer = roundedRectPoints(b.w - 2 * BEV - 0.0006, b.h - 2 * BEV - 0.0006, 0.0025, 4);
  const inner = roundedRectPoints(0.0122, 0.0162, 0.002, 4);
  g.add(loftRing(outer, inner, -0.0022, -0.0045, M.caseDS));

  const badgeMat = new THREE.MeshPhysicalMaterial({
    map: makeAppleBadgeTexture(), roughness: 0.45, clearcoat: 0.3,
    clearcoatRoughness: 0.35, envMapIntensity: ENV, side: THREE.DoubleSide,
  });
  // PlaneGeometry 自带 0~1 UV（ShapeGeometry 的 UV 是米制坐标，无法直接贴图）
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.0125, 0.0165), badgeMat);
  face.position.z = -0.0046;
  g.add(face);
}

// ---------------------------------------------------------------- 亮度调节轮

{
  const d = MAC.dial;
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.0055, 28), M.wheel);
  wheel.rotation.z = Math.PI / 2;      // 轮轴沿 X，轮缘从缝中露出
  wheel.position.set(d.cx, d.cy, -0.013);
  mac.add(wheel);
}

// ---------------------------------------------------------------- 后桶身（垂直挤出 + 顶部提手孔）

{
  // 截面形状：X 直接对应世界 X；形状 Y = -世界 Z（挤出方向旋转后成为高度）
  const syFront = 0.046, syBack = 0.275;
  const shape = roundedRectShape(0.234, syBack - syFront, 0.010);
  const syCenter = (syFront + syBack) / 2;

  // 提手开口：世界 z = -0.21 → 形状 y = 0.21 - syCenter
  shape.holes.push(roundedRectPath(0.104, 0.050, 0.012, 0, 0.21 - syCenter));

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.329, bevelEnabled: true, bevelThickness: 0.003,
    bevelSize: 0.003, bevelSegments: 4, curveSegments: 8,
  });
  const bucket = new THREE.Mesh(geo, M.case);
  bucket.rotation.x = -Math.PI / 2;    // 挤出方向 → +Y；形状 y → -Z
  bucket.position.set(0, 0.013, -syCenter);
  mac.add(bucket);
}

// ---------------------------------------------------------------- 提手凹槽 + 横梁

{
  const g = new THREE.Group();
  g.position.set(0, 0.342, -0.21);
  mac.add(g);

  const outer = roundedRectPoints(0.098, 0.044, 0.009);
  const inner = roundedRectPoints(0.076, 0.024, 0.006);
  const well = loftRing(outer, inner, 0, -0.032, M.caseDS);
  well.rotation.x = -Math.PI / 2;      // 开口朝上
  g.add(well);

  const floor = plate(0.077, 0.025, 0.006, M.caseDS);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.0325;
  g.add(floor);

  // 抓握横梁（贴住凹槽前缘，指尖从后方伸入）
  const bar = rbox(0.104, 0.012, 0.017, 0.005, M.case);
  bar.position.set(0, -0.0035, 0.015);
  g.add(bar);
}

// ---------------------------------------------------------------- 底座

{
  const base = rbox(0.222, 0.012, 0.256, 0.004, M.caseDark);
  base.position.set(0, 0.006, -0.144);
  mac.add(base);
}

// ---------------------------------------------------------------- 背部：散热缝 + 接口区

{
  const backZ = -0.278;
  for (let i = 0; i < 12; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.042, 0.003), M.slot);
    slot.position.set(-0.077 + i * 0.014, 0.295, backZ + 0.0005);
    mac.add(slot);
  }
  const bay = rbox(0.150, 0.030, 0.005, 0.004, M.bezelDark);
  bay.position.set(0.012, 0.047, backZ + 0.001);
  mac.add(bay);
  for (let i = 0; i < 4; i++) {
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 16), M.slot);
    port.rotation.x = Math.PI / 2;
    port.position.set(-0.03 + i * 0.028, 0.047, backZ - 0.001);
    mac.add(port);
  }
  const sw = rbox(0.018, 0.010, 0.006, 0.002, M.caseDark);
  sw.position.set(-0.093, 0.047, backZ);
  mac.add(sw);
}

// ---------------------------------------------------------------- 键盘接口（前面板右下角）

{
  const jack = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.009, 0.003), M.slot);
  jack.position.set(0.095, 0.02, -0.001);
  mac.add(jack);
}

// ============================================================== M0110 键盘

const keyboard = new THREE.Group();
keyboard.name = 'KeyboardM0110';
setup.add(keyboard);

{
  // 楔形壳体：侧截面挤出（形状 x = 距前缘深度，y = 高度）
  const p = new THREE.Shape();
  p.moveTo(0.004, 0.003);
  p.lineTo(0.138, 0.003);
  p.lineTo(0.142, 0.008);
  p.lineTo(0.142, 0.038);
  p.lineTo(0.136, 0.043);
  p.lineTo(0.014, 0.029);
  p.lineTo(0.004, 0.025);
  p.closePath();
  const geo = new THREE.ExtrudeGeometry(p, {
    depth: 0.325, bevelEnabled: true, bevelThickness: 0.0015,
    bevelSize: 0.0015, bevelSegments: 3,
  });
  const shell = new THREE.Mesh(geo, M.kbCase);
  shell.rotation.y = Math.PI / 2;      // 挤出方向 → +X；形状 x → -Z
  shell.position.set(-0.1625, 0.001, 0.247);
  keyboard.add(shell);

  // 小脚垫
  for (const [fx, fz] of [[-0.15, 0.115], [0.15, 0.115], [-0.15, 0.24], [0.15, 0.24]]) {
    const foot = rbox(0.014, 0.004, 0.012, 0.0015, M.caseDark);
    foot.position.set(fx, 0.001, fz);
    keyboard.add(foot);
  }
}

// 键帽（按 M0110 布局，1u = 19.05mm 标准键距）
{
  const U = 0.019;
  const rows = [
    // [宽度(u), 标签] —— 自上而下 5 行
    [['`',1],['1',1],['2',1],['3',1],['4',1],['5',1],['6',1],['7',1],['8',1],['9',1],['0',1],['-',1],['=',1],['Backspace',1.5]],
    [['Tab',1.5],['Q',1],['W',1],['E',1],['R',1],['T',1],['Y',1],['U',1],['I',1],['O',1],['P',1],['[',1],[']',1],['\\',1]],
    [['Caps Lock',1.75],['A',1],['S',1],['D',1],['F',1],['G',1],['H',1],['J',1],['K',1],['L',1],[';',1],["'",1],['Return',1.75]],
    [['Shift',2.25],['Z',1],['X',1],['C',1],['V',1],['B',1],['N',1],['M',1],[',',1],['.',1],['/',1],['Shift',2.25]],
    [['Option',1.75],['⌘',1.25],[' ',8.25],['⌘',1.25],['Option',2.0]],
  ];

  const slope = Math.atan2(0.014, 0.122);       // 壳体顶面倾角 ≈ 6.5°
  const field = new THREE.Group();
  field.position.set(0, 0.0375, 0.171);
  field.rotation.x = slope;
  keyboard.add(field);

  const geoCache = new Map();
  const capGeo = (w) => {
    if (!geoCache.has(w)) {
      geoCache.set(w, new RoundedBoxGeometry(w * U - 0.0035, 0.0095, 0.0158, 3, 0.0022));
    }
    return geoCache.get(w);
  };

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const total = row.reduce((s, k) => s + k[1], 0) * U;
    let x = -total / 2;
    for (const [label, w] of row) {
      const key = new THREE.Mesh(capGeo(w), M.key);
      key.position.set(x + (w * U) / 2, 0.0048, (r - 2) * U);
      field.add(key);
      if (label.trim()) {
        const lab = makeKeyLabel(label, w);
        lab.position.set(key.position.x, key.position.y + 0.0050, key.position.z);
        lab.rotation.x = -Math.PI / 2;
        field.add(lab);
      }
      x += w * U;
    }
  }
}

keyboard.position.set(0.005, 0, 0.09);

// ============================================================== M0100 鼠标

const mouse = new THREE.Group();
mouse.name = 'MouseM0100';
setup.add(mouse);

{
  const body = rbox(0.060, 0.030, 0.100, 0.007, M.kbCase);
  body.position.y = 0.015;
  mouse.add(body);

  // 单键（前端，接缝用深色垫板表现）
  const seam = rbox(0.048, 0.003, 0.034, 0.0012, M.wheel);
  seam.position.set(0, 0.0292, -0.028);
  mouse.add(seam);
  const button = rbox(0.044, 0.006, 0.030, 0.0025, M.key);
  button.position.set(0, 0.0318, -0.028);
  mouse.add(button);
}

mouse.position.set(0.235, 0, 0.155);
mouse.rotation.y = -0.14;

// ============================================================== 线缆

// 螺旋卷线（键盘 → 主机前面板右下）
function coiledCable(waypoints, coilR, turnsPerMeter, tubeR, material) {
  const base = new THREE.CatmullRomCurve3(
    waypoints.map((p) => new THREE.Vector3(...p)));
  const N = 1000;
  const frames = base.computeFrenetFrames(N, false);
  const len = base.getLength();
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const s = t * len;
    const fade = Math.min(1, Math.min(s, len - s) / 0.022); // 两端收为直线
    const theta = s * turnsPerMeter * Math.PI * 2;
    const p = base.getPointAt(t);
    const fi = Math.min(i, N - 1);
    p.addScaledVector(frames.normals[fi], coilR * fade * Math.cos(theta));
    p.addScaledVector(frames.binormals[fi], coilR * fade * Math.sin(theta));
    pts.push(p);
  }
  const geo = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(pts), 1400, tubeR, 8, false);
  return new THREE.Mesh(geo, material);
}

setup.add(coiledCable(
  [[0.105, 0.018, 0.192], [0.140, 0.011, 0.130], [0.130, 0.009, 0.050], [0.095, 0.018, 0.002]],
  0.0058, 150, 0.0015, M.cable));

// 鼠标直线（绕过主机右侧到背部接口）
{
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.228, 0.024, 0.108),
    new THREE.Vector3(0.262, 0.006, 0.030),
    new THREE.Vector3(0.252, 0.003, -0.120),
    new THREE.Vector3(0.190, 0.004, -0.250),
    new THREE.Vector3(0.090, 0.030, -0.305),
    new THREE.Vector3(0.026, 0.047, -0.282),
  ]);
  setup.add(new THREE.Mesh(
    new THREE.TubeGeometry(curve, 240, 0.0016, 8, false), M.cable));
}

// ============================================================== 3.5 英寸软盘

{
  const disk = new THREE.Group();
  const body = rbox(0.090, 0.0033, 0.094, 0.0022, plastic(0x5c636e, 0.55, 0.05));
  body.position.y = 0.0017;
  disk.add(body);
  const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.031, 0.0037, 0.034), M.metal);
  shutter.position.set(0.002, 0.0017, -0.026);
  disk.add(shutter);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.068, 0.048),
    new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.9 }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, 0.00355, 0.018);
  disk.add(label);
  disk.position.set(-0.235, 0, 0.19);
  disk.rotation.y = 0.35;
  disk.name = 'FloppyDisk';
  setup.add(disk);
}

// ============================================================== 桌面 / 墙面 / 地面

{
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.05, 1.5),
    new THREE.MeshStandardMaterial({
      map: makeWoodTexture(), roughness: 0.68, metalness: 0, envMapIntensity: 0.18,
    }));
  desk.position.set(0, -0.025, -0.1);
  scene.add(desk);

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 4),
    new THREE.MeshStandardMaterial({ color: 0x69614f, roughness: 0.95 }));
  wall.position.set(0, 1.0, -0.97);
  scene.add(wall);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x37322b, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.78;
  scene.add(floor);
}

// ============================================================== 光照（物理单位）

{
  // 主光：暖色平行光（模拟窗光），产生软阴影
  const key = new THREE.DirectionalLight(0xfff1de, 3.4);
  key.position.set(1.15, 2.3, 0.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -0.8;
  key.shadow.camera.right = 0.8;
  key.shadow.camera.top = 0.9;
  key.shadow.camera.bottom = -0.5;
  key.shadow.camera.near = 0.3;
  key.shadow.camera.far = 5;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.012;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(0, 0.15, 0);

  // 补光：冷色聚光（强度单位 cd，按平方反比衰减）
  const fill = new THREE.SpotLight(0xdde8ff, 8, 0, 0.7, 1.0, 2);
  fill.position.set(-1.75, 0.75, 1.45);
  fill.target.position.set(0, 0.15, 0);
  scene.add(fill, fill.target);

  // 背光：模拟墙面反弹，把背板从死黑里提出来
  const bounce = new THREE.DirectionalLight(0xe8dfcc, 1.0);
  bounce.position.set(-0.7, 0.9, -1.6);
  bounce.target.position.set(0, 0.2, 0);
  scene.add(bounce, bounce.target);

  // 半球光：天空 / 桌面反弹
  scene.add(new THREE.HemisphereLight(0xc9d4e0, 0x6e6152, 0.32));
}

// 所有实体投射 / 接收阴影
scene.traverse((o) => {
  if (o.isMesh) {
    o.castShadow = !o.userData.noShadow;
    o.receiveShadow = true;
  }
});

// ============================================================== Canvas 纹理

// —— System 1 桌面画面 ——
function makeScreenTexture() {
  const W = 1024, H = 684;             // 512×342 @2x
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  // CRT 圆角遮罩（黑底）
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);
  x.save();
  x.beginPath();
  x.roundRect(6, 6, W - 12, H - 12, 44);
  x.clip();

  // 桌面：50% 抖动灰（经典 1-bit 桌面图案）
  const dither = document.createElement('canvas');
  dither.width = dither.height = 4;
  const dx = dither.getContext('2d');
  dx.fillStyle = '#a9a9a9'; dx.fillRect(0, 0, 4, 4);
  dx.fillStyle = '#606060';
  dx.fillRect(0, 0, 2, 2); dx.fillRect(2, 2, 2, 2);
  x.fillStyle = x.createPattern(dither, 'repeat');
  x.fillRect(0, 0, W, H);

  // 菜单栏
  x.fillStyle = '#fff';
  x.fillRect(0, 0, W, 40);
  x.fillStyle = '#000';
  x.fillRect(0, 40, W, 3);
  drawApple(x, 26, 7, 26, '#000');
  x.fillStyle = '#000';
  x.font = '600 26px Helvetica, Arial, sans-serif';
  x.textBaseline = 'middle';
  let mx = 76;
  for (const m of ['File', 'Edit', 'View', 'Special']) {
    x.fillText(m, mx, 22);
    mx += x.measureText(m).width + 42;
  }

  // 磁盘图标（右上）
  iconWithLabel(x, 880, 76, 'System Disk', (px, py) => {
    x.fillStyle = '#fff'; x.fillRect(px, py, 62, 78);
    x.strokeStyle = '#000'; x.lineWidth = 3; x.strokeRect(px, py, 62, 78);
    x.fillStyle = '#000';
    x.fillRect(px + 12, py + 8, 38, 10);       // 滑门
    x.strokeRect(px + 16, py + 44, 30, 24);    // 标签
  });

  // 废纸篓（右下）
  iconWithLabel(x, 896, 528, 'Trash', (px, py) => {
    x.fillStyle = '#fff';
    x.strokeStyle = '#000'; x.lineWidth = 3;
    x.fillRect(px + 6, py + 14, 50, 64); x.strokeRect(px + 6, py + 14, 50, 64);
    x.fillRect(px, py + 6, 62, 8); x.strokeRect(px, py + 6, 62, 8);
    x.beginPath();
    for (const lx of [20, 31, 42]) { x.moveTo(px + lx, py + 22); x.lineTo(px + lx, py + 70); }
    x.stroke();
  });

  // 欢迎对话框
  const dw = 620, dh = 210, dxp = (W - dw) / 2, dyp = 250;
  x.fillStyle = '#fff'; x.fillRect(dxp, dyp, dw, dh);
  x.strokeStyle = '#000';
  x.lineWidth = 4; x.strokeRect(dxp, dyp, dw, dh);
  x.lineWidth = 2; x.strokeRect(dxp + 8, dyp + 8, dw - 16, dh - 16);
  drawHappyMac(x, dxp + 52, dyp + 62, 84);
  x.fillStyle = '#000';
  x.font = '400 34px Helvetica, Arial, sans-serif';
  x.fillText('Welcome to Macintosh.', dxp + 170, dyp + dh / 2);

  x.restore();

  // 扫描线 + 暗角（CRT 质感）
  x.fillStyle = 'rgba(0,0,0,0.05)';
  for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 2);
  const vg = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.42)');
  x.fillStyle = vg;
  x.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;

  function iconWithLabel(ctx, px, py, label, draw) {
    draw(px, py);
    ctx.font = '400 22px Helvetica, Arial, sans-serif';
    const tw = ctx.measureText(label).width;
    const lx = px + 31 - tw / 2;
    ctx.fillStyle = '#fff';
    ctx.fillRect(lx - 4, py + 84, tw + 8, 26);
    ctx.fillStyle = '#000';
    ctx.fillText(label, lx, py + 97);
  }
}

// 经典 Happy Mac 图标（矩形拼绘）
function drawHappyMac(x, px, py, s) {
  const u = s / 32;
  x.fillStyle = '#fff';
  x.fillRect(px, py, 26 * u, 30 * u);
  x.strokeStyle = '#000'; x.lineWidth = Math.max(2, u);
  x.strokeRect(px, py, 26 * u, 30 * u);
  x.strokeRect(px + 4 * u, py + 3 * u, 18 * u, 15 * u);   // 屏幕
  x.fillStyle = '#000';
  x.fillRect(px + 9 * u, py + 7 * u, u * 1.4, 4 * u);     // 眼
  x.fillRect(px + 16 * u, py + 7 * u, u * 1.4, 4 * u);
  x.fillRect(px + 12.4 * u, py + 10 * u, u * 1.4, 3 * u); // 鼻
  x.beginPath();                                          // 微笑
  x.arc(px + 13 * u, py + 12.4 * u, 3.6 * u, 0.25 * Math.PI, 0.75 * Math.PI);
  x.lineWidth = Math.max(2, u * 1.2);
  x.stroke();
  x.fillRect(px + 6 * u, py + 22 * u, 14 * u, 1.6 * u);   // 软驱缝
}

// 苹果剪影（两圆并集 + 咬口 + 叶）
function drawApple(x, px, py, s, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.beginPath(); g.arc(24, 36, 17, 0, 7); g.fill();
  g.beginPath(); g.arc(40, 36, 17, 0, 7); g.fill();
  g.beginPath(); g.ellipse(34, 12, 5, 9, 0.7, 0, 7); g.fill();  // 叶
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(63, 32, 13, 0, 7); g.fill();             // 咬口
  if (color !== '#000') {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color; g.fillRect(0, 0, 64, 64);
  }
  x.drawImage(c, px, py, s, s);
}

// 六色条纹苹果徽标
function makeAppleBadgeTexture() {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#d9d0bb';             // 与外壳同色的底
  x.fillRect(0, 0, 96, 128);

  const a = document.createElement('canvas');
  a.width = 96; a.height = 128;
  const g = a.getContext('2d');
  g.fillStyle = '#000';
  g.beginPath(); g.arc(34, 74, 27, 0, 7); g.fill();
  g.beginPath(); g.arc(58, 74, 27, 0, 7); g.fill();
  g.beginPath(); g.ellipse(50, 33, 8, 15, 0.7, 0, 7); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(95, 68, 20, 0, 7); g.fill();
  g.globalCompositeOperation = 'source-atop';
  const stripes = ['#61bb46', '#fdb827', '#f5821f', '#e03a3e', '#963d97', '#009ddc'];
  const y0 = 16, hh = (112 - y0) / 6;
  stripes.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(0, y0 + i * hh, 96, hh + 1);
  });
  x.drawImage(a, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 键帽字符标签
function makeKeyLabel(label, widthU) {
  const wide = label.length > 1;
  const c = document.createElement('canvas');
  c.width = wide ? 256 : 96;
  c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#453f33';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = wide
    ? '500 30px Helvetica, Arial, sans-serif'
    : '500 46px Helvetica, Arial, sans-serif';
  x.fillText(label, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const pw = wide ? Math.min(widthU * 0.019 - 0.006, 0.024) : 0.010;
  const ph = wide ? pw * 96 / 256 : 0.010;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(pw, ph),
    new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.5,
      polygonOffset: true, polygonOffsetFactor: -1,
    }));
  mesh.userData.noShadow = true;       // 透明贴片不参与阴影，避免方形假影
  return mesh;
}

// 桌面木纹
function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#8a6b4a';
  x.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * 1024;
    const h = 2 + Math.random() * 6;
    const tone = Math.random();
    x.fillStyle = tone > 0.5
      ? `rgba(52,34,18,${0.03 + Math.random() * 0.05})`
      : `rgba(240,210,170,${0.02 + Math.random() * 0.03})`;
    x.fillRect(0, y, 1024, h);
  }
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(40,26,14,${Math.random() * 0.05})`;
    x.fillRect(Math.random() * 1024, Math.random() * 1024, 1.6, 1.6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.1);
  tex.anisotropy = 8;
  return tex;
}

// ============================================================== 主循环

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  // CRT 微闪烁（刷新率明暗起伏）
  mac.userData.crtMat.emissiveIntensity =
    1.1 + Math.sin(t * 87) * 0.018 + Math.sin(t * 213) * 0.01;
  controls.update();
  renderer.render(scene, camera);
}
animate();

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
window.addEventListener('load', onResize);
requestAnimationFrame(onResize);   // 首帧兜底（无头/嵌入环境可能不触发 resize）
setTimeout(onResize, 300);
