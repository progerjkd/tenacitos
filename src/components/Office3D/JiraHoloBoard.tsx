'use client';

import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { priorityColor, type JiraIssue } from '@/lib/jira';
import { BOARD_COLUMNS, BOARD_POSITION, groupIssues, truncate, type BoardColumn } from './layout';

const BOARD_WIDTH = 10.4;
const BOARD_HEIGHT = 5.6;
const COLUMN_WIDTH = 3.1;
const COLUMN_X: Record<BoardColumn, number> = { 'To Do': -3.45, 'In Progress': 0, Done: 3.45 };
const COLUMN_COLORS: Record<BoardColumn, string> = {
  'To Do': '#94a3b8',
  'In Progress': '#38bdf8',
  Done: '#4ade80',
};
const MAX_CARDS = 5;
const CARD_HEIGHT = 0.62;
const CARD_GAP = 0.14;

function IssueCard({ issue, y }: { issue: JiraIssue; y: number }) {
  const [hovered, setHovered] = useState(false);

  return (
    <group
      position={[0, y, 0.02]}
      scale={hovered ? 1.03 : 1}
      onClick={(e) => {
        e.stopPropagation();
        window.open(issue.url, '_blank', 'noopener,noreferrer');
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
      <mesh>
        <planeGeometry args={[COLUMN_WIDTH - 0.2, CARD_HEIGHT]} />
        <meshBasicMaterial color={hovered ? '#16283f' : '#0e1e33'} transparent opacity={0.92} />
      </mesh>
      {/* Priority accent on the left edge */}
      <mesh position={[-(COLUMN_WIDTH - 0.2) / 2 + 0.03, 0, 0.01]}>
        <planeGeometry args={[0.06, CARD_HEIGHT - 0.08]} />
        <meshBasicMaterial color={priorityColor(issue.priority)} toneMapped={false} />
      </mesh>
      <Text
        position={[-(COLUMN_WIDTH - 0.2) / 2 + 0.14, CARD_HEIGHT / 2 - 0.14, 0.01]}
        fontSize={0.12}
        color="#7dd3fc"
        anchorX="left"
        anchorY="middle"
      >
        {issue.key}
      </Text>
      {issue.assignee && (
        <Text
          position={[(COLUMN_WIDTH - 0.2) / 2 - 0.12, CARD_HEIGHT / 2 - 0.14, 0.01]}
          fontSize={0.1}
          color="#64748b"
          anchorX="right"
          anchorY="middle"
        >
          {issue.assignee.displayName}
        </Text>
      )}
      <Text
        position={[-(COLUMN_WIDTH - 0.2) / 2 + 0.14, -0.03, 0.01]}
        fontSize={0.115}
        color="#e2e8f0"
        anchorX="left"
        anchorY="middle"
        maxWidth={COLUMN_WIDTH - 0.45}
      >
        {truncate(issue.summary, 64)}
      </Text>
    </group>
  );
}

function BoardColumnView({ column, issues }: { column: BoardColumn; issues: JiraIssue[] }) {
  const columnTop = BOARD_HEIGHT / 2 - 1.15;
  const overflow = issues.length - MAX_CARDS;

  return (
    <group position={[COLUMN_X[column], 0, 0.01]}>
      {/* Column backdrop */}
      <mesh position={[0, -0.35, 0]}>
        <planeGeometry args={[COLUMN_WIDTH, BOARD_HEIGHT - 1.5]} />
        <meshBasicMaterial color="#0b1730" transparent opacity={0.45} />
      </mesh>
      {/* Header */}
      <mesh position={[-COLUMN_WIDTH / 2 + 0.16, columnTop + 0.42, 0.02]}>
        <circleGeometry args={[0.05, 16]} />
        <meshBasicMaterial color={COLUMN_COLORS[column]} toneMapped={false} />
      </mesh>
      <Text
        position={[-COLUMN_WIDTH / 2 + 0.3, columnTop + 0.42, 0.02]}
        fontSize={0.17}
        letterSpacing={0.12}
        color={COLUMN_COLORS[column]}
        anchorX="left"
        anchorY="middle"
      >
        {column.toUpperCase()}
      </Text>
      <Text
        position={[COLUMN_WIDTH / 2 - 0.16, columnTop + 0.42, 0.02]}
        fontSize={0.15}
        color="#64748b"
        anchorX="right"
        anchorY="middle"
      >
        {String(issues.length)}
      </Text>

      {issues.slice(0, MAX_CARDS).map((issue, i) => (
        <IssueCard
          key={issue.id}
          issue={issue}
          y={columnTop - 0.1 - i * (CARD_HEIGHT + CARD_GAP) - CARD_HEIGHT / 2}
        />
      ))}
      {overflow > 0 && (
        <Text
          position={[0, columnTop - 0.1 - MAX_CARDS * (CARD_HEIGHT + CARD_GAP) - 0.1, 0.02]}
          fontSize={0.12}
          color="#64748b"
          anchorX="center"
          anchorY="middle"
        >
          {`+${overflow} more`}
        </Text>
      )}
      {issues.length === 0 && (
        <Text
          position={[0, columnTop - 0.5, 0.02]}
          fontSize={0.12}
          color="#334155"
          anchorX="center"
          anchorY="middle"
        >
          —
        </Text>
      )}
    </group>
  );
}

interface JiraHoloBoardProps {
  issues: JiraIssue[];
  offline: boolean;
}

/**
 * Wall-scale holographic NEURALOPS kanban floating at the back of the deck.
 * Cards deep-link to Jira; the footer opens the full /jira page.
 */
export default function JiraHoloBoard({ issues, offline }: JiraHoloBoardProps) {
  const group = useRef<THREE.Group>(null);
  const grouped = groupIssues(issues);
  const [footerHovered, setFooterHovered] = useState(false);

  useFrame(({ clock }) => {
    if (group.current) {
      group.current.position.y = BOARD_POSITION[1] + Math.sin(clock.elapsedTime * 0.6) * 0.06;
    }
  });

  return (
    <group ref={group} position={BOARD_POSITION}>
      {/* Backplate + frame */}
      <mesh>
        <planeGeometry args={[BOARD_WIDTH, BOARD_HEIGHT]} />
        <meshBasicMaterial color="#020617" transparent opacity={0.6} />
      </mesh>
      {(
        [
          [0, BOARD_HEIGHT / 2, BOARD_WIDTH, 0.04],
          [0, -BOARD_HEIGHT / 2, BOARD_WIDTH, 0.04],
        ] as const
      ).map(([x, y, w, h], i) => (
        <mesh key={`h${i}`} position={[x, y, 0.01]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial color="#22d3ee" toneMapped={false} transparent opacity={0.9} />
        </mesh>
      ))}
      {(
        [
          [-BOARD_WIDTH / 2, 0, 0.04, BOARD_HEIGHT],
          [BOARD_WIDTH / 2, 0, 0.04, BOARD_HEIGHT],
        ] as const
      ).map(([x, y, w, h], i) => (
        <mesh key={`v${i}`} position={[x, y, 0.01]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial color="#22d3ee" toneMapped={false} transparent opacity={0.9} />
        </mesh>
      ))}

      {/* Header */}
      <Text
        position={[0, BOARD_HEIGHT / 2 - 0.45, 0.02]}
        fontSize={0.4}
        letterSpacing={0.25}
        color="#67e8f9"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.01}
        outlineColor="#0e7490"
      >
        NEURALOPS BOARD
      </Text>

      {offline ? (
        <Text position={[0, 0, 0.02]} fontSize={0.28} letterSpacing={0.2} color="#f87171">
          BOARD FEED OFFLINE
        </Text>
      ) : (
        BOARD_COLUMNS.map((column) => (
          <BoardColumnView key={column} column={column} issues={grouped[column]} />
        ))
      )}

      {/* Footer link to the full board */}
      <Text
        position={[0, -BOARD_HEIGHT / 2 + 0.28, 0.02]}
        fontSize={0.14}
        letterSpacing={0.1}
        color={footerHovered ? '#a5f3fc' : '#475569'}
        anchorX="center"
        anchorY="middle"
        onClick={(e) => {
          e.stopPropagation();
          window.location.assign('/jira');
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setFooterHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setFooterHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        OPEN FULL BOARD ↗
      </Text>

      <pointLight position={[0, 0, 2]} color="#22d3ee" intensity={4} distance={9} decay={2} />
    </group>
  );
}
