'use client';

import dynamic from 'next/dynamic';

const Office3D = dynamic(() => import('@/components/Office3D/Office3D'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-[#020617] flex items-center justify-center">
      <div className="text-center text-cyan-300">
        <div className="text-4xl mb-4 animate-pulse">🛰️</div>
        <p className="text-sm font-mono tracking-[0.3em] opacity-80">BOOTING NEURALOPS HQ…</p>
      </div>
    </div>
  ),
});

export default function OfficePage() {
  return <Office3D />;
}
