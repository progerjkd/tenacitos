'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { OfficeAgent } from './useOfficeData';
import { ACTIVITY_VISUALS, truncate, type AgentActivity } from './layout';

/**
 * Draw the agent's emoji onto a canvas texture — troika (drei Text) can't
 * render color emoji, native canvas fonts can.
 */
function useEmojiTexture(emoji: string): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [emoji]);
}

/** Strip the "ACTIVE: " / "IDLE: " prefixes the office API adds to tasks. */
function taskText(task: string): string {
  return truncate(task.replace(/^(ACTIVE|IDLE|SLEEPING):\s*/, ''), 60);
}

interface HoloAvatarProps {
  agent: OfficeAgent;
  activity: AgentActivity;
}

/**
 * Holographic agent: levitating core orb with counter-rotating rings, emoji
 * badge, name plate and a task bubble while working. Rendered inside the
 * desk group, standing behind the desk facing the central core.
 */
export default function HoloAvatar({ agent, activity }: HoloAvatarProps) {
  const visual = ACTIVITY_VISUALS[activity];
  const body = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const emojiTexture = useEmojiTexture(agent.emoji);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (body.current) {
      body.current.position.y = 1.35 + Math.sin(t * visual.pulseSpeed) * 0.09;
      body.current.rotation.y = t * 0.4 * visual.pulseSpeed;
    }
    if (ringA.current) ringA.current.rotation.x = t * visual.pulseSpeed * 0.9;
    if (ringB.current) ringB.current.rotation.z = -t * visual.pulseSpeed * 0.7;
  });

  const showTask = activity === 'working' && !!agent.currentTask;

  return (
    <group position={[0, 0, -1.7]}>
      <group ref={body}>
        {/* Core orb */}
        <mesh>
          <icosahedronGeometry args={[0.3, 1]} />
          <meshStandardMaterial
            color={agent.color}
            emissive={agent.color}
            emissiveIntensity={visual.glow}
            flatShading
            toneMapped={false}
            transparent
            opacity={visual.opacity}
          />
        </mesh>
        {/* Containment shell */}
        <mesh>
          <sphereGeometry args={[0.44, 16, 16]} />
          <meshBasicMaterial
            color={agent.color}
            wireframe
            transparent
            opacity={0.18 * visual.opacity}
          />
        </mesh>
        {/* Gyro rings */}
        <mesh ref={ringA}>
          <torusGeometry args={[0.56, 0.012, 8, 48]} />
          <meshBasicMaterial
            color={agent.color}
            transparent
            opacity={0.7 * visual.opacity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh ref={ringB} rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[0.66, 0.008, 8, 48]} />
          <meshBasicMaterial
            color={agent.color}
            transparent
            opacity={0.5 * visual.opacity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>

      {/* Emoji badge */}
      {emojiTexture && (
        <sprite position={[0, 2.25, 0]} scale={[0.55, 0.55, 1]}>
          <spriteMaterial map={emojiTexture} transparent opacity={visual.opacity} depthWrite={false} />
        </sprite>
      )}

      {/* Name plate */}
      <Billboard position={[0, 2.72, 0]}>
        <Text
          fontSize={0.24}
          color="#f8fafc"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.01}
          outlineColor="#0f172a"
          fillOpacity={Math.max(visual.opacity, 0.6)}
        >
          {agent.name}
        </Text>
        <Text
          position={[0, -0.06, 0]}
          fontSize={0.12}
          letterSpacing={0.15}
          color={visual.indicator}
          anchorX="center"
          anchorY="top"
        >
          {visual.label}
        </Text>
      </Billboard>

      {/* Task bubble */}
      {showTask && (
        <Billboard position={[0, 3.25, 0]}>
          <mesh>
            <planeGeometry args={[2.6, 0.42]} />
            <meshBasicMaterial color="#020617" transparent opacity={0.72} depthWrite={false} />
          </mesh>
          <Text
            position={[0, 0, 0.01]}
            fontSize={0.11}
            color="#a5f3fc"
            anchorX="center"
            anchorY="middle"
            maxWidth={2.4}
            textAlign="center"
          >
            {taskText(agent.currentTask!)}
          </Text>
        </Billboard>
      )}
    </group>
  );
}
