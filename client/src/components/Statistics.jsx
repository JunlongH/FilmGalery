import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area
} from 'recharts';

const API = process.env.REACT_APP_API_BASE || 'http://127.0.0.1:4000';

function StatCard({ title, value, sub, trend }) {
  return (
    <div style={{ 
      background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)', 
      padding: '28px', 
      borderRadius: '16px', 
      border: '1px solid #e2e8f0',
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      transition: 'transform 0.2s, box-shadow 0.2s'
    }}
    onMouseEnter={e => {
      e.currentTarget.style.transform = 'translateY(-2px)';
      e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)';
    }}
    onMouseLeave={e => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)';
    }}>
      <div style={{ fontSize: '13px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: '40px', fontWeight: 800, margin: '12px 0 4px', color: '#1e293b', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '14px', color: '#64748b', marginTop: '4px' }}>{sub}</div>}
      {trend && <div style={{ fontSize: '12px', color: trend > 0 ? '#10b981' : '#ef4444', marginTop: '8px', fontWeight: 600 }}>{trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%</div>}
    </div>
  );
}

export default function Statistics({ mode = 'stats' }) {
  const { data: summary } = useQuery({
    queryKey: ['stats-summary'],
    queryFn: () => fetch(`${API}/api/stats/summary`).then(r => r.json())
  });

  const { data: gear } = useQuery({
    queryKey: ['stats-gear'],
    queryFn: () => fetch(`${API}/api/stats/gear`).then(r => r.json())
  });

  const { data: activity } = useQuery({
    queryKey: ['stats-activity'],
    queryFn: () => fetch(`${API}/api/stats/activity`).then(r => r.json())
  });

  const { data: costs } = useQuery({
    queryKey: ['stats-costs'],
    queryFn: () => fetch(`${API}/api/stats/costs`).then(r => r.json()),
    enabled: mode === 'spending'
  });

  const { data: locations } = useQuery({
    queryKey: ['stats-locations'],
    queryFn: () => fetch(`${API}/api/stats/locations`).then(r => r.json())
  });

  const { data: temporal } = useQuery({
    queryKey: ['stats-temporal'],
    queryFn: () => fetch(`${API}/api/stats/temporal`).then(r => r.json())
  });

  const { data: themes } = useQuery({
    queryKey: ['stats-themes'],
    queryFn: () => fetch(`${API}/api/stats/themes`).then(r => r.json())
  });

  const isSpending = mode === 'spending';

  const filmShare = (gear?.films || []).map(f => ({ name: f.name, value: f.count }));
  const cameraShare = (gear?.cameras || []).map(c => ({ name: c.name, value: c.count }));
  
  // Calculate lens percentages
  const lensData = gear?.lenses || [];
  const totalLensUsage = lensData.reduce((sum, l) => sum + l.count, 0);
  const lensPercentage = lensData
    .map(l => ({
      name: l.name,
      percentage: totalLensUsage > 0 ? Math.round((l.count / totalLensUsage) * 100) : 0
    }))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 6);
  
  // Refined complementary color palette - soft but distinct
  const palette = [
    '#6366f1', // Soft Indigo
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#ec4899', // Pink
    '#8b5cf6', // Purple
    '#14b8a6', // Teal
    '#f97316', // Orange
    '#06b6d4', // Cyan
    '#a855f7', // Violet
    '#84cc16', // Lime
    '#ef4444', // Red
    '#3b82f6'  // Blue
  ];
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayData = (temporal?.byDay || []).map(d => ({ day: dayNames[d.day], count: d.count }));
  
  const photosPerRoll = summary?.total_rolls > 0 ? Math.round((summary?.total_photos || 0) / summary.total_rolls) : 0;
  
  const themesShare = (themes || []).slice(0, 8).map(t => ({ name: t.name, value: t.photo_count }));
  
  const costBreakdown = costs?.summary ? [
    { name: 'Purchase', value: Math.round(costs.summary.total_purchase || 0) },
    { name: 'Development', value: Math.round(costs.summary.total_develop || 0) }
  ] : [];

  const chartCard = {
    background: 'linear-gradient(135deg, #ffffff 0%, #fafbfc 100%)',
    padding: '24px',
    borderRadius: '20px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
    transition: 'box-shadow 0.3s'
  };

  return (
    <div style={{ padding: '24px 48px 80px', maxWidth: '1400px', margin: '0 auto', background: '#f8f9fa' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '32px', margin: 0, fontWeight: 800, color: '#1e293b' }}>{isSpending ? 'Spending Analysis' : 'Statistics Overview'}</h2>
        <div className="segmented-control" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <a className={`segment-btn ${!isSpending ? 'active' : ''}`} href="#/stats" style={{ fontWeight: 600 }}>Overview</a>
          <a className={`segment-btn ${isSpending ? 'active' : ''}`} href="#/spending" style={{ fontWeight: 600 }}>Spending</a>
        </div>
      </div>

      {!isSpending && (
        <>
          {/* Key Metrics Cards - Priority Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(200px, 1fr))', gap: '20px', marginBottom: '48px' }}>
            <StatCard title="Total Rolls" value={summary?.total_rolls || 0} />
            <StatCard title="Total Photos" value={summary?.total_photos || 0} />
            <StatCard title="Total Spending" value={`¥${Math.round(summary?.total_cost || 0)}`} sub="Purchase + Development" />
            <StatCard 
              title="Avg Cost/Roll" 
              value={`¥${summary?.total_rolls ? Math.round((summary?.total_cost || 0) / summary.total_rolls) : 0}`}
              sub="Per roll investment"
            />
          </div>

          {/* Shooting Activity - Most Important */}
          <div style={{ ...chartCard, marginBottom: '48px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Shooting Activity Over Time</h3>
            <div style={{ height: '340px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activity || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="month" 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    tickLine={{ inside: true, stroke: '#cbd5e1' }}
                    orientation="bottom"
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <XAxis 
                    xAxisId="top"
                    orientation="top"
                    axisLine={{ stroke: '#e2e8f0' }}
                    tick={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    tickLine={{ inside: true, stroke: '#cbd5e1' }}
                    orientation="left"
                    axisLine={{ stroke: '#e2e8f0' }}
                    allowDecimals={false}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    axisLine={{ stroke: '#e2e8f0' }}
                    tick={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={3} fill="url(#colorActivity)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gear Analysis Row - Lenses & Films */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginBottom: '48px' }}>
            <div style={chartCard}>
              <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Top Lenses</h3>
              <div style={{ height: '320px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={lensPercentage} layout="vertical" margin={{ left: 10, right: 50, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                    <XAxis 
                      type="number" 
                      domain={[0, 100]}
                      ticks={[0, 20, 40, 60, 80, 100]}
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickLine={{ inside: true, stroke: '#cbd5e1' }}
                      axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <XAxis 
                      xAxisId="top"
                      type="number"
                      orientation="top"
                      domain={[0, 100]}
                      axisLine={{ stroke: '#e2e8f0' }}
                      tick={false}
                      tickLine={false}
                    />
                    <YAxis 
                      dataKey="name" 
                      type="category" 
                      width={150} 
                      tick={{ fontSize: 13, fill: '#334155', fontWeight: 600 }}
                      tickLine={{ inside: true, stroke: '#cbd5e1' }}
                      axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      formatter={(value) => `${value}%`}
                    />
                    <Bar dataKey="percentage" fill="#8b5cf6" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', top: '50%', right: '15px', transform: 'translateY(-50%)', fontSize: '12px', fontWeight: 600, color: '#64748b' }}>%</div>
              </div>
            </div>

            <div style={chartCard}>
              <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Film Distribution</h3>
              <div style={{ height: '320px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={filmShare.slice(0, 6)} 
                      dataKey="value" 
                      nameKey="name" 
                      cx="45%" 
                      cy="50%" 
                      innerRadius={55} 
                      outerRadius={90} 
                      paddingAngle={2}
                    >
                      {filmShare.slice(0, 6).map((entry, index) => (
                        <Cell key={`cell-f-${index}`} fill={palette[index % palette.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', left: 'calc(45% + 120px)', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {filmShare.slice(0, 6).map((entry, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: palette[index % palette.length] }}></div>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Temporal Patterns & Camera Share Row */}
          {/* Temporarily disabled: Day of Week Pattern
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '32px', marginBottom: '48px' }}>
            <div style={chartCard}>
              <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Shooting by Day of Week</h3>
              <div style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dayData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 13, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                    <Tooltip 
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          */}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '32px', marginBottom: '48px' }}>
            <div style={chartCard}>
              <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Camera Usage Distribution</h3>
              <div style={{ height: '320px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={cameraShare.slice(0, 6)} 
                      dataKey="value" 
                      nameKey="name" 
                      cx="45%" 
                      cy="50%" 
                      innerRadius={65} 
                      outerRadius={105} 
                      paddingAngle={2}
                    >
                      {cameraShare.slice(0, 6).map((entry, index) => (
                        <Cell key={`cell-c-${index}`} fill={palette[index % palette.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', left: 'calc(45% + 135px)', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {cameraShare.slice(0, 6).map((entry, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: palette[index % palette.length] }}></div>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Locations Word Cloud & Themes Pie */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
            <div style={chartCard}>
              <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Top Shooting Locations</h3>
              <div style={{ height: '300px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '20px' }}>
                {(locations || []).slice(0, 15).map((loc, index) => {
                  const maxCount = Math.max(...(locations || []).map(l => l.photo_count));
                  const minSize = 14;
                  const maxSize = 48;
                  const fontSize = minSize + ((loc.photo_count / maxCount) * (maxSize - minSize));
                  return (
                    <span 
                      key={index} 
                      style={{ 
                        fontSize: `${fontSize}px`, 
                        fontWeight: 700, 
                        color: palette[index % palette.length],
                        cursor: 'pointer',
                        transition: 'transform 0.2s',
                        lineHeight: 1.2
                      }}
                      title={`${loc.city_name}: ${loc.photo_count} photos`}
                      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      {loc.city_name}
                    </span>
                  );
                })}
              </div>
            </div>

            <div style={chartCard}>
              <h3 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Popular Themes</h3>
              <div style={{ height: '300px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={themesShare} 
                      dataKey="value" 
                      nameKey="name" 
                      cx="45%" 
                      cy="50%" 
                      innerRadius={48} 
                      outerRadius={80} 
                      paddingAngle={2}
                    >
                      {themesShare.map((entry, index) => (
                        <Cell key={`cell-t-${index}`} fill={palette[index % palette.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', left: 'calc(45% + 110px)', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {themesShare.map((entry, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: palette[index % palette.length] }}></div>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {isSpending && (
        <>
          {/* Spending Summary Cards - Include key overview metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '24px', marginBottom: '48px' }}>
            <StatCard 
              title="Total Spending" 
              value={`¥${Math.round((costs?.summary?.total_purchase || 0) + (costs?.summary?.total_develop || 0))}`}
              sub="Purchase + Development"
            />
            <StatCard 
              title="Avg Cost/Roll" 
              value={`¥${costs?.summary?.roll_count ? Math.round(((costs?.summary?.total_purchase || 0) + (costs?.summary?.total_develop || 0)) / costs.summary.roll_count) : 0}`}
              sub="Per roll investment"
            />
            <StatCard 
              title="Total Purchase" 
              value={`¥${Math.round(costs?.summary?.total_purchase || 0)}`}
              sub="Film stock investment"
            />
            <StatCard 
              title="Total Development" 
              value={`¥${Math.round(costs?.summary?.total_develop || 0)}`}
              sub="Lab processing"
            />
          </div>

          {/* Cost Breakdown Pie & Monthly Trend */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr', gap: '32px', marginBottom: '48px' }}>
            <div style={chartCard}>
              <h3 style={{ marginTop: 0, marginBottom: '24px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Cost Breakdown</h3>
              <div style={{ height: '340px', position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie 
                      data={costBreakdown} 
                      dataKey="value" 
                      nameKey="name" 
                      cx="35%" 
                      cy="50%" 
                      innerRadius={75} 
                      outerRadius={120} 
                      paddingAngle={3}
                    >
                      <Cell fill="#10b981" />
                      <Cell fill="#f59e0b" />
                    </Pie>
                    <Tooltip 
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      formatter={(value) => `¥${value}`}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: 'absolute', left: 'calc(35% + 150px)', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {costBreakdown.map((entry, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: index === 0 ? '#10b981' : '#f59e0b' }}></div>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>{entry.name}: ¥{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={chartCard}>
              <h3 style={{ marginTop: 0, marginBottom: '24px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Monthly Spending Trend</h3>
              <div style={{ height: '340px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={costs?.monthly || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorPurchase" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorDevelop" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="month" 
                      tick={{ fontSize: 12, fill: '#64748b' }} 
                      tickLine={{ inside: true, stroke: '#cbd5e1' }}
                      axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <XAxis 
                      xAxisId="top"
                      orientation="top"
                      axisLine={{ stroke: '#e2e8f0' }}
                      tick={false}
                      tickLine={false}
                    />
                    <YAxis 
                      tick={{ fontSize: 12, fill: '#64748b' }} 
                      tickLine={{ inside: true, stroke: '#cbd5e1' }}
                      axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      axisLine={{ stroke: '#e2e8f0' }}
                      tick={false}
                      tickLine={false}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      formatter={(value) => `¥${value}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 13, fontWeight: 600 }} />
                    <Area type="monotone" dataKey="purchase" stroke="#10b981" strokeWidth={2} fill="url(#colorPurchase)" name="Purchase" />
                    <Area type="monotone" dataKey="develop" stroke="#f59e0b" strokeWidth={2} fill="url(#colorDevelop)" name="Development" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Spending by Film */}
          <div style={chartCard}>
            <h3 style={{ marginTop: 0, marginBottom: '24px', fontSize: '18px', fontWeight: 700, color: '#334155' }}>Spending by Film Type</h3>
            <div style={{ height: '360px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={costs?.byFilm || []} margin={{ top: 10, right: 10, left: 0, bottom: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    angle={-20} 
                    height={80}
                    tickLine={{ inside: true, stroke: '#cbd5e1' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <XAxis 
                    xAxisId="top"
                    orientation="top"
                    axisLine={{ stroke: '#e2e8f0' }}
                    tick={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#64748b' }} 
                    tickLine={{ inside: true, stroke: '#cbd5e1' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    axisLine={{ stroke: '#e2e8f0' }}
                    tick={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    formatter={(value) => `¥${value}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 13, fontWeight: 600 }} />
                  <Bar dataKey="purchase" fill="#10b981" radius={[8, 8, 0, 0]} name="Purchase" stackId="cost" />
                  <Bar dataKey="develop" fill="#f59e0b" radius={[8, 8, 0, 0]} name="Development" stackId="cost" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
