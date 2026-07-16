'use client';

import { Canvas } from '@react-three/fiber';
import { Billboard, OrbitControls, Text } from '@react-three/drei';
import { Suspense, useMemo, useState } from 'react';
import { computeDeskLayout, ACTIVITY_VISUALS } from './layout';
import { useOfficeData } from './useOfficeData';
import OfficeEnvironment from './Environment';
import CentralCore from './CentralCore';
import HoloDesk from './HoloDesk';
import JiraHoloBoard from './JiraHoloBoard';
import AgentInfoPanel from './AgentInfoPanel';
import FirstPersonControls from './FirstPersonControls';

function FeedBadge({ label, offline }: { label: string; offline: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wider border ${
        offline
          ? 'text-red-400 border-red-500/40'
          : 'text-emerald-400 border-emerald-500/30'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${offline ? 'bg-red-400' : 'bg-emerald-400 animate-pulse'}`}
      />
      {label} {offline ? 'OFFLINE' : 'LIVE'}
    </span>
  );
}

export default function Office3D() {
  const { agents, issues, loadingAgents, agentsError, jiraError } = useOfficeData();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [controlMode, setControlMode] = useState<'orbit' | 'fps'>('orbit');

  const layout = useMemo(() => computeDeskLayout(agents.length), [agents.length]);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  return (
    <div className="fixed inset-0 bg-[#020617]" style={{ height: '100vh', width: '100vw' }}>
      <Canvas
        camera={{ position: [0, 10, 17], fov: 55 }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: '100%', height: '100%' }}
        onPointerMissed={() => setSelectedAgentId(null)}
      >
        <color attach="background" args={['#020617']} />
        <fog attach="fog" args={['#020617', 22, 60]} />

        <Suspense fallback={null}>
          <ambientLight intensity={0.3} />
          <hemisphereLight args={['#164e63', '#020617', 0.5]} />
          <directionalLight position={[8, 14, 6]} intensity={0.35} color="#a5f3fc" />

          <OfficeEnvironment />
          <CentralCore />

          {agents.map((agent, i) => (
            <HoloDesk
              key={agent.id}
              agent={agent}
              placement={layout[i]}
              isSelected={selectedAgentId === agent.id}
              onClick={() => setSelectedAgentId(agent.id)}
            />
          ))}

          {!loadingAgents && agents.length === 0 && (
            <Billboard position={[0, 5.5, 4]}>
              <Text fontSize={0.4} letterSpacing={0.25} color="#f87171">
                NO AGENTS DETECTED
              </Text>
            </Billboard>
          )}

          <JiraHoloBoard issues={issues} offline={jiraError} />

          {controlMode === 'orbit' ? (
            <OrbitControls
              enableDamping
              dampingFactor={0.05}
              minDistance={4}
              maxDistance={38}
              maxPolarAngle={Math.PI / 2.1}
              target={[0, 2, 0]}
            />
          ) : (
            <FirstPersonControls moveSpeed={6} />
          )}
        </Suspense>
      </Canvas>

      {selectedAgent && (
        <AgentInfoPanel agent={selectedAgent} onClose={() => setSelectedAgentId(null)} />
      )}

      {/* HUD — command console */}
      <div className="absolute top-4 left-4 z-30 rounded-2xl border border-cyan-500/30 bg-slate-950/70 backdrop-blur-md text-slate-100 p-4 w-64 shadow-[0_0_40px_rgba(34,211,238,0.12)]">
        <h2 className="text-base font-bold tracking-widest text-cyan-300 mb-1">
          🛰️ NEURALOPS HQ
        </h2>
        <p className="text-[11px] text-slate-400 mb-3">
          {loadingAgents
            ? 'Syncing agents…'
            : `${agents.length} agents on deck · ${issues.length} board issues`}
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <FeedBadge label="AGENTS" offline={agentsError} />
          <FeedBadge label="JIRA" offline={jiraError} />
        </div>
        <div className="text-xs text-slate-300 space-y-1 mb-3">
          {controlMode === 'orbit' ? (
            <>
              <p>🖱️ Drag: rotate · Scroll: zoom</p>
              <p>👆 Click a pod for agent details</p>
              <p>📌 Click a card to open its Jira issue</p>
            </>
          ) : (
            <>
              <p>Click canvas to lock cursor</p>
              <p>WASD / arrows: move · mouse: look</p>
              <p>Space: up · Shift: down · ESC: unlock</p>
            </>
          )}
        </div>
        <button
          onClick={() => setControlMode(controlMode === 'orbit' ? 'fps' : 'orbit')}
          className="w-full py-2 rounded-lg text-xs font-bold tracking-wider border border-cyan-400/40 text-cyan-300 hover:bg-cyan-400/10 transition-colors"
        >
          {controlMode === 'orbit' ? 'ENTER FPS MODE' : 'EXIT TO ORBIT'}
        </button>
      </div>

      {/* Status legend */}
      <div className="absolute bottom-4 left-4 z-30 rounded-xl border border-cyan-500/20 bg-slate-950/70 backdrop-blur-md text-slate-200 px-4 py-3">
        <div className="text-[11px] space-y-1.5">
          {(Object.keys(ACTIVITY_VISUALS) as Array<keyof typeof ACTIVITY_VISUALS>).map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${key === 'working' ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: ACTIVITY_VISUALS[key].indicator }}
              />
              <span className="tracking-wider">{ACTIVITY_VISUALS[key].label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
