'use client';
import { useState, useEffect, useRef } from 'react';
import type { VehicleData } from '@/types';
import { useLiveTracking, groupByCategory } from '@/hooks/useLiveTracking';
import VehicleKpiCard from './VehicleKpiCard';
import VehicleModal   from './VehicleModal';

// Category display config
const CATEGORY_META: Record<string, { icon: string; color: string }> = {
  'Tipper':        { icon: '🚛', color: '#c88018' },
  'Diesel Tanker': { icon: '🛢',  color: '#c88018' },
  'Excavator':     { icon: '🦾', color: '#28a08c' },
  'Grader':        { icon: '🚜', color: '#3880c0' },
  'Dozer':         { icon: '🏗',  color: '#8060c0' },
  'JCB':           { icon: '🔧', color: '#c05838' },
  'Compactor':     { icon: '⚙',  color: '#409850' },
  'Hydra':         { icon: '🏗',  color: '#2898c0' },
  'Drill':         { icon: '⛏',  color: '#b04060' },
};
const CATEGORY_ORDER = [
  'Tipper', 'Diesel Tanker', 'Excavator', 'Grader',
  'Dozer', 'JCB', 'Compactor', 'Hydra', 'Drill',
];

export default function LiveTrackingSection() {
  const { data, loading, error, lastUpdated } = useLiveTracking();
  const [selected, setSelected] = useState<VehicleData | null>(null);
  const [phase, setPhase]       = useState(0);
  const rafRef                  = useRef<number>(0);
  const phaseRef                = useRef(0);

  // Shared animation loop — drives all canvas tanks
  useEffect(() => {
    const loop = () => {
      // phase step: base 0.010, faster when max speed is high
      const maxSpd = data?.vehicles.reduce((m, v) => Math.max(m, v.avg_speed), 0) ?? 0;
      phaseRef.current += 0.010 + (Math.min(maxSpd, 120) / 120) * 0.012;
      setPhase(phaseRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [data]);

  if (loading) {
    return (
      <div className="lt-loading">
        <div className="lt-spinner" />
        <span>Loading fleet data…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lt-error">
        <span>⚠ Failed to load fleet data: {error}</span>
      </div>
    );
  }

  const grouped   = groupByCategory(data?.vehicles ?? []);
  const activeCount = data?.vehicles.filter(v => v.has_data && v.engine_hours > 0).length ?? 0;

  return (
    <div className="lt-section">

      {/* Section header */}
      <div className="lt-header">
        <div className="lt-header-left">
          <h2 className="lt-title">Live Fleet Tracking</h2>
          <div className="lt-live-badge">
            <span className="live-dot" />
            Live · 1 min sync
          </div>
        </div>
        <div className="lt-header-right">
          <span className="lt-stat">{activeCount} active</span>
          <span className="lt-stat-sep">·</span>
          <span className="lt-stat">{data?.count ?? 0} total</span>
          {lastUpdated && (
            <>
              <span className="lt-stat-sep">·</span>
              <span className="lt-updated">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Category groups */}
      {CATEGORY_ORDER
        .filter(cat => grouped[cat]?.length)
        .map(cat => {
          const vehicles = grouped[cat];
          const meta     = CATEGORY_META[cat] ?? { icon: '🚗', color: '#c88018' };
          const dataCount = vehicles.filter(v => v.has_data).length;

          return (
            <div key={cat} className="lt-category">
              <div className="lt-cat-header">
                <span className="lt-cat-icon">{meta.icon}</span>
                <span className="lt-cat-name" style={{ color: meta.color }}>
                  {cat}s
                </span>
                <div className="lt-cat-line" />
                <span className="lt-cat-count">{dataCount} / {vehicles.length} with data</span>
              </div>

              <div className="lt-grid">
                {vehicles.map(v => (
                  <VehicleKpiCard
                    key={v.vehicle_desc}
                    vehicle={v}
                    phase={phase}
                    onClick={setSelected}
                  />
                ))}
              </div>
            </div>
          );
        })
      }

      {/* Modal */}
      {selected && (
        <VehicleModal
          vehicle={selected}
          phase={phase}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
