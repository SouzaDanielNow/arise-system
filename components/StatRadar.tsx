import React from 'react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { CustomStat } from '../types';

interface StatRadarProps {
  customStats: CustomStat[];
}

const StatRadar: React.FC<StatRadarProps> = ({ customStats }) => {
  const data = customStats.map(s => ({
    subject: `${s.emoji} ${s.name}`,
    A: s.value,
    fullMark: 100,
  }));

  return (
    <div className="w-full h-48 sm:h-64 relative">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid stroke="#1e293b" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 'bold' }} />
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
      <div className="absolute inset-0 pointer-events-none border border-system-blue/10 rounded-lg"></div>
    </div>
  );
};

export default StatRadar;
