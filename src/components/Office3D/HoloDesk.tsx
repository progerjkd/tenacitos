'use client';

import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { OfficeAgent } from './useOfficeData';
import { ACTIVITY_VISUALS, agentActivity, type DeskPlacement } from './layout';
import HoloAvatar from './HoloAvatar';

const SCREEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Scrolling "glyph rain" — columns of random blocks streaming over scanlines
const SCREEN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    float col = floor(vUv.x * 22.0);
    float speed = mix(0.05, 0.28, hash(col * 7.31));
    float y = fract(vUv.y + uTime * speed + hash(col) * 13.7);
    float block = step(hash(col * 57.0 + floor(y * 16.0)), 0.42);
    float head = smoothstep(0.15, 0.0, y) * 1.6;
    float scan = 0.85 + 0.15 * sin(vUv.y * 240.0 + uTime * 6.0);

    // Fade at panel edges so the hologram has no hard border
    float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x)
               * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);

    float brightness = (block * (0.35 + head) * scan) * edge * uIntensity;
    gl_FragColor = vec4(uColor * brightness, brightness * 0.9);
  }
`;

function HoloScreen({ color, intensity }: { color: string; intensity: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SCREEN_VERTEX,
        fragmentShader: SCREEN_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(color) },
          uIntensity: { value: intensity },
        },
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [color, intensity],
  );

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  // Open-ended cylinder segment → curved screen wrapping toward the agent
  return (
    <mesh position={[0, 1.65, -0.45]} material={material}>
      <cylinderGeometry args={[1.0, 1.0, 0.7, 32, 1, true, -0.55, 1.1]} />
    </mesh>
  );
}

interface HoloDeskProps {
  agent: OfficeAgent;
  placement: DeskPlacement;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * One agent pod: floating glass desk, curved holo-screen, floor status ring
 * and the agent's holographic avatar behind the desk facing the core.
 */
export default function HoloDesk({ agent, placement, isSelected, onClick }: HoloDeskProps) {
  const activity = agentActivity(agent);
  const visual = ACTIVITY_VISUALS[activity];
  const ring = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame(({ clock }) => {
    if (ring.current) {
      const mat = ring.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity =
        visual.glow * (0.7 + 0.3 * Math.sin(clock.elapsedTime * visual.pulseSpeed * 2));
    }
  });

  const highlight = hovered || isSelected;

  return (
    <group
      position={placement.position}
      rotation={[0, placement.rotationY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {/* Floating glass slab */}
      <mesh position={[0, 1.0, 0]} scale={highlight ? 1.04 : 1}>
        <boxGeometry args={[2.3, 0.06, 0.95]} />
        <meshStandardMaterial
          color="#1e3a5f"
          metalness={0.4}
          roughness={0.15}
          transparent
          opacity={0.38 * visual.opacity}
        />
      </mesh>
      {/* Edge trim in the agent's color, all four sides so the glass reads as a slab */}
      {(
        [
          [0, 0.49, 2.3, 0.02],
          [0, -0.49, 2.3, 0.02],
          [-1.15, 0, 0.02, 0.97],
          [1.15, 0, 0.02, 0.97],
        ] as const
      ).map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 1.0, z]}>
          <boxGeometry args={[w, 0.04, d]} />
          <meshStandardMaterial
            color={agent.color}
            emissive={agent.color}
            emissiveIntensity={visual.glow}
            toneMapped={false}
            transparent
            opacity={visual.opacity}
          />
        </mesh>
      ))}

      {/* Anti-grav emitters under the slab */}
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} position={[x, 0.55, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.14, 20]} />
          <meshBasicMaterial
            color={agent.color}
            transparent
            opacity={0.5 * visual.opacity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Holo-screen streams only while the agent has any life in it */}
      {activity !== 'offline' && (
        <HoloScreen color={agent.color} intensity={activity === 'working' ? 0.9 : 0.45} />
      )}

      {/* Floor status ring, directly under the avatar */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, -1.7]}>
        <ringGeometry args={[1.15, 1.3, 48]} />
        <meshStandardMaterial
          color={agent.color}
          emissive={agent.color}
          emissiveIntensity={visual.glow}
          toneMapped={false}
          transparent
          opacity={0.85 * visual.opacity}
          side={THREE.DoubleSide}
        />
      </mesh>

      <HoloAvatar agent={agent} activity={activity} />
    </group>
  );
}
