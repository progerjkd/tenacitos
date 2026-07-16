'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';

/**
 * The holographic core at the center of the deck — the visual anchor all
 * agent pods face.
 */
export default function CentralCore() {
  const rings = useRef<THREE.Group>(null);
  const heart = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (rings.current) {
      rings.current.rotation.y = t * 0.35;
      rings.current.children.forEach((ring, i) => {
        ring.rotation.x = t * (0.2 + i * 0.13) + i;
      });
    }
    if (heart.current) {
      heart.current.rotation.y = -t * 0.5;
      const pulse = 1 + Math.sin(t * 2.2) * 0.06;
      heart.current.scale.setScalar(pulse);
    }
  });

  return (
    <group>
      {/* Light beam — kept short so it never crosses the Jira board behind it */}
      <mesh position={[0, 2.4, 0]}>
        <cylinderGeometry args={[0.45, 0.7, 4.8, 24, 1, true]} />
        <meshBasicMaterial
          color="#22d3ee"
          transparent
          opacity={0.12}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* Pulsing heart */}
      <mesh ref={heart} position={[0, 2.6, 0]}>
        <icosahedronGeometry args={[0.55, 1]} />
        <meshStandardMaterial
          color="#06b6d4"
          emissive="#22d3ee"
          emissiveIntensity={2.4}
          flatShading
          toneMapped={false}
        />
      </mesh>

      {/* Orbiting gyroscope rings */}
      <group ref={rings} position={[0, 2.6, 0]}>
        {[1.0, 1.35, 1.7].map((radius, i) => (
          <mesh key={i}>
            <torusGeometry args={[radius, 0.02, 8, 64]} />
            <meshBasicMaterial
              color={i === 1 ? '#a5f3fc' : '#22d3ee'}
              transparent
              opacity={0.8}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      <Sparkles count={40} scale={[3, 5, 3]} position={[0, 3, 0]} size={3} speed={0.8} color="#a5f3fc" />

      {/* Base pedestal */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[1.5, 1.8, 0.2, 48]} />
        <meshStandardMaterial color="#0b1220" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.21, 0]}>
        <ringGeometry args={[1.2, 1.4, 48]} />
        <meshStandardMaterial
          color="#22d3ee"
          emissive="#22d3ee"
          emissiveIntensity={1.8}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <pointLight position={[0, 3, 0]} color="#22d3ee" intensity={12} distance={14} decay={2} />
    </group>
  );
}
