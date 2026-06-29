'use client';

import dynamic from 'next/dynamic';

const Office3D = dynamic(() => import('@/components/Office3D/Office3D'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-gray-900 flex items-center justify-center">
      <div className="text-center text-white">
        <div className="text-4xl mb-4">🏢</div>
        <p className="text-lg font-medium opacity-70">Loading The Office...</p>
      </div>
    </div>
  ),
});

export default function OfficePage() {
  return <Office3D />;
}
