import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, Line, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "../utils";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  label: string;
  color?: string;
  position?: [number, number, number];
  /** Whether the app is currently connected/live. Inactive nodes render grey. */
  active?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  color?: string;
}

export interface AppGraph3DProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  title?: string;
  className?: string;
  autoRotate?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const DEFAULT_COLORS = [
  "#60a5fa", "#34d399", "#f59e0b", "#f87171",
  "#a78bfa", "#fb923c", "#e879f9", "#22d3ee",
];

function fibonacciSphere(n: number, radius: number): [number, number, number][] {
  if (n === 0) return [];
  if (n === 1) return [[0, 0, 0]];
  const phi = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius] as [number, number, number];
  });
}

// ── Node ───────────────────────────────────────────────────────────────────────

const NODE_R = 0.22;

function NodeSphere({
  basePosition,
  color,
  label,
  phase,
  active,
}: {
  basePosition: [number, number, number];
  color: string;
  label: string;
  phase: number;
  active: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  // spark state: intensity decays to 0 between events
  const spark = useRef({ intensity: 0, timer: 1 + Math.random() * 2 });

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();

    if (groupRef.current) {
      groupRef.current.position.y = basePosition[1] + (active ? 0.08 : 0.025) * Math.sin(t * 0.75 + phase);
    }

    const mat = matRef.current;
    if (!mat) return;

    if (!active) {
      mat.color.set("#4a4a50");
      mat.emissive.set("#1a1a1f");
      mat.emissiveIntensity = 0.04 + 0.02 * Math.sin(t * 0.4 + phase);
      return;
    }

    // Decay current spark
    spark.current.intensity = Math.max(0, spark.current.intensity - delta * 7);

    // Schedule next spark
    spark.current.timer -= delta;
    if (spark.current.timer <= 0 && spark.current.intensity < 0.05) {
      spark.current.intensity = 0.85 + Math.random() * 0.15;
      spark.current.timer = 1.8 + Math.random() * 2.5;
    }

    const base = 0.45 + 0.25 * Math.sin(t * 1.8 + phase);
    const s = spark.current.intensity;

    if (s > 0.05) {
      // Spark: flash yellow-white
      mat.color.set(color);
      mat.emissive.setHex(0xfffbe6);
      mat.emissiveIntensity = base + s * 2.2;
    } else {
      mat.color.set(color);
      mat.emissive.set(color);
      mat.emissiveIntensity = base;
    }
  });

  const pillW = label.length * 0.115 + 0.22;

  return (
    <group ref={groupRef} position={basePosition}>
      {/* Point light: colored + bright when active, absent when not */}
      <pointLight
        color={active ? color : "#555555"}
        intensity={active ? 2.0 : 0}
        distance={4.5}
        decay={2}
      />

      {/* Rim: subtle grey when inactive */}
      <mesh>
        <sphereGeometry args={[NODE_R + 0.035, 32, 32]} />
        <meshBasicMaterial
          color={active ? "white" : "#666666"}
          side={THREE.BackSide}
          transparent
          opacity={active ? 0.7 : 0.3}
        />
      </mesh>

      {/* Core — color/emissive driven by useFrame */}
      <mesh castShadow>
        <sphereGeometry args={[NODE_R, 32, 32]} />
        <meshStandardMaterial
          ref={matRef}
          color={active ? color : "#4a4a50"}
          roughness={0.15}
          metalness={0.1}
          emissive={active ? color : "#1a1a1f"}
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Pill label */}
      <mesh position={[0, 0.47, -0.01]} renderOrder={1}>
        <planeGeometry args={[pillW, 0.25]} />
        <meshBasicMaterial color="#0d0d14" transparent opacity={0.65} depthWrite={false} />
      </mesh>
      <Text
        position={[0, 0.47, 0]}
        fontSize={0.16}
        color="#d0d0d8"
        anchorX="center"
        anchorY="middle"
        renderOrder={2}
      >
        {label}
      </Text>
    </group>
  );
}

// ── Curved directed edge ───────────────────────────────────────────────────────

const CURVATURE = 0.1;
const RING_COUNT = 7;
const RING_AXIS = new THREE.Vector3(0, 0, 1); // torus default hole-axis

// Rings that spin around the wire — visual analogue of a magnetic field
function MagneticField({ curve, color }: { curve: THREE.CatmullRomCurve3; color: string }) {
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);

  const rings = useMemo(() =>
    Array.from({ length: RING_COUNT }, (_, i) => {
      const t = (i + 0.5) / RING_COUNT;
      const pos = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();

      // Align torus so its axis (Z) points along the wire tangent
      const q = new THREE.Quaternion().setFromUnitVectors(RING_AXIS, tangent);

      // Fade rings in near endpoints so they don't fight the node spheres
      const fade = Math.min(1, Math.min(t, 1 - t) * RING_COUNT);
      return { pos, q, fade };
    }),
  [curve]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 1.4;
    ringRefs.current.forEach((ring, i) => {
      if (ring) ring.rotation.z = t + (i / RING_COUNT) * Math.PI * 2;
    });
  });

  return (
    <>
      {rings.map((r, i) => (
        <group key={i} position={r.pos} quaternion={r.q}>
          <mesh ref={el => { ringRefs.current[i] = el; }}>
            <torusGeometry args={[0.14, 0.009, 6, 32]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.9}
              transparent
              opacity={0.55 * r.fade}
              roughness={0.2}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

function CurvedEdge({
  from,
  to,
  color,
}: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
}) {
  const geo = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    if (dir.length() < 0.5) return null;

    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    if (perp.length() < 0.001) perp.set(1, 0, 0);
    perp.normalize();

    const mid = a.clone().lerp(b, 0.5).addScaledVector(perp, CURVATURE * dir.length());
    const curve = new THREE.CatmullRomCurve3([a, mid, b]);
    const linePoints = curve.getPoints(48).map((p) => p.toArray() as [number, number, number]);

    return { curve, linePoints };
  }, [from, to]);

  if (!geo) return null;

  return (
    <>
      {/* The wire */}
      <Line points={geo.linePoints} color={color} lineWidth={0.7} transparent opacity={0.3} />
      {/* Magnetic field rings around it */}
      <MagneticField curve={geo.curve} color={color} />
    </>
  );
}

// ── Scene ──────────────────────────────────────────────────────────────────────

function Scene({
  nodes,
  edges,
  autoRotate,
  positions,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  autoRotate: boolean;
  positions: Map<string, [number, number, number]>;
}) {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[6, 8, 6]} intensity={0.6} castShadow />

      <OrbitControls autoRotate={autoRotate} autoRotateSpeed={0.5} makeDefault />

      {/* Soft contact shadows beneath the floating nodes */}
      <ContactShadows
        position={[0, -2.2, 0]}
        opacity={0.45}
        scale={8}
        blur={2.5}
        far={5}
        color="#000000"
      />

      {/* Edges rendered first so nodes paint over */}
      {edges.map((edge, i) => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return null;
        return (
          <CurvedEdge
            key={i}
            from={from}
            to={to}
            color={edge.color ?? "#4a5a6a"}
          />
        );
      })}

      {nodes.map((node, i) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        return (
          <NodeSphere
            key={node.id}
            basePosition={pos}
            color={node.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
            label={node.label}
            phase={i * 2.1}
            active={node.active ?? false}
          />
        );
      })}
    </>
  );
}

// ── AppGraph3D ─────────────────────────────────────────────────────────────────

export function AppGraph3D({
  nodes,
  edges,
  title,
  className,
  autoRotate = true,
}: AppGraph3DProps) {
  const positions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    const manual = nodes.filter((n) => n.position);
    const auto = nodes.filter((n) => !n.position);

    manual.forEach((n) => map.set(n.id, n.position!));

    const radius = Math.max(2, auto.length * 0.6);
    fibonacciSphere(auto.length, radius).forEach((pos, i) =>
      map.set(auto[i].id, pos),
    );

    return map;
  }, [nodes]);

  return (
    <div className={cn("flex flex-col gap-2 w-full h-full", className)}>
      {title && (
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      )}
      <div className="flex-1 rounded-lg overflow-hidden border border-border bg-background">
        <Canvas camera={{ position: [5, 3, 5], fov: 55 }} gl={{ alpha: true }} shadows>
          <Scene
            nodes={nodes}
            edges={edges}
            autoRotate={autoRotate}
            positions={positions}
          />
        </Canvas>
      </div>
    </div>
  );
}
