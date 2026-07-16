'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { ROOM_RADIUS } from './layout';

const FLOOR_VERTEX = /* glsl */ `
  varying vec2 vWorldXZ;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldXZ = worldPos.xz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FLOOR_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  varying vec2 vWorldXZ;

  float gridLine(vec2 p, float cell) {
    vec2 g = abs(fract(p / cell - 0.5) - 0.5) / fwidth(p / cell);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    float dist = length(vWorldXZ);
    float fade = 1.0 - smoothstep(uRadius * 0.55, uRadius, dist);

    float minor = gridLine(vWorldXZ, 1.0) * 0.18;
    float major = gridLine(vWorldXZ, 5.0) * 0.5;

    // Energy pulse radiating out from the central core
    float pulse = sin(dist * 0.9 - uTime * 1.6) * 0.5 + 0.5;
    pulse = pow(pulse, 4.0) * (1.0 - smoothstep(0.0, uRadius, dist)) * 0.35;

    vec3 base = vec3(0.008, 0.02, 0.05);
    vec3 lineColor = vec3(0.13, 0.83, 0.93);
    vec3 color = base + lineColor * (minor + major) * fade + lineColor * pulse;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function NeonFloor() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FLOOR_VERTEX,
        fragmentShader: FLOOR_FRAGMENT,
        uniforms: {
          uTime: { value: 0 },
          uRadius: { value: ROOM_RADIUS },
        },
      }),
    [],
  );

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} material={material}>
      <circleGeometry args={[ROOM_RADIUS, 96]} />
    </mesh>
  );
}

/** Emissive pylons with light strips ringing the deck perimeter. */
function PerimeterPylons() {
  const pylons = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => {
        const theta = (i / 10) * Math.PI * 2 + Math.PI / 10;
        return {
          position: [
            Math.sin(theta) * (ROOM_RADIUS - 0.6),
            1.6,
            Math.cos(theta) * (ROOM_RADIUS - 0.6),
          ] as [number, number, number],
          rotationY: Math.atan2(-Math.sin(theta), -Math.cos(theta)),
        };
      }),
    [],
  );

  return (
    <group>
      {pylons.map((pylon, i) => (
        <group key={i} position={pylon.position} rotation={[0, pylon.rotationY, 0]}>
          <mesh>
            <boxGeometry args={[0.22, 3.2, 0.22]} />
            <meshStandardMaterial color="#0b1220" metalness={0.7} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0, 0.13]}>
            <boxGeometry args={[0.05, 3.0, 0.02]} />
            <meshStandardMaterial
              color="#22d3ee"
              emissive="#22d3ee"
              emissiveIntensity={1.6}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      {/* Glowing rim of the deck */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[ROOM_RADIUS - 0.25, ROOM_RADIUS, 96]} />
        <meshStandardMaterial
          color="#0e7490"
          emissive="#22d3ee"
          emissiveIntensity={1.1}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** Slowly drifting ambient dust so the void feels alive. */
function AmbientDust() {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.elapsedTime * 0.01;
  });
  return (
    <group ref={group}>
      <Sparkles
        count={140}
        scale={[ROOM_RADIUS * 1.6, 8, ROOM_RADIUS * 1.6]}
        position={[0, 4, 0]}
        size={2.2}
        speed={0.35}
        color="#67e8f9"
        opacity={0.55}
      />
    </group>
  );
}

export default function OfficeEnvironment() {
  return (
    <group>
      <Stars radius={90} depth={45} count={3500} factor={3.5} saturation={0.4} fade speed={0.6} />
      <NeonFloor />
      <PerimeterPylons />
      <AmbientDust />
    </group>
  );
}
