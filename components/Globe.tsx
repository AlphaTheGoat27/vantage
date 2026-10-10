"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type * as CesiumNS from "cesium";
import type { Ship } from "@/lib/ais";
import type { Chokepoint, Hazard, PlanResponse, PlannedRoute } from "@/lib/types";
import type { LonLat } from "@/lib/geo";
import { HAZARD_COLORS, ROUTE_ROLE, SHIP_COLORS, SYS, riskColor, routeColor } from "./colors";

type CesiumModule = typeof CesiumNS;
declare global {
  interface Window {
    Cesium?: CesiumModule;
    CESIUM_BASE_URL?: string;
  }
}

const CESIUM_VERSION = "1.146.0";
const BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;

let loader: Promise<CesiumModule> | null = null;
function loadCesium(): Promise<CesiumModule> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    window.CESIUM_BASE_URL = BASE;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${BASE}Widgets/widgets.css`;
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = `${BASE}Cesium.js`;
    s.async = true;
    s.onload = () => (window.Cesium ? resolve(window.Cesium) : reject(new Error("Cesium failed to load")));
    s.onerror = () => {
      loader = null;
      reject(new Error("Cesium failed to load"));
    };
    document.head.appendChild(s);
  });
  return loader;
}

export type BaseMap = "dark" | "osm" | "satellite";

type Props = {
  hazards: Hazard[];
  chokepoints: Chokepoint[];
  ships?: Ship[];
  plan: PlanResponse | null;
  activeRouteId: PlannedRoute["id"] | null;
  selectedHazardId: string | null;
  baseMap: BaseMap;
  pickMode: boolean;
  onPick: (p: LonLat) => void;
  onSelectHazard: (id: string | null) => void;
  /** Slow idle spin of the earth after ~12 s without input (default true). */
  autoRotate?: boolean;
  selectedShipMmsi?: number | null;
  onSelectShip?: (mmsi: number | null) => void;
  /** Clicking a route line selects it (picking prefers ships, then routes, then hazards). */
  onSelectRoute?: (id: PlannedRoute["id"]) => void;
  /**
   * Css px covered by the sidebar (left) and the bottom sheet's peek (bottom). The earth, every flight target and
   * the label layout centre on the uncovered area.
   */
  insets?: { left: number; bottom: number };
  /** @deprecated use `insets={{ left, bottom: 0 }}` */
  leftInset?: number;
};

const insetsOf = (p: Props) => p.insets ?? { left: p.leftInset ?? 0, bottom: 0 };

// ---------------------------------------------------------------- idle rotation
const IDLE_MS = 12_000;
/** full speed: one revolution every 4 minutes */
const SPIN = (2 * Math.PI) / 240;
/** critically damped ramp-up: natural frequency in rad/s (about 2.4 s to 95% of full speed) */
const SPIN_W0 = 2;
const INPUT_EVENTS = ["pointerdown", "pointermove", "wheel", "touchstart", "keydown"] as const;

// ---------------------------------------------------------------- drawing helpers
const FONT_FALLBACK = `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", sans-serif`;
const LABEL_BG = "rgba(28,28,30,0.78)";
const INK = SYS.ink;
const INK_2 = "rgba(235,235,245,0.64)";
const INK_3 = "rgba(235,235,245,0.5)";
const SHIP_HEIGHT = 1000;
/** dead-reckoning cap */
const MAX_EXTRAPOLATE_H = 0.5;

/** The page's own font stack (resolves next/font's Inter name), else the system stack. */
function fontFamily(): string {
  try {
    const f = getComputedStyle(document.body).fontFamily;
    if (f) return f;
  } catch {
    /* no DOM */
  }
  return FONT_FALLBACK;
}

/** Canvas images are drawn at least 2x so they stay crisp on retina screens. */
const drawScale = (px: number) => Math.max(2, Math.ceil(px));

type Img = { url: string; w: number; h: number };
const imgCache = new Map<string, Img>();

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

type PillPart = { text: string; color: string; weight?: number };
/**
 * A rounded label pill (soft dark material, no outline on the glyphs), returned as a data URL so that Cesium's
 * texture atlas caches it by content instead of adding a new copy on every rebuild.
 */
function pill(parts: PillPart[], opts: { size: number; dot?: string; selected?: boolean }, px: number, family: string): Img {
  const key = `pill|${px}|${family}|${opts.size}|${opts.dot ?? ""}|${opts.selected ? 1 : 0}|${parts.map((p) => `${p.text}~${p.color}~${p.weight ?? 0}`).join("|")}`;
  const hit = imgCache.get(key);
  if (hit) return hit;
  const R = drawScale(px);
  const padX = 7, gap = 5, dotD = opts.dot ? 6 : 0, h = Math.round(opts.size + 8);
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = (w: number) => `${w} ${opts.size * R}px ${family}`;
  const widths = parts.map((p) => {
    g.font = font(p.weight ?? 600);
    return g.measureText(p.text).width / R;
  });
  const textW = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1);
  const w = Math.ceil(padX * 2 + textW + (dotD ? dotD + gap : 0));
  c.width = w * R;
  c.height = h * R;
  g.scale(R, R);
  roundRect(g, 0.5, 0.5, w - 1, h - 1, 6);
  g.fillStyle = LABEL_BG;
  g.fill();
  g.lineWidth = opts.selected ? 1 : 0.5;
  g.strokeStyle = opts.selected ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.1)";
  g.stroke();
  let x = padX;
  if (opts.dot) {
    g.beginPath();
    g.arc(x + dotD / 2, h / 2, dotD / 2, 0, Math.PI * 2);
    g.fillStyle = opts.dot;
    g.fill();
    x += dotD + gap;
  }
  g.textBaseline = "middle";
  g.setTransform(1, 0, 0, 1, 0, 0);
  parts.forEach((p, i) => {
    g.font = font(p.weight ?? 600);
    g.fillStyle = p.color;
    g.fillText(p.text, x * R, (h / 2 + 0.5) * R);
    x += widths[i] + gap;
  });
  const img = { url: c.toDataURL(), w, h };
  imgCache.set(key, img);
  return img;
}

/** Route endpoint marker: white ring around a coloured centre, with a soft shadow. */
function pinImage(fill: string, px: number): Img {
  const key = `pin|${px}|${fill}`;
  const hit = imgCache.get(key);
  if (hit) return hit;
  const R = drawScale(px), s = 18;
  const c = document.createElement("canvas");
  c.width = c.height = s * R;
  const g = c.getContext("2d")!;
  g.scale(R, R);
  g.beginPath();
  g.arc(s / 2, s / 2, 8.5, 0, Math.PI * 2);
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.fill();
  g.beginPath();
  g.arc(s / 2, s / 2, 7, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.fill();
  g.beginPath();
  g.arc(s / 2, s / 2, 4.5, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  const img = { url: c.toDataURL(), w: s, h: s };
  imgCache.set(key, img);
  return img;
}

/** Ship sprites (white, tinted per billboard), drawn at 2x. Css sizes in pixels. */
const ARROW_CSS = 14, DOT_CSS = 6, SELECTED_CSS = 26;
function arrowPath(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  // a slim chevron-arrow pointing up, s = overall height
  g.beginPath();
  g.moveTo(cx, cy - s / 2);
  g.lineTo(cx + s * 0.32, cy + s / 2);
  g.lineTo(cx, cy + s * 0.28);
  g.lineTo(cx - s * 0.32, cy + s / 2);
  g.closePath();
}
function shipArrowCanvas(): HTMLCanvasElement {
  const R = 2, s = ARROW_CSS;
  const c = document.createElement("canvas");
  c.width = c.height = s * R;
  const g = c.getContext("2d")!;
  g.scale(R, R);
  arrowPath(g, s / 2, s / 2, s - 2);
  g.lineJoin = "round";
  g.lineWidth = 1.5;
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.stroke();
  g.fillStyle = "#fff";
  g.fill();
  return c;
}
function shipDotCanvas(): HTMLCanvasElement {
  const R = 2, s = DOT_CSS;
  const c = document.createElement("canvas");
  c.width = c.height = s * R;
  const g = c.getContext("2d")!;
  g.scale(R, R);
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 0.75, 0, Math.PI * 2);
  g.fillStyle = "#fff";
  g.fill();
  g.lineWidth = 0.75;
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.stroke();
  return c;
}
function shipSelectedCanvas(color: string, moving: boolean): HTMLCanvasElement {
  const R = 2, s = SELECTED_CSS;
  const c = document.createElement("canvas");
  c.width = c.height = s * R;
  const g = c.getContext("2d")!;
  g.scale(R, R);
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 1.5, 0, Math.PI * 2);
  g.fillStyle = "rgba(28,28,30,0.72)";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "#fff";
  g.stroke();
  if (moving) {
    arrowPath(g, s / 2, s / 2, 13);
    g.fillStyle = color;
    g.fill();
  } else {
    g.beginPath();
    g.arc(s / 2, s / 2, 4, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  }
  return c;
}

/** Points of a geodesic circle (lon, lat, height flattened) for the selected-hazard ring. */
function circlePositions(center: LonLat, radiusKm: number, n = 120): number[] {
  const r = Math.PI / 180, d = radiusKm / 6371, φ1 = center[1] * r, λ1 = center[0] * r;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const θ = (2 * Math.PI * i) / n;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    out.push(λ2 / r, φ2 / r, 600);
  }
  return out;
}

/**
 * A short zone name for a map label: the title before the first ":" or " (", kept within ~28 characters at a word
 * (preferably a phrase) boundary, never cut mid-word and never ellipsised.
 */
const NAME_MAX = 28;
function shortName(title: string): string {
  const cuts = [title.indexOf(":"), title.indexOf(" (")].filter((i) => i > 0);
  const s = (cuts.length ? title.slice(0, Math.min(...cuts)) : title).replace(/\s+/g, " ").trim();
  if (s.length <= NAME_MAX) return s;
  const words = s.split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > NAME_MAX) break;
    out = next;
  }
  if (!out) return words[0];
  // words were dropped: prefer ending at a phrase boundary ("Southern Red Sea & Bab" -> "Southern Red Sea")
  const phrase = Math.max(...[" & ", ", ", " and ", " / ", " - ", " – ", " — "].map((d) => out.lastIndexOf(d)));
  if (phrase > 0) out = out.slice(0, phrase);
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(/\s+(?:&|and|of|the|in|at|off|on|near|to|from)$/i, "").replace(/[\s,;/&–—-]+$/, "");
  }
  return out || words[0];
}

// ---------------------------------------------------------------- label layout (Apple Maps style de-clutter)
/**
 * A label pill placed each frame: hidden behind the horizon, outside the uncovered area or over a label already
 * placed. `off` is the live pixel offset (the pill is centred on its anchor plus `off`).
 */
type LabelSpec = {
  kind: "selected" | "pin" | "hazard" | "chokepoint";
  hazardId?: string;
  /** order within the kind, higher first */
  rank: number;
  pos: CesiumNS.Cartesian3;
  w: number;
  h: number;
  /** px between the anchor and the pill's near edge */
  gap: number;
  /** preferred side; the other side is tried when it does not fit */
  below: boolean;
  /** camera distance beyond which the label is not shown before a plan exists */
  maxDist: number;
  front: boolean;
  show: boolean;
  off: CesiumNS.Cartesian2;
};
/** A marker (pin) that labels avoid, hidden behind the horizon. */
type MarkSpec = { pos: CesiumNS.Cartesian3; size: number; front: boolean };
type LabelGroup = { labels: LabelSpec[]; marks: MarkSpec[] };
const TIER: Record<LabelSpec["kind"], number> = { selected: 0, pin: 1, hazard: 2, chokepoint: 3 };
/** keep labels this far inside the uncovered area, and this far apart */
const EDGE = 8, LABEL_PAD = 3;

type ShipRec = { bb: CesiumNS.Billboard; ship: Ship; t0: number; moving: boolean; selected: boolean };

export default function Globe(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumNS.Viewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const propsRef = useRef(props);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** bumps once web fonts are ready, so canvas labels redraw in the right face */
  const [fontEpoch, setFontEpoch] = useState(0);

  // motion state lives in refs: the render loop must never trigger React renders
  const lastInput = useRef(0);
  const flightId = useRef(0);
  const flying = useRef(false);
  const reduceMotion = useRef(false);
  const pxRef = useRef(1);
  const flyRef = useRef<(opts: Parameters<CesiumNS.Camera["flyTo"]>[0]) => void>(() => {});
  // labels and markers registered by the hazard and route layers; laid out once per frame
  const labelGroups = useRef<{ hazards: LabelGroup; routes: LabelGroup }>({ hazards: { labels: [], marks: [] }, routes: { labels: [], marks: [] } });
  const labelVersion = useRef(0);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => alive && setFontEpoch((e) => e + 1)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // ---- prefers-reduced-motion (live)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotion.current = mq.matches;
    const on = (e: MediaQueryListEvent) => {
      reduceMotion.current = e.matches;
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // ---- any input anywhere stops the idle spin instantly and restarts the idle timer
  useEffect(() => {
    lastInput.current = performance.now();
    const onInput = () => {
      lastInput.current = performance.now();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, opts);
    return () => {
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput, opts);
    };
  }, []);

  // ---- create viewer once
  useEffect(() => {
    let destroyed = false;
    const cleanups: (() => void)[] = [];
    loadCesium()
      .then((Cesium) => {
        if (destroyed || !el.current) return;
        cesiumRef.current = Cesium;
        const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        if (token) Cesium.Ion.defaultAccessToken = token;
        const viewer = new Cesium.Viewer(el.current, {
          baseLayer: false,
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          requestRenderMode: false,
          // render at device resolution (capped at 2x) so lines, labels and ship sprites stay crisp on retina
          useBrowserRecommendedResolution: false,
        });
        const dpr = window.devicePixelRatio || 1;
        viewer.resolutionScale = Math.min(dpr, 2) / dpr;
        // Cesium already multiplies billboard/point sizes by scene.pixelRatio, so sizes stay in css px (1);
        // the canvas textures are still drawn at ≥2x (drawScale) so they stay crisp on retina
        pxRef.current = 1;

        const scene = viewer.scene;
        scene.backgroundColor = Cesium.Color.BLACK;
        if (scene.skyBox) scene.skyBox.show = false;
        if (scene.sun) scene.sun.show = false;
        if (scene.moon) scene.moon.show = false;
        scene.globe.baseColor = Cesium.Color.fromCssColorString("#0b0b0d");
        // ground haze lifts the dark basemap to a flat gray from orbit; keep only the thin sky halo at the limb
        scene.globe.showGroundAtmosphere = false;
        scene.globe.atmosphereBrightnessShift = -0.15;
        scene.globe.atmosphereSaturationShift = -0.35;
        if (scene.skyAtmosphere) {
          scene.skyAtmosphere.brightnessShift = -0.25;
          scene.skyAtmosphere.saturationShift = -0.3;
        }
        viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(65, 18, 22_000_000) });

        // camera flights: tracked so the idle spin never fights them, and instant under reduced motion
        flyRef.current = (opts) => {
          const id = ++flightId.current;
          flying.current = true;
          const done = () => {
            if (flightId.current === id) flying.current = false;
            lastInput.current = performance.now(); // spin resumes only after a fresh idle period
          };
          viewer.camera.flyTo({ ...opts, duration: reduceMotion.current ? 0 : opts.duration, complete: done, cancel: done });
        };

        // idle spin: eastward like the real earth, ramping up with a critically damped curve, stopping instantly
        let lastFrame = performance.now();
        let blockedAt = 0;
        const removeSpin = scene.preUpdate.addEventListener(() => {
          const now = performance.now();
          const dt = Math.min(0.1, (now - lastFrame) / 1000);
          lastFrame = now;
          const p = propsRef.current;
          if (
            p.autoRotate === false ||
            p.pickMode ||
            reduceMotion.current ||
            flying.current ||
            scene.mode !== Cesium.SceneMode.SCENE3D ||
            !Cesium.Matrix4.equals(viewer.camera.transform, Cesium.Matrix4.IDENTITY)
          ) {
            blockedAt = now;
            return;
          }
          const t = (now - Math.max(lastInput.current + IDLE_MS, blockedAt)) / 1000;
          if (t <= 0) return;
          const omega = SPIN * (1 - (1 + SPIN_W0 * t) * Math.exp(-SPIN_W0 * t));
          // Camera.rotate turns the camera by -angle about the axis: a positive angle moves it west, so the earth
          // appears to turn west to east beneath it.
          viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, omega * dt);
        });
        cleanups.push(removeSpin);

        // label layout after every frame, read by the label/point `show` and `pixelOffset` callbacks on the next one:
        // horizon cull, then place in priority order (selected hazard, pins, hazards by score, chokepoints) and drop
        // any pill that would leave the uncovered area or overlap one already placed
        const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.positionWC);
        const scratch2 = new Cesium.Cartesian2();
        let sorted: LabelSpec[] = [];
        let sortedVersion = -1;
        let expPlan: PlanResponse | null = null;
        let expActive: string | null = null;
        let exposed = new Set<string>();
        const placed: number[] = [];
        const clear = (x0: number, y0: number, x1: number, y1: number) => {
          for (let i = 0; i < placed.length; i += 4)
            if (x0 < placed[i + 2] && x1 > placed[i] && y0 < placed[i + 3] && y1 > placed[i + 1]) return false;
          return true;
        };
        const removeLayout = scene.postRender.addEventListener(() => {
          const groups = labelGroups.current;
          if (sortedVersion !== labelVersion.current) {
            sortedVersion = labelVersion.current;
            sorted = [...groups.hazards.labels, ...groups.routes.labels].sort((a, b) => TIER[a.kind] - TIER[b.kind] || b.rank - a.rank);
          }
          const p = propsRef.current;
          const plan = p.plan;
          const active = plan ? (p.activeRouteId ?? plan.recommendedRouteId) : null;
          if (plan !== expPlan || active !== expActive) {
            expPlan = plan;
            expActive = active;
            exposed = new Set(plan?.routes.find((r) => r.id === active)?.metrics.exposures.map((e) => e.hazardId) ?? []);
          }
          const cam = viewer.camera.positionWC;
          occluder.cameraPosition = cam;
          const ins = insetsOf(p);
          const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight;
          // the canvas runs `left` px past the right edge and `bottom` px past the top (see the container below),
          // so the uncovered area is symmetric inside it
          const L = ins.left + EDGE, R = W - ins.left - EDGE, T = ins.bottom + EDGE, B = H - ins.bottom - EDGE;
          placed.length = 0;
          for (const m of groups.routes.marks) {
            m.front = occluder.isPointVisible(m.pos);
            const c = m.front ? scene.cartesianToCanvasCoordinates(m.pos, scratch2) : undefined;
            if (c) placed.push(c.x - m.size / 2, c.y - m.size / 2, c.x + m.size / 2, c.y + m.size / 2);
          }
          for (const s of sorted) {
            s.front = occluder.isPointVisible(s.pos);
            s.show = false;
            if (!s.front) continue;
            const eligible =
              s.kind === "selected" || s.kind === "pin"
                ? true
                : plan
                  ? s.kind === "hazard" && exposed.has(s.hazardId ?? "")
                  : Cesium.Cartesian3.distance(cam, s.pos) <= s.maxDist;
            if (!eligible) continue;
            const c = scene.cartesianToCanvasCoordinates(s.pos, scratch2);
            if (!c) continue;
            for (const below of s.below ? [true, false] : [false, true]) {
              const offY = (below ? 1 : -1) * (s.gap + s.h / 2);
              let offX = 0;
              let x0 = c.x - s.w / 2, x1 = c.x + s.w / 2;
              // pins stay readable at the edges: slide the pill (at most half its width, so it still sits over the pin)
              if (s.kind === "pin") {
                if (x0 < L) offX = Math.min(s.w / 2, L - x0);
                else if (x1 > R) offX = -Math.min(s.w / 2, x1 - R);
                x0 += offX;
                x1 += offX;
              }
              const y0 = c.y + offY - s.h / 2, y1 = y0 + s.h;
              if (x0 < L || x1 > R || y0 < T || y1 > B || !clear(x0, y0, x1, y1)) continue;
              placed.push(x0 - LABEL_PAD, y0 - LABEL_PAD, x1 + LABEL_PAD, y1 + LABEL_PAD);
              s.off.x = offX;
              s.off.y = offY;
              s.show = true;
              break;
            }
          }
        });
        cleanups.push(removeLayout);

        // no double-click entity tracking: it would lock the camera to an entity's frame
        viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

        const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
        handler.setInputAction((ev: { position: CesiumNS.Cartesian2 }) => {
          const p = propsRef.current;
          if (p.pickMode) {
            const cart = viewer.camera.pickEllipsoid(ev.position, scene.globe.ellipsoid);
            if (cart) {
              const c = Cesium.Cartographic.fromCartesian(cart);
              p.onPick([Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)]);
            }
            return;
          }
          // ships are small, so pick a few pixels around the click and prefer a ship over the zone under it
          const hits = scene.drillPick(ev.position, 6, 9, 9) as { id?: unknown }[];
          const ship = p.onSelectShip
            ? hits.find((h) => typeof (h.id as { shipMmsi?: unknown } | undefined)?.shipMmsi === "number")
            : undefined;
          if (ship) {
            p.onSelectShip?.((ship.id as { shipMmsi: number }).shipMmsi);
            return;
          }
          // then route lines (entity ids "route-<id>" and "route-<id>-casing")
          if (p.onSelectRoute && p.plan) {
            for (const h of hits) {
              const eid = (h.id as CesiumNS.Entity | undefined)?.id;
              const m = typeof eid === "string" ? /^route-([a-z]+)/.exec(eid) : null;
              const route = m && p.plan.routes.find((r) => r.id === m[1]);
              if (route) {
                p.onSelectRoute(route.id);
                return;
              }
            }
          }
          let hazardId: string | null = null;
          for (const h of hits) {
            const v = (h.id as CesiumNS.Entity | undefined)?.properties?.hazardId?.getValue?.();
            if (typeof v === "string") {
              hazardId = v;
              break;
            }
          }
          p.onSelectHazard(hazardId);
          if (p.selectedShipMmsi != null) p.onSelectShip?.(null);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        cleanups.push(() => handler.destroy());

        viewerRef.current = viewer;
        setReady(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      destroyed = true;
      for (const c of cleanups) c();
      viewerRef.current?.destroy();
      viewerRef.current = null;
      flyRef.current = () => {};
    };
  }, []);

  // ---- base map
  useEffect(() => {
    const viewer = viewerRef.current, Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium) return;
    viewer.imageryLayers.removeAll();
    const provider =
      props.baseMap === "satellite"
        ? new Cesium.UrlTemplateImageryProvider({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            credit: new Cesium.Credit("Esri, Maxar, Earthstar Geographics", true), // shown on the map, not behind a link
            maximumLevel: 18,
          })
        : props.baseMap === "osm"
          ? new Cesium.UrlTemplateImageryProvider({
              url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
              credit: new Cesium.Credit("© OpenStreetMap contributors", true), // shown on the map, not behind a link
              maximumLevel: 19,
            })
          : new Cesium.UrlTemplateImageryProvider({
              url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
              credit: new Cesium.Credit("Esri, HERE, Garmin, © OpenStreetMap contributors", true), // shown on the map, not behind a link
              maximumLevel: 16,
            });
    viewer.imageryLayers.addImageryProvider(provider);
    if (props.baseMap === "dark")
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 16,
        }),
      );
  }, [ready, props.baseMap]);

  // ---- hazards and chokepoints
  const hazardSrc = useRef<CesiumNS.CustomDataSource | null>(null);
  useEffect(() => {
    const viewer = viewerRef.current, Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium) return;
    if (!hazardSrc.current) {
      hazardSrc.current = new Cesium.CustomDataSource("hazards");
      viewer.dataSources.add(hazardSrc.current);
    }
    const ds = hazardSrc.current;
    const px = pxRef.current, family = fontFamily();
    const compact = window.matchMedia("(max-width: 767px)").matches;
    ds.entities.removeAll();
    const group: LabelGroup = { labels: [], marks: [] };
    labelGroups.current.hazards = group;
    labelVersion.current++;
    const start = performance.now();
    const all = [...props.hazards, ...(props.plan?.hazards.filter((h) => h.id.startsWith("waves-") || h.id.startsWith("sim-")) ?? [])];
    const seen = new Set<string>();
    for (const h of all) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      const hex = HAZARD_COLORS[h.category] ?? SYS.red;
      const color = Cesium.Color.fromCssColorString(hex);
      const selected = h.id === props.selectedHazardId;
      const base = 0.06 + (h.score / 100) * 0.08;
      // high-risk zones breathe slowly (8 s cycle, a few percent of alpha): calm, never a strobe
      const fill =
        h.score >= 60
          ? new Cesium.CallbackProperty(() => {
              if (reduceMotion.current) return color.withAlpha(base + 0.03);
              const t = (performance.now() - start) / 1000;
              return color.withAlpha(base + 0.05 * (0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / 8)));
            }, false)
          : color.withAlpha(base);
      const label = pill(
        [
          { text: shortName(h.title), color: INK },
          { text: String(Math.round(h.score)), color: riskColor(h.score), weight: 600 },
        ],
        { size: 12, dot: hex, selected },
        px,
        family,
      );
      const position = Cesium.Cartesian3.fromDegrees(h.center[0], h.center[1]);
      const spec: LabelSpec = {
        kind: selected ? "selected" : "hazard",
        hazardId: h.id,
        rank: h.score,
        pos: position,
        w: label.w,
        h: label.h,
        gap: 6,
        below: false,
        // de-clutter before a plan: strong hazards from afar (closer on a phone, where the earth is small), the rest when zoomed in
        maxDist: h.score >= 50 ? (compact ? 1.2e7 : 5e7) : 6e6,
        front: true,
        show: false,
        off: new Cesium.Cartesian2(0, -(6 + label.h / 2)),
      };
      group.labels.push(spec);
      ds.entities.add({
        id: `hz-${h.id}`,
        position,
        properties: { hazardId: h.id },
        ellipse: {
          semiMajorAxis: h.radiusKm * 1000,
          semiMinorAxis: h.radiusKm * 1000,
          material: new Cesium.ColorMaterialProperty(fill as CesiumNS.Property),
          outline: !selected,
          outlineColor: color.withAlpha(0.55),
          outlineWidth: 1,
          height: 0,
        },
        point: {
          pixelSize: (selected ? 8 : 6) * px,
          color,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.45),
          outlineWidth: px,
        },
        // shown and placed by the per-frame label layout (horizon cull + collision), so no depth test here
        billboard: {
          image: label.url,
          width: label.w * px,
          height: label.h * px,
          show: new Cesium.CallbackProperty(() => spec.show, false),
          pixelOffset: new Cesium.CallbackProperty(() => spec.off, false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      if (selected)
        ds.entities.add({
          id: `hz-ring-${h.id}`,
          properties: { hazardId: h.id },
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(circlePositions(h.center, h.radiusKm)),
            width: 2,
            arcType: Cesium.ArcType.NONE,
            material: new Cesium.ColorMaterialProperty(color.withAlpha(0.95)),
          },
        });
    }
    for (const c of props.chokepoints) {
      const drop = c.changePct ?? 0;
      const tone = drop < -25 ? SYS.yellow : SYS.teal;
      const parts: PillPart[] = [{ text: c.name, color: INK_2, weight: 500 }];
      if (c.changePct !== undefined)
        parts.push({ text: `${c.changePct >= 0 ? "+" : ""}${c.changePct.toFixed(0)}%`, color: drop < -25 ? SYS.yellow : INK_3, weight: 600 });
      const label = pill(parts, { size: 11 }, px, family);
      const position = Cesium.Cartesian3.fromDegrees(c.center[0], c.center[1]);
      const spec: LabelSpec = {
        kind: "chokepoint",
        rank: Math.abs(drop),
        pos: position,
        w: label.w,
        h: label.h,
        gap: 6,
        below: true,
        maxDist: 5e6,
        front: true,
        show: false,
        off: new Cesium.Cartesian2(0, 6 + label.h / 2),
      };
      group.labels.push(spec);
      ds.entities.add({
        id: `cp-${c.id}`,
        position,
        point: { pixelSize: 5 * px, color: Cesium.Color.fromCssColorString(tone), outlineColor: Cesium.Color.BLACK.withAlpha(0.45), outlineWidth: px },
        billboard: {
          image: label.url,
          width: label.w * px,
          height: label.h * px,
          show: new Cesium.CallbackProperty(() => spec.show, false),
          pixelOffset: new Cesium.CallbackProperty(() => spec.off, false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }, [ready, fontEpoch, props.hazards, props.chokepoints, props.plan, props.selectedHazardId]);

  // ---- live AIS ships: one BillboardCollection, arrows rotated to heading, dead-reckoned between samples
  const shipLayer = useRef<CesiumNS.BillboardCollection | null>(null);
  const shipRecs = useRef(new Map<number, ShipRec>());
  const shipSprites = useRef<{ arrow: HTMLCanvasElement; dot: HTMLCanvasElement; sel: Map<string, HTMLCanvasElement> } | null>(null);

  // styles one ship billboard; images are registered by id so the atlas holds each sprite once
  const styleShip = (rec: ShipRec, selected: boolean) => {
    const Cesium = cesiumRef.current;
    if (!Cesium || !shipSprites.current) return;
    const sprites = shipSprites.current;
    const px = pxRef.current;
    const s = rec.ship;
    const moving = s.sog >= 1;
    const hex = SHIP_COLORS[s.cls] ?? SHIP_COLORS.unknown;
    const heading = s.heading ?? (moving ? s.cog : null);
    const bb = rec.bb;
    rec.moving = moving;
    rec.selected = selected;
    if (selected) {
      const key = `${s.cls}|${moving ? 1 : 0}`;
      let c = sprites.sel.get(key);
      if (!c) sprites.sel.set(key, (c = shipSelectedCanvas(hex, moving)));
      bb.setImage(`ship-sel-${key}`, c);
      bb.width = bb.height = SELECTED_CSS * px;
      bb.color = Cesium.Color.WHITE;
      bb.eyeOffset = new Cesium.Cartesian3(0, 0, -5e4);
      bb.scaleByDistance = new Cesium.NearFarScalar(3e5, 1, 2e7, 0.75);
    } else {
      bb.setImage(moving ? "ship-arrow" : "ship-dot", moving ? sprites.arrow : sprites.dot);
      bb.width = bb.height = (moving ? ARROW_CSS : DOT_CSS) * px;
      bb.color = Cesium.Color.fromCssColorString(hex).withAlpha(moving ? 0.95 : 0.5);
      bb.eyeOffset = Cesium.Cartesian3.ZERO;
      bb.scaleByDistance = new Cesium.NearFarScalar(3e5, 1.15, 2e7, 0.5);
    }
    bb.rotation = heading === null ? 0 : -Cesium.Math.toRadians(heading);
  };
  const styleShipRef = useRef(styleShip);
  useEffect(() => {
    styleShipRef.current = styleShip;
  });

  /** Dead reckoning: advance each moving ship from its report time along cog at sog (capped at 30 minutes). */
  const placeShips = useRef(() => {});
  useEffect(() => {
    const Cesium = cesiumRef.current;
    if (!ready || !Cesium) return;
    const scratch = new Cesium.Cartesian3();
    placeShips.current = () => {
      const now = Date.now();
      for (const rec of shipRecs.current.values()) {
        const s = rec.ship;
        let lon = s.lon, lat = s.lat;
        if (rec.moving) {
          const hours = Math.min(MAX_EXTRAPOLATE_H, Math.max(0, (now - rec.t0) / 3_600_000));
          const nm = s.sog * hours, θ = (s.cog * Math.PI) / 180;
          lat = Math.max(-89.9, Math.min(89.9, lat + (nm * Math.cos(θ)) / 60));
          lon = lon + (nm * Math.sin(θ)) / (60 * Math.max(0.05, Math.cos((s.lat * Math.PI) / 180)));
        }
        rec.bb.position = Cesium.Cartesian3.fromDegrees(lon, lat, SHIP_HEIGHT, undefined, scratch);
      }
    };
    const timer = window.setInterval(() => placeShips.current(), 1000);
    return () => window.clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    const viewer = viewerRef.current, Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium) return;
    if (!shipLayer.current) shipLayer.current = viewer.scene.primitives.add(new Cesium.BillboardCollection());
    if (!shipSprites.current) shipSprites.current = { arrow: shipArrowCanvas(), dot: shipDotCanvas(), sel: new Map() };
    const layer = shipLayer.current!;
    const recs = shipRecs.current;
    const received = Date.now();
    const selectedMmsi = propsRef.current.selectedShipMmsi ?? null;
    const keep = new Set<number>();
    for (const s of props.ships ?? []) {
      if (!Number.isFinite(s.lon) || !Number.isFinite(s.lat)) continue;
      keep.add(s.mmsi);
      const parsed = s.at ? Date.parse(s.at) : NaN;
      const t0 = Number.isFinite(parsed) ? Math.min(parsed, received) : received;
      let rec = recs.get(s.mmsi);
      if (!rec) {
        const bb = layer.add({
          position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, SHIP_HEIGHT),
          alignedAxis: Cesium.Cartesian3.UNIT_Z,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 5e7),
          id: { shipMmsi: s.mmsi },
        });
        rec = { bb, ship: s, t0, moving: false, selected: false };
        recs.set(s.mmsi, rec);
      } else {
        rec.ship = s;
        rec.t0 = t0;
      }
      styleShipRef.current(rec, s.mmsi === selectedMmsi);
    }
    for (const [mmsi, rec] of recs) {
      if (keep.has(mmsi)) continue;
      layer.remove(rec.bb);
      recs.delete(mmsi);
    }
    placeShips.current();
  }, [ready, props.ships]);

  // ---- selected ship: larger, white ring
  useEffect(() => {
    if (!ready) return;
    const want = props.selectedShipMmsi ?? null;
    for (const rec of shipRecs.current.values()) {
      const sel = rec.ship.mmsi === want;
      if (sel !== rec.selected) styleShipRef.current(rec, sel);
    }
  }, [ready, props.selectedShipMmsi]);

  // ---- routes
  const routeSrc = useRef<CesiumNS.CustomDataSource | null>(null);
  const lastPlan = useRef<PlanResponse | null>(null);
  useEffect(() => {
    const viewer = viewerRef.current, Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium) return;
    if (!routeSrc.current) {
      routeSrc.current = new Cesium.CustomDataSource("routes");
      viewer.dataSources.add(routeSrc.current);
    }
    const ds = routeSrc.current;
    const px = pxRef.current, family = fontFamily();
    ds.entities.removeAll();
    const group: LabelGroup = { labels: [], marks: [] };
    labelGroups.current.routes = group;
    labelVersion.current++;
    const plan = props.plan;
    if (!plan) return;
    const active = props.activeRouteId ?? plan.recommendedRouteId;
    const toPositions = (path: LonLat[]) => Cesium.Cartesian3.fromDegreesArrayHeights(path.flatMap((p) => [p[0], p[1], 3000]));
    // routes are coloured by role (Apple Maps): selected = blue over a dark casing, original = light dashed, others muted gray.
    // Inactive first, the selected route last so it sits on top.
    const order = [...plan.routes].sort((a, b) => (a.id === active ? 1 : 0) - (b.id === active ? 1 : 0));
    for (const r of order) {
      const isActive = r.id === active;
      const isOriginal = r.id === "original";
      const color = Cesium.Color.fromCssColorString(routeColor(r.id, active));
      const positions = toPositions(r.path);
      if (isActive) {
        // one polyline with a built-in dark outline (the casing): two stacked lines at the same height z-fight
        ds.entities.add({
          id: `route-${r.id}`,
          polyline: {
            positions,
            width: 7,
            arcType: Cesium.ArcType.GEODESIC,
            material: new Cesium.PolylineOutlineMaterialProperty({ color, outlineColor: Cesium.Color.fromCssColorString("#0a3d7a"), outlineWidth: 1.5 }),
          },
        });
      } else {
        ds.entities.add({
          id: `route-${r.id}`,
          polyline: {
            positions,
            width: isOriginal ? 2.5 : 2,
            arcType: Cesium.ArcType.GEODESIC,
            material: isOriginal
              ? new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.8), dashLength: 14 })
              : new Cesium.ColorMaterialProperty(color.withAlpha(0.5)),
          },
        });
      }
    }
    const pin = (p: LonLat, text: string, fill: string, sub?: PillPart[]) => {
      const marker = pinImage(fill, px);
      const label = pill([{ text, color: INK, weight: 600 }, ...(sub ?? [])], { size: 13 }, px, family);
      const position = Cesium.Cartesian3.fromDegrees(p[0], p[1], 5000);
      const spec: LabelSpec = {
        kind: "pin",
        rank: 0,
        pos: position,
        w: label.w,
        h: label.h,
        gap: 12,
        below: false,
        maxDist: Infinity,
        front: true,
        show: false,
        off: new Cesium.Cartesian2(0, -(12 + label.h / 2)),
      };
      group.labels.push(spec);
      group.marks.push({ pos: position, size: marker.w, front: true });
      ds.entities.add({
        position,
        billboard: { image: marker.url, width: marker.w * px, height: marker.h * px, eyeOffset: new Cesium.Cartesian3(0, 0, -3e4) },
      });
      ds.entities.add({
        position,
        billboard: {
          image: label.url,
          width: label.w * px,
          height: label.h * px,
          show: new Cesium.CallbackProperty(() => spec.show, false),
          pixelOffset: new Cesium.CallbackProperty(() => spec.off, false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    };
    pin(plan.shipment.origin.center, plan.shipment.origin.name, "#1c1c1e");
    pin(plan.shipment.destination.center, plan.shipment.destination.name, SYS.ink);
    if (plan.checkpoint)
      pin(plan.checkpoint.port.center, "Checkpoint", ROUTE_ROLE.alternative, [
        { text: `· ${plan.checkpoint.port.name} · day ${plan.checkpoint.etaDays}`, color: INK_2, weight: 500 },
      ]);

    // animated vessel along the active route (held at the origin under reduced motion)
    const route = plan.routes.find((r) => r.id === active);
    if (route) {
      const pos = toPositions(route.path);
      const lens = [0];
      for (let i = 1; i < pos.length; i++) lens.push(lens[i - 1] + Cesium.Cartesian3.distance(pos[i - 1], pos[i]));
      const total = lens[lens.length - 1];
      const t0 = performance.now();
      const scratch = new Cesium.Cartesian3();
      ds.entities.add({
        position: new Cesium.CallbackPositionProperty(() => {
          if (pos.length < 2) return pos[0];
          const d = reduceMotion.current ? 0 : (((performance.now() - t0) / 20000) % 1) * total;
          let i = 1;
          while (i < lens.length - 1 && lens[i] < d) i++;
          const f = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
          return Cesium.Cartesian3.lerp(pos[i - 1], pos[i], f, scratch);
        }, false),
        point: {
          pixelSize: 8 * px,
          color: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString(routeColor(route.id, active)),
          outlineWidth: 3 * px,
        },
      });
    }

    if (lastPlan.current !== plan) {
      lastPlan.current = plan;
      // look straight down at the centre of all routes, from high enough to see them all
      const pts = plan.routes.flatMap((r) => r.path).map((p) => Cesium.Cartesian3.normalize(Cesium.Cartesian3.fromDegrees(p[0], p[1]), new Cesium.Cartesian3()));
      const mean = pts.reduce((acc, v) => Cesium.Cartesian3.add(acc, v, acc), new Cesium.Cartesian3());
      const centre = Cesium.Cartographic.fromCartesian(Cesium.Cartesian3.multiplyByScalar(Cesium.Cartesian3.normalize(mean, mean), 6.371e6, mean));
      const spread = Math.max(...pts.map((v) => Math.acos(Math.min(1, Cesium.Cartesian3.dot(v, Cesium.Cartesian3.normalize(Cesium.Cartesian3.fromRadians(centre.longitude, centre.latitude), new Cesium.Cartesian3()))))));
      const height = Math.min(2.4e7, Math.max(3.5e6, spread * 6.371e6 * 2.6));
      // the canvas is already centred on the uncovered area (see the container below), so look straight at the centre
      flyRef.current({ destination: Cesium.Cartesian3.fromRadians(centre.longitude, centre.latitude, height), duration: 2.2 });
    }
  }, [ready, fontEpoch, props.plan, props.activeRouteId]);

  // ---- fly to the selected hazard
  useEffect(() => {
    const viewer = viewerRef.current, Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium || !props.selectedHazardId) return;
    const h = [...props.hazards, ...(props.plan?.hazards ?? [])].find((x) => x.id === props.selectedHazardId);
    if (!h) return;
    flyRef.current({
      destination: Cesium.Cartesian3.fromDegrees(h.center[0], h.center[1] - 4, Math.max(2_500_000, h.radiusKm * 9000)),
      orientation: { pitch: Cesium.Math.toRadians(-70) },
      duration: 1.6,
    });
    // only when the selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.selectedHazardId]);

  useEffect(() => {
    if (el.current) el.current.style.cursor = props.pickMode ? "crosshair" : "";
  }, [props.pickMode]);

  // The canvas runs `left` px past the right edge and `bottom` px past the top, so its centre (where the earth and
  // every flight target sit) is the centre of the area the sidebar / sheet leave uncovered. Clicks stay exact because
  // the canvas is simply larger; the parent clips the overflow.
  const ins = insetsOf(props);
  const canvasBox: CSSProperties = { position: "absolute", left: 0, bottom: 0, top: -ins.bottom, right: -ins.left };
  const wrapVars = { "--globe-inset-left": `${ins.left}px`, "--globe-inset-bottom": `${ins.bottom}px` } as CSSProperties;

  return (
    <div className="absolute inset-0 overflow-hidden bg-black" style={wrapVars}>
      <div ref={el} style={canvasBox} />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center" role="status" aria-live="polite">
          {error ? (
            <div>
              <p className="text-caption text-ink-3">The globe could not load. Check the connection and reload.</p>
              <p className="mt-1 text-micro text-ink-4">{error}</p>
            </div>
          ) : (
            <p className="text-caption text-ink-3">Loading globe…</p>
          )}
        </div>
      )}
    </div>
  );
}
