"use client";

import { useEffect, useRef, useState } from "react";
import type * as CesiumNS from "cesium";
import type { Chokepoint, Hazard, PlanResponse, PlannedRoute } from "@/lib/types";
import type { LonLat } from "@/lib/geo";
import { HAZARD_COLORS, ROUTE_COLORS } from "./colors";

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
    s.onerror = () => reject(new Error("Cesium failed to load"));
    document.head.appendChild(s);
  });
  return loader;
}

export type BaseMap = "dark" | "osm" | "satellite";

type Props = {
  hazards: Hazard[];
  chokepoints: Chokepoint[];
  plan: PlanResponse | null;
  activeRouteId: PlannedRoute["id"] | null;
  selectedHazardId: string | null;
  baseMap: BaseMap;
  pickMode: boolean;
  onPick: (p: LonLat) => void;
  onSelectHazard: (id: string | null) => void;
};

export default function Globe(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumNS.Viewer | null>(null);
  const cesiumRef = useRef<CesiumModule | null>(null);
  const propsRef = useRef(props);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    propsRef.current = props;
  });

  // ---- create viewer once
  useEffect(() => {
    let destroyed = false;
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
        });
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#06121f");
        viewer.scene.globe.showGroundAtmosphere = true;
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#02060d");
        (viewer.cesiumWidget.creditContainer as HTMLElement).style.opacity = "0.6";
        viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(65, 18, 22_000_000) });

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((ev: { position: CesiumNS.Cartesian2 }) => {
          const p = propsRef.current;
          if (p.pickMode) {
            const cart = viewer.camera.pickEllipsoid(ev.position, viewer.scene.globe.ellipsoid);
            if (cart) {
              const c = Cesium.Cartographic.fromCartesian(cart);
              p.onPick([Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)]);
            }
            return;
          }
          const picked = viewer.scene.pick(ev.position);
          const id = picked?.id?.properties?.hazardId?.getValue?.();
          p.onSelectHazard(typeof id === "string" ? id : null);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        viewerRef.current = viewer;
        setReady(true);
      })
      .catch((e) => setError(String(e)));
    return () => {
      destroyed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
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
            credit: "Esri, Maxar, Earthstar Geographics",
            maximumLevel: 18,
          })
        : props.baseMap === "osm"
          ? new Cesium.UrlTemplateImageryProvider({
              url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
              credit: "© OpenStreetMap contributors",
              maximumLevel: 19,
            })
          : new Cesium.UrlTemplateImageryProvider({
              url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
              credit: "Esri, HERE, Garmin, © OpenStreetMap contributors",
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
    ds.entities.removeAll();
    const start = performance.now();
    const all = [...props.hazards, ...(props.plan?.hazards.filter((h) => h.id.startsWith("waves-") || h.id.startsWith("sim-")) ?? [])];
    const seen = new Set<string>();
    for (const h of all) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      const color = Cesium.Color.fromCssColorString(HAZARD_COLORS[h.category] ?? "#ff3b3b");
      const selected = h.id === props.selectedHazardId;
      const strong = h.score >= 60;
      const alpha = strong
        ? new Cesium.CallbackProperty(() => {
            const t = (performance.now() - start) / 1000;
            return color.withAlpha(0.12 + 0.1 * (0.5 + 0.5 * Math.sin(t * 2.4)));
          }, false)
        : color.withAlpha(0.1 + (h.score / 100) * 0.12);
      ds.entities.add({
        id: `hz-${h.id}`,
        position: Cesium.Cartesian3.fromDegrees(h.center[0], h.center[1]),
        properties: { hazardId: h.id },
        ellipse: {
          semiMajorAxis: h.radiusKm * 1000,
          semiMinorAxis: h.radiusKm * 1000,
          material: new Cesium.ColorMaterialProperty(alpha as CesiumNS.Property),
          outline: true,
          outlineColor: color.withAlpha(selected ? 1 : 0.7),
          outlineWidth: selected ? 3 : 1,
          height: 0,
        },
        point: { pixelSize: selected ? 12 : 8, color, outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: `${h.title}  ${h.score}`,
          font: "12px ui-monospace, monospace",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, h.score >= 50 ? 3.2e7 : 9e6),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#0b1220").withAlpha(0.7),
        },
      });
    }
    for (const c of props.chokepoints) {
      const drop = c.changePct ?? 0;
      ds.entities.add({
        id: `cp-${c.id}`,
        position: Cesium.Cartesian3.fromDegrees(c.center[0], c.center[1]),
        point: { pixelSize: 6, color: Cesium.Color.fromCssColorString(drop < -25 ? "#facc15" : "#5eead4"), outlineColor: Cesium.Color.BLACK, outlineWidth: 1 },
        label: {
          text: `${c.name}${c.changePct !== undefined ? ` ${c.changePct >= 0 ? "+" : ""}${c.changePct.toFixed(0)}%` : ""}`,
          font: "11px ui-monospace, monospace",
          fillColor: Cesium.Color.fromCssColorString("#99f6e4"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 7e6),
        },
      });
    }
  }, [ready, props.hazards, props.chokepoints, props.plan, props.selectedHazardId]);

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
    ds.entities.removeAll();
    const plan = props.plan;
    if (!plan) return;
    const active = props.activeRouteId ?? plan.recommendedRouteId;
    const toPositions = (path: LonLat[]) => Cesium.Cartesian3.fromDegreesArrayHeights(path.flatMap((p) => [p[0], p[1], 3000]));
    const order = [...plan.routes].sort((a, b) => (a.id === active ? 1 : 0) - (b.id === active ? 1 : 0));
    for (const r of order) {
      const isActive = r.id === active;
      const isOriginal = r.id === "original";
      const color = Cesium.Color.fromCssColorString(ROUTE_COLORS[r.id]);
      ds.entities.add({
        id: `route-${r.id}`,
        polyline: {
          positions: toPositions(r.path),
          width: isActive ? 7 : isOriginal ? 3.5 : 2.5,
          arcType: Cesium.ArcType.GEODESIC,
          material: isActive
            ? new Cesium.PolylineGlowMaterialProperty({ color, glowPower: 0.25 })
            : isOriginal
              ? new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.95), dashLength: 18 })
              : new Cesium.ColorMaterialProperty(color.withAlpha(0.55)),
        },
      });
    }
    const pin = (p: LonLat, text: string, color: string) =>
      ds.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p[0], p[1], 5000),
        point: { pixelSize: 11, color: Cesium.Color.fromCssColorString(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: {
          text,
          font: "bold 13px ui-sans-serif, system-ui",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString(color).withAlpha(0.35),
        },
      });
    pin(plan.shipment.origin.center, `⚓ ${plan.shipment.origin.name}`, "#e2e8f0");
    pin(plan.shipment.destination.center, `🏁 ${plan.shipment.destination.name}`, "#e2e8f0");
    if (plan.checkpoint) pin(plan.checkpoint.port.center, `⟳ Reassess at ${plan.checkpoint.port.name} (day ${plan.checkpoint.etaDays})`, "#fbbf24");

    // animated vessel along the active route
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
          const d = (((performance.now() - t0) / 20000) % 1) * total;
          let i = 1;
          while (i < lens.length - 1 && lens[i] < d) i++;
          const f = (d - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
          return Cesium.Cartesian3.lerp(pos[i - 1], pos[i], f, scratch);
        }, false),
        point: { pixelSize: 9, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString(ROUTE_COLORS[route.id]), outlineWidth: 3 },
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
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromRadians(centre.longitude, centre.latitude, height), duration: 2.2 });
    }
  }, [ready, props.plan, props.activeRouteId]);

  // ---- fly to the selected hazard
  useEffect(() => {
    const viewer = viewerRef.current, Cesium = cesiumRef.current;
    if (!ready || !viewer || !Cesium || !props.selectedHazardId) return;
    const h = [...props.hazards, ...(props.plan?.hazards ?? [])].find((x) => x.id === props.selectedHazardId);
    if (!h) return;
    viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(h.center[0], h.center[1] - 4, Math.max(2_500_000, h.radiusKm * 9000)), orientation: { pitch: Cesium.Math.toRadians(-70) }, duration: 1.6 });
    // only when the selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.selectedHazardId]);

  useEffect(() => {
    if (el.current) el.current.style.cursor = props.pickMode ? "crosshair" : "";
  }, [props.pickMode]);

  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">
          {error ? `Globe failed to load: ${error}` : "Loading globe…"}
        </div>
      )}
    </div>
  );
}
