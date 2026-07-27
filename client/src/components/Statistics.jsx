import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  CartesianGrid, PieChart, Pie, Cell, Legend,
  AreaChart, Area
} from 'recharts';
import WordCloud from './WordCloud';
import { API_BASE as API } from '../api';
import { getCacheStrategy } from '../lib';
import { StatCard, ChartCard, StatsModeToggle } from './Statistics/';
import { useNavigate } from 'react-router-dom';
import { Camera, Image, DollarSign, TrendingUp, Package, Wallet, AlertTriangle, Store, Aperture, Tag } from 'lucide-react';

const formatStat = (val) => {
  const num = Number(val);
  if (isNaN(num)) return '0';
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
};

// 统计数据缓存策略
const statsCache = getCacheStrategy('stats');

/**
 * Statistics - 统计仪表盘
 *
 * Props:
 *   - workspace: 'film'（默认）| 'digital' — 工作区选择，所有查询附带 ?mode=<workspace>
 *   - view: 'stats'（默认）| 'spending' — 视图切换（仅胶片工作区使用，开销看板）
 */
export default function Statistics({ workspace = 'film', view = 'stats' }) {
  const isSpending = view === 'spending';
  const ws = workspace === 'digital' ? 'digital' : 'film';
  const isDigital = ws === 'digital';
  const modeQs = `?mode=${ws}`;

  const { data: summary } = useQuery({ queryKey: ['stats-summary', ws], queryFn: () => fetch(`${API}/api/stats/summary${modeQs}`).then(r => r.json()), ...statsCache });
  const { data: gear } = useQuery({ queryKey: ['stats-gear', ws], queryFn: () => fetch(`${API}/api/stats/gear${modeQs}`).then(r => r.json()), ...statsCache });
  // 胶片：按胶卷统计的拍摄活动；数码：按月统计的照片数量（同构 [{month, count}]）
  const { data: activity } = useQuery({
    queryKey: ['stats-activity', ws],
    queryFn: () => fetch(isDigital ? `${API}/api/stats/digital/monthly` : `${API}/api/stats/activity?mode=film`).then(r => r.json()),
    ...statsCache
  });
  const { data: costs } = useQuery({ queryKey: ['stats-costs'], queryFn: () => fetch(`${API}/api/stats/costs`).then(r => r.json()), enabled: isSpending, ...statsCache });
  const { data: locations } = useQuery({ queryKey: ['stats-locations', ws], queryFn: () => fetch(`${API}/api/stats/locations${modeQs}`).then(r => r.json()).catch(() => []), ...statsCache });
  const { data: themes } = useQuery({ queryKey: ['stats-themes', ws], queryFn: () => fetch(`${API}/api/stats/themes${modeQs}`).then(r => r.json()), ...statsCache });
  const { data: inventory } = useQuery({ queryKey: ['stats-inventory'], queryFn: () => fetch(`${API}/api/stats/inventory`).then(r => r.json()), enabled: !isDigital, ...statsCache });
  // 数码专属：相机分布
  const { data: digitalCameras } = useQuery({
    queryKey: ['stats-digital-cameras'],
    queryFn: () => fetch(`${API}/api/stats/digital/cameras`).then(r => r.json()),
    enabled: isDigital,
    ...statsCache
  });

  // Ensure locations is always an array
  const locationsArray = Array.isArray(locations) ? locations : [];

  const filmShare = (gear?.films || []).map(f => ({ name: f.name, value: f.count }));
  const cameraShare = (gear?.cameras || []).map(c => ({ name: c.name, value: c.count }));
  const digitalCamerasShare = (Array.isArray(digitalCameras) ? digitalCameras : [])
    .map(c => ({ name: c.camera_name, value: c.count }));
  
  const lensData = gear?.lenses || [];
  const totalLensUsage = lensData.reduce((sum, l) => sum + l.count, 0);
  const lensPercentage = lensData
    .map(l => ({
      name: l.name,
      percentage: totalLensUsage > 0 ? Number(((l.count / totalLensUsage) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 6);
  
  const palette = [
    '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', 
    '#f97316', '#06b6d4', '#a855f7', '#84cc16', '#ef4444', '#3b82f6'
  ];
  
  const themesShare = (themes || []).slice(0, 8).map(t => ({ name: t.name, value: t.photo_count }));
  const locationWords = (locationsArray.slice(0, 30) || []).map((l) => ({ text: l.city_name, weight: l.photo_count }));
  
  const costBreakdown = costs?.summary ? [
    { name: 'Purchase', value: Number(costs.summary.total_purchase || 0) },
    { name: 'Development', value: Number(costs.summary.total_develop || 0) }
  ] : [];

  const monthlySeries = React.useMemo(() => {
    const raw = Array.isArray(costs?.monthly) ? costs.monthly : [];
    if (!raw.length) return [];
    const parsed = raw.map(d => {
        const monthStr = (d.month || '').slice(0, 7);
        const dt = new Date(`${monthStr}-01T00:00:00Z`);
        if (!monthStr || Number.isNaN(dt.getTime())) return null;
        return { month: monthStr, date: dt, purchase: Number(d.purchase || 0), develop: Number(d.develop || 0) };
      }).filter(Boolean).sort((a, b) => a.date - b.date);

    if (!parsed.length) return [];
    const start = parsed[0].date;
    const end = parsed[parsed.length - 1].date;
    const map = new Map(parsed.map(p => [p.month, p]));
    const series = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 7);
      const hit = map.get(key);
      series.push({ month: key, purchase: hit ? hit.purchase : 0, develop: hit ? hit.develop : 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return series;
  }, [costs?.monthly]);

  const monthlyTicks = monthlySeries.filter((_, idx) => idx % 2 === 0).map(d => d.month);
  const navigate = useNavigate();
  const handleModeChange = (mode) => navigate(mode === 'spending' ? '/spending' : '/stats');

  return (
    <div className="w-full min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 lg:p-8 space-y-8 animate-fade-in pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-700 pb-6">
        <div>
          <h2 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
            {isSpending ? 'Spending Analysis' : 'Statistics Dashboard'}
          </h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">
             {isSpending ? 'Track your film photography expenses and investment' : isDigital ? '数码照片库总览' : 'Comprehensive overview of your photography journey'}
          </p>
        </div>
        {!isDigital && <StatsModeToggle mode={isSpending ? 'spending' : 'stats'} onModeChange={handleModeChange} />}
      </div>

      {!isSpending ? (
        <div className="space-y-8 w-full">
          {/* Key Metrics Cards - use inline grid for reliable alignment */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '16px',
            width: '100%'
          }}>
            {isDigital ? (
              <>
                <StatCard title="照片总数" value={summary?.total_digital_photos || 0} icon={Image} color="success" />
                <StatCard title="相机" value={cameraShare.length} sub="Distinct models" icon={Camera} color="info" />
                <StatCard title="镜头" value={lensData.length} sub="Distinct lenses" icon={Aperture} color="indigo" />
                <StatCard title="主题" value={(themes || []).length} sub="Themes in use" icon={Tag} color="warning" />
              </>
            ) : (
              <>
                <StatCard title="Total Rolls" value={summary?.total_rolls || 0} icon={Camera} color="info" />
                <StatCard title="Total Photos" value={summary?.total_photos || 0} icon={Image} color="success" />
                <StatCard title="Total Spending" value={summary?.total_cost || 0} prefix="¥" sub="Est. Value" icon={DollarSign} color="warning" />
                <StatCard
                  title="Avg Cost/Roll"
                  value={summary?.total_rolls ? (summary?.total_cost || 0) / summary.total_rolls : 0}
                  prefix="¥"
                  sub="Per roll investment"
                  icon={TrendingUp}
                  color="indigo"
                />
              </>
            )}
          </div>

          {/* Activity Chart - Full width */}
          <ChartCard title={isDigital ? '拍摄活动' : 'Shooting Activity'} subtitle={isDigital ? '按月统计照片数量' : 'Rolls shot over time'} height={280}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activity || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--heroui-divider)" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--heroui-foreground)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--heroui-foreground)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)', color: 'var(--heroui-foreground)' }} />
                  <Area type="monotone" dataKey="count" stroke="#6366f1" fillOpacity={1} fill="url(#colorActivity)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Inventory Section (film-only) */}
          {!isDigital && (
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 px-1 flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" /> Inventory Status
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: '16px',
                width: '100%'
              }}>
                 <StatCard title="In Stock" value={inventory?.value?.total_count || 0} sub="Rolls ready to shoot" icon={Package} color="teal" />
                 <StatCard title="Inventory Value" value={inventory?.value?.total_value || 0} prefix="¥" sub="Total asset value" icon={Wallet} color="info" />
                 <StatCard title="Expiring Soon" value={inventory?.expiring?.length || 0} sub="Within 180 days" trend={inventory?.expiring?.length > 0 ? -10 : 0} icon={AlertTriangle} color="danger" />
                 <StatCard title="Top Channel" value={inventory?.channels?.[0]?.purchase_channel || '-'} sub={inventory?.channels?.[0] ? `${formatStat(inventory.channels[0].count)} rolls` : ''} icon={Store} color="secondary" />
              </div>
            </div>
          )}

          {/* Equipment & Themes Grid - 2x2 layout */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.5rem', width: '100%' }}>
            <ChartCard title="Top Lenses" subtitle="Most used" height={280}>
                <ResponsiveContainer width="100%" height="100%">                 
                  <BarChart data={lensPercentage} layout="vertical" margin={{ left: 10, right: 30, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--heroui-divider)" />
                    <XAxis type="number" domain={[0, 100]} hide />
                    <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11, fill: 'var(--heroui-foreground)' }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{fill: 'var(--heroui-content2)'}} contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)' }} formatter={(val) => `${val}%`} />
                    <Bar dataKey="percentage" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            {isDigital ? (
              /* 数码专属面板：相机分布 */
              <ChartCard title="相机分布" subtitle="按照片数量统计" height={280}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={digitalCamerasShare.slice(0, 6)} dataKey="value" nameKey="name" cx="35%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3}>
                        {digitalCamerasShare.slice(0, 6).map((entry, index) => <Cell key={`cell-dc-${index}`} fill={palette[index % palette.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)' }} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 12, paddingLeft: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
              </ChartCard>
            ) : (
              <ChartCard title="Camera Usage" subtitle="By photo count" height={280}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={cameraShare.slice(0, 6)} dataKey="value" nameKey="name" cx="35%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3}>
                        {cameraShare.slice(0, 6).map((entry, index) => <Cell key={`cell-c-${index}`} fill={palette[index % palette.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)' }} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 12, paddingLeft: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
              </ChartCard>
            )}

            {!isDigital && (
              <ChartCard title="Film Type" subtitle="By photo count" height={280}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={filmShare.slice(0, 6)} dataKey="value" nameKey="name" cx="35%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3}>
                        {filmShare.slice(0, 6).map((entry, index) => <Cell key={`cell-f-${index}`} fill={palette[index % palette.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)' }} />
                      <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 12, paddingLeft: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
              </ChartCard>
            )}

            <ChartCard title="Popular Themes" subtitle="Classification" height={280}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={themesShare} dataKey="value" nameKey="name" cx="35%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3}>
                      {themesShare.map((entry, index) => <Cell key={`cell-t-${index}`} fill={palette[index % palette.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)' }} />
                    <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 12, paddingLeft: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Locations */}
          <ChartCard title="Top Locations" subtitle="Based on photo count" height={280}>
             <div className="w-full h-full flex items-center justify-center">
                <WordCloud words={locationWords} width={800} height={240} minSize={14} maxSize={48} palette={palette} />
             </div>
          </ChartCard>
        </div>
      ) : (
        <div className="space-y-8 w-full min-w-0">
           {/* Spending Content - Equal width cards */}
           <div style={{
             display: 'grid',
             gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
             gap: '16px',
             width: '100%'
           }}>
             <StatCard title="Total Spending" value={(costs?.summary?.total_purchase || 0) + (costs?.summary?.total_develop || 0)} prefix="¥" sub="Purchase + Development" icon={Wallet} color="rose" />
             <StatCard title="Avg Cost/Roll" value={costs?.summary?.roll_count ? ((costs?.summary?.total_purchase || 0) + (costs?.summary?.total_develop || 0)) / costs.summary.roll_count : 0} prefix="¥" sub="Per roll investment" icon={TrendingUp} color="indigo" />
             <StatCard title="Total Purchase" value={costs?.summary?.total_purchase || 0} prefix="¥" sub="Film stock" icon={Package} color="warning" />
             <StatCard title="Total Development" value={costs?.summary?.total_develop || 0} prefix="¥" sub="Lab processing" icon={Store} color="info" />
           </div>

           {/* Charts - 2 column equal width layout like Statistics page */}
           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.5rem', width: '100%' }}>
             <ChartCard title="Cost Breakdown" subtitle="Purchase vs Development" height={340}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={costBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                      <Cell fill="#10b981" />
                      <Cell fill="#f59e0b" />
                    </Pie>
                    <Tooltip formatter={(value) => `¥${formatStat(value)}`} contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)' }} />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
             </ChartCard>

             <ChartCard title="Monthly Spending Trend" subtitle="Stacked area chart" height={340}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlySeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--heroui-divider)" />
                    <XAxis dataKey="month" ticks={monthlyTicks} tick={{ fontSize: 12, fill: 'var(--heroui-foreground)' }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(val) => formatStat(val)} tick={{ fontSize: 12, fill: 'var(--heroui-foreground)' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)' }} formatter={(val) => `¥${formatStat(val)}`} />
                    <Area type="monotone" dataKey="purchase" stroke="#10b981" strokeWidth={2} fill="url(#colorPurchase)" name="Purchase" />
                    <Area type="monotone" dataKey="develop" stroke="#f59e0b" strokeWidth={2} fill="url(#colorDevelop)" name="Development" />
                  </AreaChart>
                </ResponsiveContainer>
             </ChartCard>
           </div>
           
           <ChartCard title="Avg Cost per Roll by Film" subtitle="Compare film stock value" height={360}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(costs?.byFilm || []).map(f => ({ name: f.name, avgTotal: f.rolls ? Number(((f.purchase || 0) + (f.develop || 0)) / f.rolls) : 0, avgPurchase: f.rolls ? Number((f.purchase || 0) / f.rolls) : 0, avgDevelop: f.rolls ? Number((f.develop || 0) / f.rolls) : 0 }))} margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--heroui-divider)" />
                  <XAxis dataKey="name" angle={-30} textAnchor="end" interval={0} height={70} tick={{ fontSize: 12, fill: 'var(--heroui-foreground)' }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(val) => formatStat(val)} tick={{ fontSize: 12, fill: 'var(--heroui-foreground)' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--heroui-content1)', borderColor: 'var(--heroui-divider)' }} formatter={(val) => `¥${formatStat(val)}`} />
                  <Legend verticalAlign="top"/>
                  <Bar dataKey="avgPurchase" stackId="avg" fill="#10b981" radius={[0, 0, 0, 0]} name="Avg Purchase" />
                  <Bar dataKey="avgDevelop" stackId="avg" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Avg Development" />
                </BarChart>
              </ResponsiveContainer>
           </ChartCard>
        </div>
      )}
    </div>
  );
}