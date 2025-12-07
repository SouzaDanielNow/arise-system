import React from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { Stats } from '../types';

interface StatRadarProps {
  stats: Stats;
}

const StatRadar: React.FC<StatRadarProps> = ({ stats }) => {
  const data = [
    { subject: 'INT', A: stats.intelligence, fullMark: 100 },
    { subject: 'PER', A: stats.perception, fullMark: 100 },
    { subject: 'VIT', A: stats.vitality, fullMark: 100 },
    { subject: 'AGI', A: stats.agility, fullMark: 100 },
  ];

  return (
    <div className="w-full h-48 sm:h-64 relative">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid stroke="#1e293b" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 'bold' }} />
          <Radar
            name="Hunter Stats"
            dataKey="A"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="#3b82f6"
            fillOpacity={0.4}
          />
        </RadarChart>
      </ResponsiveContainer>
      {/* Decorative Grid Lines */}
      <div className="absolute inset-0 pointer-events-none border border-system-blue/10 rounded-lg"></div>
    </div>
  );
};

export default StatRadar;
