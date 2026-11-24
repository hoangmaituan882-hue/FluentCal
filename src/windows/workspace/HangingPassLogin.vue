<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FIcon } from '@/fluent';

const props = withDefaults(
  defineProps<{
    initialUser?: string;
    displayName?: string;
    ownerTitle?: string;
    passNumber?: string;
    accentColor?: string;
    checking?: boolean;
    loggingIn?: boolean;
    error?: string;
    wsTheme?: 'light' | 'dark';
    previewMode?: boolean;
  }>(),
  {
    initialUser: 'fluentcal',
    displayName: '',
    ownerTitle: '个人多端加密工作台',
    passNumber: 'FC-01',
    accentColor: '#10A37F',
    checking: false,
    loggingIn: false,
    error: '',
    wsTheme: 'light',
    previewMode: false,
  },
);

const emit = defineEmits<{
  submit: [payload: { user: string; password: string }];
  toggleTheme: [];
  closePreview: [];
}>();

const user = ref(props.initialUser || 'fluentcal');
const password = ref('');
const showPass = ref(false);
const inputFocused = ref(false);
const granted = ref(false);
const deniedPulse = ref(false);
const dragging = ref(false);
const userInputRef = ref<HTMLInputElement | null>(null);
const passInputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.initialUser,
  (v) => {
    if (v && !user.value) user.value = v;
  },
);

// Trigger physical lateral kick + red LED pulse whenever login error updates
watch(
  () => props.error,
  (err) => {
    if (err) {
      deniedPulse.value = true;
      kickBadge(-24);
      setTimeout(() => {
        deniedPulse.value = false;
      }, 650);
    }
  },
);

const displayIdentity = computed(() => {
  const custom = props.displayName?.trim();
  const typed = user.value.trim();
  if (custom && (!typed || typed === props.initialUser)) return custom;
  return typed || custom || 'PERSONAL OWNER';
});

const avatarInitials = computed(() => {
  const clean = displayIdentity.value;
  if (!clean) return 'FC';
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
});

const statusMeta = computed(() => {
  if (granted.value) return { code: 'GRANTED', label: '身份核验通过', tone: 'ok' };
  if (props.checking) return { code: 'CHECKING', label: '检查会话…', tone: 'busy' };
  if (props.loggingIn) return { code: 'VERIFYING', label: '核验工牌…', tone: 'busy' };
  if (props.error || deniedPulse.value) return { code: 'DENIED', label: '凭证无效', tone: 'err' };
  if (dragging.value) return { code: 'FREE-SWING', label: '物理拖拽中', tone: 'live' };
  return { code: 'STANDBY', label: '等待刷卡', tone: 'idle' };
});

// ───────────────────────────────────────────────────────────────────────────
// 120 Hz Fixed-Timestep Verlet / PBD Lanyard Rope + Rigid-Body Badge Physics
// Inspired by xu-yaoting/hanging-pass (gravity, taut constraints, pendulum tilt,
// aerodynamic sheen, magnetic focus damping, and reduced-motion static fallback)
// ───────────────────────────────────────────────────────────────────────────
const stageRef = ref<HTMLElement | null>(null);
const reducedMotion = ref(false);

interface RopeNode {
  x: number;
  y: number;
  ox: number;
  oy: number;
}

const NODE_COUNT = 8;
const SEG_LEN = 18; // Total lanyard strap ~126px from top anchor to clasp
const STEP_DT = 1 / 120;

const stageW = ref(1280);
const stageH = ref(840);
const anchorX = computed(() => stageW.value / 2);
const anchorY = computed(() => (stageH.value < 680 ? 10 : 22));

const nodes: RopeNode[] = Array.from({ length: NODE_COUNT }, (_, i) => ({
  x: 640,
  y: 22 + i * SEG_LEN,
  ox: 640,
  oy: 22 + i * SEG_LEN,
}));

// Reactive render state updated cleanly at display refresh rate
const strapPath = ref('');
const claspPos = ref({ x: 640, y: 148, angle: 0 });
const cardPos = ref({ x: 640, y: 162, rotZ: 0, rotY: 0, rotX: 0, sheenX: 50, sheenY: 32 });
const shadowState = ref({ x: 640, scale: 1, opacity: 0.22 });

let cardAngle = 0;
let cardAngVel = 0;
let dragTargetX = 0;
let dragTargetY = 0;
let dragGrabOffsetX = 0;
let dragGrabOffsetY = 0;
let rafId = 0;
let lastFrameTs = 0;
let accum = 0;

function resetRopeAtRest(withDropSwing = false) {
  const ax = anchorX.value;
  const ay = anchorY.value;
  const seg = stageH.value < 680 ? 12 : SEG_LEN;
  for (let i = 0; i < NODE_COUNT; i++) {
    const swingOffset = withDropSwing && !reducedMotion.value ? (i / (NODE_COUNT - 1)) * 32 : 0;
    const x = ax + swingOffset;
    const y = ay + i * seg;
    nodes[i].x = x;
    nodes[i].y = y;
    nodes[i].ox = withDropSwing && !reducedMotion.value ? x - (i / (NODE_COUNT - 1)) * 1.1 : x;
    nodes[i].oy = y;
  }
  cardAngle = withDropSwing && !reducedMotion.value ? -6.5 : 0;
  cardAngVel = 0;
  syncRenderOutputs();
}

function kickBadge(vx: number) {
  if (reducedMotion.value) return;
  const tail = nodes[NODE_COUNT - 1];
  tail.ox = tail.x - vx * 0.45;
  cardAngVel += vx * 0.14;
}

function stepPhysics() {
  const ax = anchorX.value;
  const ay = anchorY.value;
  const seg = stageH.value < 680 ? 12 : SEG_LEN;
  const damp = inputFocused.value ? 0.94 : 0.978;
  const gravity = 2850; // px/s^2 for crisp snappy lanyard weight

  for (let i = 1; i < NODE_COUNT; i++) {
    const n = nodes[i];
    const vx = (n.x - n.ox) * damp;
    const vy = (n.y - n.oy) * damp;
    n.ox = n.x;
    n.oy = n.y;
    n.x += vx;
    n.y += vy + gravity * STEP_DT * STEP_DT;

    // Subtle magnetic centering while user is actively typing on the pass
    if (inputFocused.value && !dragging.value) {
      n.x += (ax - n.x) * 0.04;
    }
  }

  // Pin ceiling anchor
  nodes[0].x = ax;
  nodes[0].y = ay;
  nodes[0].ox = ax;
  nodes[0].oy = ay;

  // Apply pointer drag pull on tail node
  if (dragging.value) {
    const tail = nodes[NODE_COUNT - 1];
    const targetX = dragTargetX - dragGrabOffsetX;
    const targetY = dragTargetY - dragGrabOffsetY;
    // Softly clamp stretch radius so strap never rips off screen
    const maxReach = seg * (NODE_COUNT - 1) * 1.38;
    const dx = targetX - ax;
    const dy = targetY - ay;
    const dist = Math.hypot(dx, dy) || 1;
    const clampedDist = Math.min(dist, maxReach);
    const cx = ax + (dx / dist) * clampedDist;
    const cy = Math.max(ay + 36, ay + (dy / dist) * clampedDist);
    tail.x += (cx - tail.x) * 0.42;
    tail.y += (cy - tail.y) * 0.42;
  }

  // PBD Distance constraints (10 iterations for taut woven nylon feel)
  for (let iter = 0; iter < 10; iter++) {
    nodes[0].x = ax;
    nodes[0].y = ay;
    for (let i = 0; i < NODE_COUNT - 1; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const diff = (d - seg) / d;
      if (i === 0) {
        b.x -= dx * diff;
        b.y -= dy * diff;
      } else if (dragging.value && i + 1 === NODE_COUNT - 1) {
        a.x += dx * diff * 0.82;
        a.y += dy * diff * 0.82;
        b.x -= dx * diff * 0.18;
        b.y -= dy * diff * 0.18;
      } else {
        a.x += dx * diff * 0.5;
        a.y += dy * diff * 0.5;
        b.x -= dx * diff * 0.5;
        b.y -= dy * diff * 0.5;
      }
    }
  }

  // Rigid-body badge pendulum angle follows strap tail tangent + lateral acceleration
  const tail = nodes[NODE_COUNT - 1];
  const prev = nodes[NODE_COUNT - 2];
  const strapTanRad = Math.atan2(tail.x - prev.x, Math.max(4, tail.y - prev.y));
  const tailVx = (tail.x - tail.ox) / STEP_DT;
  const targetDeg = Math.max(-28, Math.min(28, -(strapTanRad * 180) / Math.PI * 0.72 + tailVx * 0.011));
  const springK = inputFocused.value ? 180 : 120;
  const angDamp = inputFocused.value ? 0.84 : 0.91;
  cardAngVel += (targetDeg - cardAngle) * springK * STEP_DT;
  cardAngVel *= angDamp;
  cardAngle += cardAngVel * STEP_DT;
}

function syncRenderOutputs() {
  // Smooth quadratic Bezier SVG path through Verlet rope nodes
  let d = `M ${nodes[0].x.toFixed(1)} ${nodes[0].y.toFixed(1)}`;
  for (let i = 1; i < NODE_COUNT - 1; i++) {
    const mx = ((nodes[i].x + nodes[i + 1].x) / 2).toFixed(1);
    const my = ((nodes[i].y + nodes[i + 1].y) / 2).toFixed(1);
    d += ` Q ${nodes[i].x.toFixed(1)} ${nodes[i].y.toFixed(1)} ${mx} ${my}`;
  }
  const tail = nodes[NODE_COUNT - 1];
  const prev = nodes[NODE_COUNT - 2];
  d += ` L ${tail.x.toFixed(1)} ${tail.y.toFixed(1)}`;
  strapPath.value = d;

  const claspAngleDeg = -((Math.atan2(tail.x - prev.x, Math.max(4, tail.y - prev.y)) * 180) / Math.PI);
  claspPos.value = {
    x: tail.x,
    y: tail.y,
    angle: claspAngleDeg,
  };

  const tailVx = (tail.x - tail.ox) / STEP_DT;
  const rotY = Math.max(-18, Math.min(18, tailVx * 0.022 + cardAngle * 0.35));
  const rotX = Math.max(-10, Math.min(10, (tail.y - (anchorY.value + SEG_LEN * (NODE_COUNT - 1))) * -0.06));
  const sheenX = Math.max(8, Math.min(92, 50 + rotY * 2.1));
  const sheenY = Math.max(12, Math.min(88, 30 + rotX * 2.5));

  cardPos.value = {
    x: tail.x,
    y: tail.y + 12,
    rotZ: cardAngle,
    rotY,
    rotX,
    sheenX,
    sheenY,
  };

  const restY = anchorY.value + (stageH.value < 680 ? 12 : SEG_LEN) * (NODE_COUNT - 1);
  const lift = Math.max(0, restY - tail.y);
  shadowState.value = {
    x: tail.x,
    scale: Math.max(0.72, 1 - lift * 0.0022),
    opacity: Math.max(0.08, 0.24 - lift * 0.001),
  };
}

function tick(ts: number) {
  if (!lastFrameTs) lastFrameTs = ts;
  const elapsed = Math.min(0.05, (ts - lastFrameTs) / 1000);
  lastFrameTs = ts;
  accum += elapsed;
  while (accum >= STEP_DT) {
    stepPhysics();
    accum -= STEP_DT;
  }
  syncRenderOutputs();
  rafId = requestAnimationFrame(tick);
}

function measureStage() {
  const el = stageRef.value;
  if (!el) return;
  const prevAx = anchorX.value;
  const prevAy = anchorY.value;
  const nextW = el.clientWidth || window.innerWidth;
  const nextH = el.clientHeight || window.innerHeight;
  stageW.value = nextW;
  stageH.value = nextH;
  if (reducedMotion.value) {
    resetRopeAtRest(false);
    return;
  }
  const dx = anchorX.value - prevAx;
  const dy = anchorY.value - prevAy;
  if (dx !== 0 || dy !== 0) {
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes[i].x += dx;
      nodes[i].ox += dx;
      nodes[i].y += dy;
      nodes[i].oy += dy;
    }
    syncRenderOutputs();
  }
}

function onBadgePointerDown(e: PointerEvent) {
  if (reducedMotion.value) return;
  const target = e.target as HTMLElement | null;
  // Never hijack typing or button presses inside the pass
  if (target?.closest('input, button, label, a')) return;
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) return;
  dragging.value = true;
  dragTargetX = e.clientX - rect.left;
  dragTargetY = e.clientY - rect.top;
  dragGrabOffsetX = dragTargetX - nodes[NODE_COUNT - 1].x;
  dragGrabOffsetY = dragTargetY - nodes[NODE_COUNT - 1].y;
  (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
}

function onBadgePointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  const rect = stageRef.value?.getBoundingClientRect();
  if (!rect) return;
  dragTargetX = e.clientX - rect.left;
  dragTargetY = e.clientY - rect.top;
}

function onBadgePointerUp() {
  dragging.value = false;
}

function onFieldKeyInput() {
  if (!reducedMotion.value && !dragging.value) {
    kickBadge((Math.random() - 0.5) * 2.2);
  }
}

function handleSubmit() {
  if (props.checking || props.loggingIn) return;
  const cleanUser = user.value.trim();
  if (!cleanUser) {
    userInputRef.value?.focus();
    kickBadge(-16);
    return;
  }
  if (!password.value) {
    passInputRef.value?.focus();
    kickBadge(16);
    return;
  }
  if (props.previewMode) {
    granted.value = true;
    kickBadge(14);
    setTimeout(() => {
      granted.value = false;
      emit('closePreview');
    }, 900);
    return;
  }
  emit('submit', { user: cleanUser, password: password.value });
}

onMounted(() => {
  reducedMotion.value = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  measureStage();
  resetRopeAtRest(true);
  if (!reducedMotion.value) {
    rafId = requestAnimationFrame(tick);
  }
  window.addEventListener('resize', measureStage);
});

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId);
  window.removeEventListener('resize', measureStage);
});
</script>

<template>
  <div
    ref="stageRef"
    class="hp-stage"
    :class="[wsTheme, { dragging, granted, denied: deniedPulse }]"
    :style="{ '--hp-accent': accentColor || '#10A37F' }"
    role="dialog"
    aria-modal="true"
    aria-label="FluentCal 个人工牌登录"
  >
    <!-- Studio Blueprint Ambient Grid & Corner Telemetry -->
    <div class="hp-grid-bg" aria-hidden="true" />
    <div class="hp-spotlight" aria-hidden="true" />

    <header class="hp-studio-bar">
      <div class="hp-corner-tag">
        <span class="hp-pulse-dot" />
        <span class="hp-mono">FLUENTCAL<span class="hp-corner-sub"> // PERSONAL SPACE</span></span>
      </div>

      <div class="hp-studio-acts">
        <button
          type="button"
          class="hp-ctrl-pill"
          :title="wsTheme === 'dark' ? '切换浅色展台' : '切换深曜石展台'"
          @click="emit('toggleTheme')"
        >
          <FIcon :name="wsTheme === 'dark' ? 'sun' : 'moon'" :size="12" />
          <span>{{ wsTheme === 'dark' ? '浅色' : '暗色' }}</span>
        </button>

        <button
          v-if="previewMode"
          type="button"
          class="hp-ctrl-pill primary"
          @click="emit('closePreview')"
        >
          <FIcon name="close" :size="11" />
          <span>退出工牌预览</span>
        </button>
      </div>
    </header>

    <!-- Top Ceiling Lanyard Anchor Bar -->
    <div
      class="hp-anchor-mount"
      :style="{ left: `${anchorX}px`, top: `${anchorY}px` }"
      aria-hidden="true"
    >
      <span class="hp-anchor-bar" />
      <span class="hp-anchor-rivet" />
    </div>

    <!-- Real-Time Verlet Woven Lanyard Ribbon + Metallic Swivel Clasp SVG Layer -->
    <svg class="hp-rope-svg" :viewBox="`0 0 ${stageW} ${stageH}`" aria-hidden="true">
      <defs>
        <linearGradient id="hpStrapGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#14161a" />
          <stop offset="35%" stop-color="#2c313a" />
          <stop offset="50%" stop-color="#1b1e24" />
          <stop offset="85%" stop-color="#2a2f38" />
          <stop offset="100%" stop-color="#111317" />
        </linearGradient>
        <linearGradient id="hpStrapAccent" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#10A37F" stop-opacity="0.88" />
          <stop offset="100%" stop-color="#0EA5E9" stop-opacity="0.72" />
        </linearGradient>
        <linearGradient id="hpMetalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#e5e7eb" />
          <stop offset="45%" stop-color="#9ca3af" />
          <stop offset="100%" stop-color="#4b5563" />
        </linearGradient>
      </defs>

      <!-- Soft Lanyard Drop Shadow -->
      <path :d="strapPath" class="hp-strap-shadow" />
      <!-- Woven Flat Nylon Lanyard Body -->
      <path :d="strapPath" stroke="url(#hpStrapGrad)" class="hp-strap-body" />
      <!-- Center Woven Stitch Accent Line -->
      <path :d="strapPath" stroke="url(#hpStrapAccent)" class="hp-strap-stitch" />

      <!-- Brushed Titanium Swivel Clasp & O-Ring Attached to Rope Tail -->
      <g :transform="`translate(${claspPos.x.toFixed(1)}, ${claspPos.y.toFixed(1)}) rotate(${claspPos.angle.toFixed(2)})`">
        <!-- Crimped Strap Ferrule -->
        <rect x="-12" y="-12" width="24" height="10" rx="3" fill="url(#hpMetalGrad)" stroke="#1f2937" stroke-width="0.9" />
        <!-- Swivel Ring -->
        <circle cx="0" cy="4" r="6.5" fill="none" stroke="url(#hpMetalGrad)" stroke-width="3.2" />
        <!-- Lobster Clip Tongue entering Badge Slot -->
        <rect x="-4.5" y="7" width="9" height="18" rx="4.5" fill="url(#hpMetalGrad)" stroke="#374151" stroke-width="0.9" />
        <circle cx="0" cy="14" r="1.8" fill="#1f2937" />
      </g>
    </svg>

    <!-- Dynamic Floating Floor Shadow beneath the Hanging Pass -->
    <div
      class="hp-floor-shadow"
      :style="{
        left: `${shadowState.x}px`,
        transform: `translateX(-50%) scaleX(${shadowState.scale.toFixed(3)})`,
        opacity: shadowState.opacity.toFixed(3),
      }"
      aria-hidden="true"
    />

    <!-- THE PHYSICAL HANGING ID PASS (All Login Inputs & Confirm Controls Directly ON the Badge!) -->
    <div
      class="hp-pass-rig"
      :style="{
        left: `${cardPos.x.toFixed(1)}px`,
        top: `${cardPos.y.toFixed(1)}px`,
        transform: `translate(-50%, 0) perspective(1100px) rotateZ(${cardPos.rotZ.toFixed(2)}deg) rotateY(${cardPos.rotY.toFixed(2)}deg) rotateX(${cardPos.rotX.toFixed(2)}deg)`,
      }"
      @pointerdown="onBadgePointerDown"
      @pointermove="onBadgePointerMove"
      @pointerup="onBadgePointerUp"
      @pointercancel="onBadgePointerUp"
    >
      <form
        class="hp-card"
        :style="{
          '--sheen-x': `${cardPos.sheenX.toFixed(1)}%`,
          '--sheen-y': `${cardPos.sheenY.toFixed(1)}%`,
        }"
        @submit.prevent="handleSubmit"
      >
        <!-- Holographic Dynamic Specular Foil Sheen -->
        <div class="hp-card-sheen" aria-hidden="true" />
        <div class="hp-card-grain" aria-hidden="true" />

        <!-- Punched Oval Lanyard Slot at Top Center -->
        <div class="hp-slot-area" aria-hidden="true">
          <span class="hp-slot-punch" />
          <span class="hp-reg-mark left">+</span>
          <span class="hp-reg-mark right">+</span>
        </div>

        <!-- Top Registration Band: Brand + Pass Series + Live LED Status -->
        <div class="hp-top-band">
          <div class="hp-brand-col">
            <span class="hp-wordmark">FLUENTCAL</span>
            <span class="hp-pass-sub hp-mono">PERSONAL ACCESS PASS</span>
          </div>
          <div class="hp-meta-col">
            <span class="hp-led-pill" :class="statusMeta.tone">
              <span class="hp-led-dot" />
              <span class="hp-mono">{{ statusMeta.code }}</span>
            </span>
            <span class="hp-serial hp-mono">NO. {{ passNumber || 'FC-01' }}</span>
          </div>
        </div>

        <div class="hp-hairline" />

        <!-- Dynamic Owner Identity Block (Updates Live As You Type Account ID) -->
        <div class="hp-identity">
          <div class="hp-avatar-ring">
            <span class="hp-avatar-text">{{ avatarInitials }}</span>
            <span class="hp-nfc-arc" aria-hidden="true" />
          </div>
          <div class="hp-id-copy">
            <div class="hp-id-name">{{ displayIdentity }}</div>
            <div class="hp-id-role">
              <span class="hp-clearance-tag">OWNER</span>
              <span>{{ ownerTitle || '个人多端加密工作台' }}</span>
            </div>
          </div>
        </div>

        <!-- Embedded On-Pass Credential Wells & Confirm Button -->
        <div v-if="checking" class="hp-checking-box">
          <span class="hp-spinner" aria-hidden="true" />
          <span>正在自动校验云端工牌会话…</span>
        </div>

        <div v-else class="hp-form-zone">
          <label class="hp-field">
            <span class="hp-field-head">
              <span class="hp-mono">ACCOUNT ID</span>
              <span>个人账号</span>
            </span>
            <div class="hp-input-well">
              <svg class="hp-field-ico" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="8" cy="5.2" r="2.7" />
                <path d="M3 13.4c.5-2.6 2.3-4.1 5-4.1s4.5 1.5 5 4.1" />
              </svg>
              <input
                ref="userInputRef"
                v-model="user"
                type="text"
                class="hp-input"
                autocomplete="username"
                autocapitalize="off"
                spellcheck="false"
                placeholder="输入个人账号"
                @focus="inputFocused = true"
                @blur="inputFocused = false"
                @input="onFieldKeyInput"
              />
            </div>
          </label>

          <label class="hp-field">
            <span class="hp-field-head">
              <span class="hp-mono">PASSKEY</span>
              <span>访问密码</span>
            </span>
            <div class="hp-input-well">
              <FIcon name="lock" :size="13" class="hp-field-ico" />
              <input
                ref="passInputRef"
                v-model="password"
                :type="showPass ? 'text' : 'password'"
                class="hp-input"
                autocomplete="current-password"
                placeholder="输入访问密码"
                @focus="inputFocused = true"
                @blur="inputFocused = false"
                @input="onFieldKeyInput"
              />
              <button
                type="button"
                class="hp-eye-btn"
                :title="showPass ? '隐藏密码' : '显示密码'"
                :aria-label="showPass ? '隐藏密码' : '显示密码'"
                @click="showPass = !showPass"
              >
                <FIcon :name="showPass ? 'eyeOff' : 'eye'" :size="13" />
              </button>
            </div>
          </label>

          <Transition name="hp-err">
            <div v-if="error" class="hp-error-strip" role="alert">
              <FIcon name="warning" :size="12" />
              <span>{{ error }}</span>
            </div>
          </Transition>

          <!-- Primary Tactile Unlock Trigger Directly ON the Pass -->
          <button
            type="submit"
            class="hp-unlock-btn"
            :class="{ granted }"
            :disabled="loggingIn || granted"
          >
            <span class="hp-unlock-copy">
              <FIcon v-if="granted" name="checkMark" :size="14" />
              <span v-else-if="loggingIn" class="hp-btn-spin" aria-hidden="true" />
              <FIcon v-else name="key" :size="14" />
              <span>
                {{ granted ? '身份已核验 · 正在进入' : loggingIn ? '正在验证工牌凭证…' : previewMode ? '刷卡验证体验' : '刷卡进入工作台' }}
              </span>
            </span>
            <kbd v-if="!loggingIn && !granted" class="hp-enter-kbd">↵</kbd>
          </button>
        </div>

        <!-- Bottom Architectural Barcode & Encrypted Telemetry Strip -->
        <footer class="hp-pass-foot" aria-hidden="true">
          <svg class="hp-barcode" viewBox="0 0 180 20" preserveAspectRatio="none">
            <rect x="0" y="0" width="3" height="20" />
            <rect x="5" y="0" width="1.5" height="20" />
            <rect x="9" y="0" width="4" height="20" />
            <rect x="16" y="0" width="2" height="20" />
            <rect x="21" y="0" width="1.5" height="20" />
            <rect x="25" y="0" width="5" height="20" />
            <rect x="33" y="0" width="2" height="20" />
            <rect x="38" y="0" width="3" height="20" />
            <rect x="44" y="0" width="1.5" height="20" />
            <rect x="48" y="0" width="4" height="20" />
            <rect x="55" y="0" width="2" height="20" />
            <rect x="61" y="0" width="3.5" height="20" />
            <rect x="67" y="0" width="1.5" height="20" />
            <rect x="72" y="0" width="5" height="20" />
            <rect x="80" y="0" width="2" height="20" />
            <rect x="85" y="0" width="1.5" height="20" />
            <rect x="90" y="0" width="4" height="20" />
            <rect x="97" y="0" width="2.5" height="20" />
            <rect x="103" y="0" width="1.5" height="20" />
            <rect x="108" y="0" width="4.5" height="20" />
            <rect x="116" y="0" width="2" height="20" />
            <rect x="121" y="0" width="3" height="20" />
            <rect x="127" y="0" width="1.5" height="20" />
            <rect x="132" y="0" width="5" height="20" />
            <rect x="140" y="0" width="2" height="20" />
            <rect x="145" y="0" width="3.5" height="20" />
            <rect x="152" y="0" width="1.5" height="20" />
            <rect x="157" y="0" width="4" height="20" />
            <rect x="164" y="0" width="2" height="20" />
            <rect x="169" y="0" width="4" height="20" />
            <rect x="176" y="0" width="3" height="20" />
          </svg>
          <div class="hp-foot-meta hp-mono">
            <span>PERSONAL CLOUD SYNC</span>
            <span>HTTPONLY · TLS</span>
          </div>
        </footer>
      </form>
    </div>

    <!-- Subtle Bottom Interaction Affordance Whisper -->
    <div class="hp-whisper">
      <span>可拖拽工牌物理晃动 · 输入个人账号密码后按 Enter 解锁多端同步</span>
    </div>
  </div>
</template>

<style scoped>
.hp-stage {
  --hp-bg: #efeee9;
  --hp-grid: rgba(28, 25, 23, 0.055);
  --hp-card-bg: #fcfbf8;
  --hp-card-bg-2: #f2f0e9;
  --hp-card-border: rgba(28, 25, 23, 0.13);
  --hp-ink: #161618;
  --hp-ink-2: #5b5954;
  --hp-ink-muted: #8b877e;
  --hp-well-bg: rgba(28, 25, 23, 0.045);
  --hp-well-border: rgba(28, 25, 23, 0.1);
  --hp-accent: #10a37f;
  --hp-accent-2: #0ea5e9;

  position: fixed;
  inset: 0;
  z-index: 110;
  overflow: hidden;
  background: var(--hp-bg);
  color: var(--hp-ink);
  user-select: none;
  touch-action: none;
}

.hp-stage.dark {
  --hp-bg: #0b0c10;
  --hp-grid: rgba(255, 255, 255, 0.045);
  --hp-card-bg: #17191f;
  --hp-card-bg-2: #111318;
  --hp-card-border: rgba(255, 255, 255, 0.13);
  --hp-ink: #f4f3ef;
  --hp-ink-2: #a5a39c;
  --hp-ink-muted: #6f6d68;
  --hp-well-bg: rgba(255, 255, 255, 0.055);
  --hp-well-border: rgba(255, 255, 255, 0.11);
}

.hp-mono {
  font-family: ui-monospace, 'Cascadia Mono', 'SFMono-Regular', Consolas, monospace;
  letter-spacing: 0.08em;
}

.hp-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--hp-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--hp-grid) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(circle at 50% 44%, rgba(0, 0, 0, 0.9) 18%, transparent 78%);
  pointer-events: none;
}

.hp-spotlight {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 520px 420px at 50% 42%,
    color-mix(in srgb, var(--hp-accent) 11%, transparent) 0%,
    transparent 70%
  );
  pointer-events: none;
}

.hp-studio-bar {
  position: absolute;
  top: max(14px, env(safe-area-inset-top));
  left: max(18px, env(safe-area-inset-left));
  right: max(18px, env(safe-area-inset-right));
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
}

.hp-corner-tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--hp-ink-2);
}

.hp-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--hp-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hp-accent) 22%, transparent);
}

.hp-studio-acts {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  pointer-events: auto;
}

.hp-ctrl-pill {
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--hp-card-border);
  background: color-mix(in srgb, var(--hp-card-bg) 86%, transparent);
  backdrop-filter: blur(12px);
  color: var(--hp-ink-2);
  font: inherit;
  font-size: 11.5px;
  font-weight: 660;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1), color 150ms ease, border-color 150ms ease;
}

.hp-ctrl-pill:hover {
  color: var(--hp-ink);
  border-color: color-mix(in srgb, var(--hp-ink) 28%, transparent);
}

.hp-ctrl-pill.primary {
  background: var(--hp-ink);
  color: var(--hp-card-bg);
  border-color: transparent;
}

/* Ceiling Anchor Mount */
.hp-anchor-mount {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.hp-anchor-bar {
  width: 64px;
  height: 7px;
  border-radius: 999px;
  background: linear-gradient(180deg, #4b5563 0%, #1f2937 100%);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.28);
}

.hp-anchor-rivet {
  margin-top: -4px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, #e5e7eb 0%, #6b7280 72%, #1f2937 100%);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
}

/* Verlet Lanyard Ribbon SVG Layer */
.hp-rope-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 8;
  pointer-events: none;
  overflow: visible;
}

.hp-strap-shadow {
  fill: none;
  stroke: rgba(0, 0, 0, 0.16);
  stroke-width: 24px;
  stroke-linecap: butt;
  transform: translate(4px, 7px);
  filter: blur(4px);
}

.hp-strap-body {
  fill: none;
  stroke-width: 22px;
  stroke-linecap: butt;
}

.hp-strap-stitch {
  fill: none;
  stroke-width: 2.2px;
  stroke-dasharray: 5 5;
  stroke-linecap: round;
}

/* Floating Cast Floor Shadow */
.hp-floor-shadow {
  position: absolute;
  bottom: max(54px, 8vh);
  width: 270px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.42) 0%, transparent 72%);
  filter: blur(8px);
  pointer-events: none;
  z-index: 5;
}

/* Physical Hanging Pass Rig */
.hp-pass-rig {
  position: absolute;
  z-index: 12;
  transform-origin: 50% 10px;
  cursor: grab;
  will-change: transform, left, top;
  transition: opacity 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.hp-stage.dragging .hp-pass-rig {
  cursor: grabbing;
}

.hp-stage.granted .hp-pass-rig {
  transform: translate(-50%, -36px) scale(0.96) !important;
  opacity: 0;
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 360ms ease;
}

.hp-card {
  position: relative;
  width: min(346px, calc(100vw - 28px));
  padding: 14px 20px 16px;
  border-radius: 24px;
  border: 1px solid var(--hp-card-border);
  background: linear-gradient(162deg, var(--hp-card-bg) 0%, var(--hp-card-bg-2) 100%);
  box-shadow:
    0 28px 60px rgba(10, 12, 18, 0.18),
    0 8px 20px rgba(10, 12, 18, 0.09),
    inset 0 1px 0 rgba(255, 255, 255, 0.65);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.hp-stage.dark .hp-card {
  box-shadow:
    0 32px 68px rgba(0, 0, 0, 0.56),
    0 8px 24px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.hp-stage.denied .hp-card {
  border-color: rgba(239, 68, 68, 0.65);
  box-shadow:
    0 24px 52px rgba(239, 68, 68, 0.2),
    0 0 0 2px rgba(239, 68, 68, 0.28);
}

/* Holographic Tilted Specular Sheen */
.hp-card-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    360px circle at var(--sheen-x, 50%) var(--sheen-y, 30%),
    rgba(255, 255, 255, 0.36) 0%,
    color-mix(in srgb, var(--hp-accent) 9%, transparent) 38%,
    transparent 70%
  );
  mix-blend-mode: overlay;
}

.hp-stage.dark .hp-card-sheen {
  background: radial-gradient(
    360px circle at var(--sheen-x, 50%) var(--sheen-y, 30%),
    rgba(255, 255, 255, 0.16) 0%,
    color-mix(in srgb, var(--hp-accent) 16%, transparent) 40%,
    transparent 72%
  );
}

.hp-card-grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.03;
  background-image: repeating-linear-gradient(
    135deg,
    currentColor 0,
    currentColor 1px,
    transparent 1px,
    transparent 4px
  );
}

/* Top Punched Lanyard Slot */
.hp-slot-area {
  position: relative;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hp-slot-punch {
  width: 56px;
  height: 12px;
  border-radius: 999px;
  background: var(--hp-bg);
  border: 1px solid var(--hp-card-border);
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.22);
}

.hp-reg-mark {
  position: absolute;
  top: 0;
  font-size: 11px;
  font-weight: 400;
  color: var(--hp-ink-muted);
  opacity: 0.55;
  font-family: ui-monospace, monospace;
}

.hp-reg-mark.left {
  left: 0;
}

.hp-reg-mark.right {
  right: 0;
}

/* Registration Header Band */
.hp-top-band {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.hp-brand-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hp-wordmark {
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 900;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--hp-ink);
}

.hp-pass-sub {
  font-size: 9px;
  font-weight: 700;
  color: var(--hp-ink-muted);
}

.hp-meta-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.hp-led-pill {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--hp-well-bg);
  border: 1px solid var(--hp-well-border);
  font-size: 9px;
  font-weight: 760;
  color: var(--hp-ink-2);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.hp-led-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--hp-accent);
}

.hp-led-pill.busy .hp-led-dot {
  background: #f59e0b;
  animation: hp-blink 0.8s ease-in-out infinite;
}

.hp-led-pill.err {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.38);
  background: rgba(239, 68, 68, 0.1);
}

.hp-led-pill.err .hp-led-dot {
  background: #ef4444;
}

.hp-led-pill.ok {
  color: #10a37f;
  border-color: rgba(16, 163, 127, 0.42);
  background: rgba(16, 163, 127, 0.14);
}

.hp-serial {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--hp-ink-muted);
}

.hp-hairline {
  height: 1px;
  background: var(--hp-card-border);
}

/* Identity Display Block */
.hp-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hp-avatar-ring {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--hp-accent) 0%, #0a7a60 100%);
  color: #ffffff;
  display: inline-grid;
  place-items: center;
  flex: none;
  box-shadow: 0 8px 18px color-mix(in srgb, var(--hp-accent) 32%, transparent);
}

.hp-avatar-text {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 880;
  letter-spacing: -0.02em;
}

.hp-nfc-arc {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--hp-card-bg);
  border: 2px solid var(--hp-accent);
}

.hp-id-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hp-id-name {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 840;
  letter-spacing: -0.025em;
  line-height: 1.1;
  color: var(--hp-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hp-id-role {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--hp-ink-2);
}

.hp-clearance-tag {
  padding: 1px 6px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--hp-accent) 14%, transparent);
  color: var(--hp-accent);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

/* On-Pass Credential Inputs & Confirm Zone */
.hp-checking-box {
  padding: 26px 12px;
  border-radius: 14px;
  background: var(--hp-well-bg);
  border: 1px dashed var(--hp-well-border);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12.5px;
  color: var(--hp-ink-2);
}

.hp-form-zone {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hp-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.hp-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  color: var(--hp-ink-muted);
  padding: 0 2px;
}

.hp-input-well {
  height: 40px;
  padding: 0 10px 0 11px;
  border-radius: 12px;
  border: 1px solid var(--hp-well-border);
  background: var(--hp-well-bg);
  display: flex;
  align-items: center;
  gap: 8px;
  transition:
    border-color 150ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 150ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 150ms cubic-bezier(0.22, 1, 0.36, 1);
}

.hp-input-well:focus-within {
  border-color: var(--hp-accent);
  background: var(--hp-card-bg);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--hp-accent) 18%, transparent);
}

.hp-field-ico {
  color: var(--hp-ink-muted);
  flex: none;
}

.hp-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--hp-ink);
  font: inherit;
  font-size: 13.5px;
  font-weight: 640;
  outline: none;
  user-select: text;
}

.hp-input::placeholder {
  color: var(--hp-ink-muted);
  font-weight: 500;
}

.hp-eye-btn {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--hp-ink-muted);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
}

.hp-eye-btn:hover {
  color: var(--hp-ink);
  background: var(--hp-well-bg);
}

.hp-error-strip {
  padding: 7px 10px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.11);
  border: 1px solid rgba(239, 68, 68, 0.28);
  color: #dc2626;
  font-size: 11.5px;
  font-weight: 660;
  display: flex;
  align-items: center;
  gap: 6px;
}

.hp-stage.dark .hp-error-strip {
  color: #f87171;
}

.hp-err-enter-active,
.hp-err-leave-active {
  transition: opacity 160ms ease, transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}
.hp-err-enter-from,
.hp-err-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Embedded Mechanical Unlock Trigger */
.hp-unlock-btn {
  margin-top: 2px;
  height: 43px;
  padding: 0 14px;
  border: 0;
  border-radius: 13px;
  background: var(--hp-ink);
  color: var(--hp-card-bg);
  font: inherit;
  font-size: 13.5px;
  font-weight: 760;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(15, 16, 20, 0.16);
  transition:
    transform 150ms cubic-bezier(0.22, 1, 0.36, 1),
    background-color 200ms ease,
    box-shadow 180ms ease;
}

.hp-unlock-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 24px rgba(15, 16, 20, 0.22);
}

.hp-unlock-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.hp-unlock-btn.granted {
  background: var(--hp-accent);
  color: #ffffff;
}

.hp-unlock-btn:disabled {
  opacity: 0.85;
  cursor: default;
}

.hp-unlock-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.hp-enter-kbd {
  padding: 2px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, currentColor 14%, transparent);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
}

/* Barcode & Industrial Security Strip */
.hp-pass-foot {
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px dashed var(--hp-card-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hp-barcode {
  width: 100%;
  height: 18px;
  fill: var(--hp-ink);
  opacity: 0.72;
}

.hp-foot-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 8.5px;
  font-weight: 700;
  color: var(--hp-ink-muted);
}

.hp-whisper {
  position: absolute;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 10;
  padding: 5px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--hp-card-bg) 70%, transparent);
  border: 1px solid var(--hp-card-border);
  backdrop-filter: blur(10px);
  font-size: 11px;
  font-weight: 560;
  color: var(--hp-ink-2);
  white-space: nowrap;
  max-width: calc(100vw - 24px);
  overflow: hidden;
  text-overflow: ellipsis;
}

.hp-spinner,
.hp-btn-spin {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
  animation: hp-spin 0.75s linear infinite;
}

@keyframes hp-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes hp-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 639px) {
  .hp-corner-sub {
    display: none;
  }

  .hp-card {
    padding: 12px 16px 14px;
    gap: 11px;
    border-radius: 22px;
  }

  .hp-wordmark {
    font-size: 17px;
  }

  .hp-id-name {
    font-size: 16.5px;
  }

  .hp-whisper {
    font-size: 10.5px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hp-pass-rig,
  .hp-unlock-btn,
  .hp-ctrl-pill,
  .hp-led-dot {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
