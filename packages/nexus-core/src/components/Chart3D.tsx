import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Text } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "../utils";

export type Chart3DType = "scatter" | "bar";

export interface Chart3DPoint {
  x: number;
  y: number;
  z: number;
  label?: string;
  color?: string;
}

interface Chart3DProps {
  type?: Chart3DType;
  data: Chart3DPoint[];
  title?: string;
  className?: string;
  autoRotate?: boolean;
}

// ── 3D Bar ────────────────────────────────────────────────────────────────────

function Bar3D({ x, z, height, color }: { x: number; z: number; height: number; color: string }) {
  return (
    <mesh position={[x, height / 2, z]} castShadow>
      <boxGeometry args={[0.6, Math.max(height, 0.05), 0.6]} />
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
    </mesh>
  );
}

// ── 3D Scatter point ──────────────────────────────────────────────────────────

function ScatterPoint({ position, color }: { position: [number, number, number]; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.5;
  });

  return (
    <mesh ref={ref} position={position} castShadow>
      <sphereGeometry args={[0.15, 16, 16]} />
      <meshStandardMaterial color={color} roughness={0.3} metalness={0.2} />
    </mesh>
  );
}

// ── Normalise helper ──────────────────────────────────────────────────────────

function normalise(val: number, min: number, max: number, outMin: number, outMax: number) {
  if (max === min) return (outMin + outMax) / 2;
  return ((val - min) / (max - min)) * (outMax - outMin) + outMin;
}

const DEFAULT_COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#f87171", "#a78bfa"];

// ── Scene ─────────────────────────────────────────────────────────────────────

function Scene({ type, data, autoRotate }: { type: Chart3DType; data: Chart3DPoint[]; autoRotate: boolean }) {
  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const zs = data.map((d) => d.z);

  const bounds = useMemo(() => ({
    xMin: Math.min(...xs), xMax: Math.max(...xs),
    yMin: Math.min(...ys), yMax: Math.max(...ys),
    zMin: Math.min(...zs), zMax: Math.max(...zs),
  }), [xs, ys, zs]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
      <OrbitControls autoRotate={autoRotate} autoRotateSpeed={0.8} makeDefault />
      <Grid infiniteGrid fadeDistance={20} fadeStrength={1.5} cellColor="#444" sectionColor="#666" />

      {data.map((point, i) => {
        const nx = normalise(point.x, bounds.xMin, bounds.xMax, -4, 4);
        const ny = normalise(point.y, bounds.yMin, bounds.yMax, 0, 4);
        const nz = normalise(point.z, bounds.zMin, bounds.zMax, -4, 4);
        const color = point.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];

        if (type === "bar") {
          return <Bar3D key={i} x={nx} z={nz} height={ny} color={color} />;
        }

        return <ScatterPoint key={i} position={[nx, ny, nz]} color={color} />;
      })}

      {data.map((point, i) =>
        point.label ? (
          <Text
            key={`label-${i}`}
            position={[
              normalise(point.x, bounds.xMin, bounds.xMax, -4, 4),
              normalise(point.y, bounds.yMin, bounds.yMax, 0, 4) + 0.4,
              normalise(point.z, bounds.zMin, bounds.zMax, -4, 4),
            ]}
            fontSize={0.2}
            color="#888"
            anchorX="center"
            anchorY="bottom"
          >
            {point.label}
          </Text>
        ) : null
      )}
    </>
  );
}

// ── Chart3D ───────────────────────────────────────────────────────────────────

export function Chart3D({
  type = "scatter",
  data,
  title,
  className,
  autoRotate = true,
}: Chart3DProps) {
  return (
    <div className={cn("flex flex-col gap-2 w-full h-full", className)}>
      {title && (
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      )}
      <div className="flex-1 rounded-lg overflow-hidden border border-border bg-[#0a0a0a]">
        <Canvas camera={{ position: [6, 5, 6], fov: 50 }} shadows>
          <Scene type={type} data={data} autoRotate={autoRotate} />
        </Canvas>
      </div>
    </div>
  );
}
