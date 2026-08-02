import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { getCacheStrategy } from '../lib';
import {
  getCameras, createCamera, updateCamera, deleteCamera, uploadCameraImage,
  getLenses, createLens, updateLens, deleteLens, uploadLensImage,
  getFlashes, createFlash, updateFlash, deleteFlash, uploadFlashImage,
  getScanners, createScanner, updateScanner, deleteScanner, uploadScannerImage,
  getFilmBacks, createFilmBack, updateFilmBack, deleteFilmBack, uploadFilmBackImage,
  getFilms, createFilm, updateFilm, deleteFilm, uploadFilmImage,
  getEquipmentRelatedRolls, buildUploadUrl
} from '../api';
import { addCacheKey } from '../utils/imageOptimization';
import { useNavigate } from 'react-router-dom';
import { Button } from '@heroui/react';
import ModalDialog from './ModalDialog';
import SearchInput from './shared/SearchInput';
import { EquipmentEditModal } from './EquipmentManager/index';
import EquipmentImportModal from './EquipmentManager/EquipmentImportModal';
import { Camera, Aperture, Zap, Box, Scan, Film, Plus, Edit2, Trash2, Upload, Package, ImageIcon, Download } from 'lucide-react';
import '../styles/forms.css';

const TABS = [
  { key: 'cameras', label: 'Cameras', icon: Camera },
  { key: 'lenses', label: 'Lenses', icon: Aperture },
  { key: 'flashes', label: 'Flashes', icon: Zap },
  { key: 'film-backs', label: 'Film Backs', icon: Box },
  { key: 'scanners', label: 'Scanners', icon: Scan },
  { key: 'films', label: 'Films', icon: Film }
];

// 各 tab 的数据获取函数（模块级，保持 queryFn 引用稳定）
// cameras/lenses 接受 mode 过滤；其他类型忽略
const EQUIPMENT_FETCHERS = {
  cameras: (mode) => getCameras(mode && mode !== 'all' ? { mode } : {}),
  lenses: (mode) => getLenses(mode && mode !== 'all' ? { mode } : {}),
  flashes: () => getFlashes({}),
  'film-backs': () => getFilmBacks({}),
  scanners: () => getScanners({}),
  films: () => getFilms(),
};

// 需要 All/Film/Digital 子筛选的 tab
const FILTERABLE_TABS = new Set(['cameras', 'lenses']);
const SOURCE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'film', label: 'Film' },
  { key: 'digital', label: 'Digital' },
];

export default function EquipmentManager() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('cameras');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [relatedRolls, setRelatedRolls] = useState([]);
  const [loadingRolls, setLoadingRolls] = useState(false);

  // 设备数据统一走 React Query（STATIC 策略：设备库极少变化）
  const effectiveFilter = FILTERABLE_TABS.has(activeTab) ? sourceFilter : 'all';
  const { data: itemsData, isLoading: loading } = useQuery({
    queryKey: ['equipment', activeTab, effectiveFilter],
    queryFn: () => EQUIPMENT_FETCHERS[activeTab](effectiveFilter),
    ...getCacheStrategy('equipment'),
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => (Array.isArray(itemsData) ? itemsData : []), [itemsData]);

  // CRUD / 上传后刷新当前 tab 缓存
  const invalidateItems = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['equipment', activeTab, effectiveFilter] }),
    [queryClient, activeTab, effectiveFilter]
  );

  // Tab 切换时重置选择/搜索/子筛选（数据加载由 useQuery 自动处理）
  useEffect(() => {
    setSelectedId(null);
    setEditItem(null);
    setSearchQuery('');
    setSourceFilter('all');
  }, [activeTab]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(item => {
      const name = (item.name || '').toLowerCase();
      const brand = (item.brand || item.manufacturer || '').toLowerCase();
      return name.includes(query) || brand.includes(query);
    });
  }, [items, searchQuery]);

  const selectedItem = items.find(i => i.id === selectedId);

  // Fetch related rolls for selected equipment using API
  useEffect(() => {
    // Reset when no item selected
    if (!selectedItem || !selectedItem.id) {
      setRelatedRolls([]);
      setLoadingRolls(false);
      return;
    }
    
    // Map tab to equipment type for API
    const typeMap = {
      'cameras': 'camera',
      'lenses': 'lens',
      'flashes': 'flash',
      'film-backs': 'film-back',
      'scanners': 'scanner',
      'films': 'film'
    };
    const equipType = typeMap[activeTab];
    if (!equipType) {
      setRelatedRolls([]);
      return;
    }
    
    let isCancelled = false;
    setLoadingRolls(true);
    
    getEquipmentRelatedRolls(equipType, selectedItem.id, 12)
      .then(response => {
        if (isCancelled) return;
        // Ensure we always set an array
        const rolls = Array.isArray(response) ? response : [];
        setRelatedRolls(rolls);
      })
      .catch(err => {
        if (isCancelled) return;
        console.error('Failed to fetch related rolls:', err);
        setRelatedRolls([]);
      })
      .finally(() => {
        if (!isCancelled) setLoadingRolls(false);
      });
    
    // Cleanup function to prevent state updates after unmount
    return () => { isCancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id, activeTab]);

  const handleCreate = async (data) => {
    try {
      let created;
      switch (activeTab) {
        case 'cameras': created = await createCamera(data); break;
        case 'lenses': created = await createLens(data); break;
        case 'flashes': created = await createFlash(data); break;
        case 'film-backs': created = await createFilmBack(data); break;
        case 'scanners': created = await createScanner(data); break;
        case 'films': created = await createFilm(data); break;
        default: return;
      }
      await invalidateItems();
      setShowAddModal(false);
      setSelectedId(created.id);
    } catch (err) {
      console.error('Create failed:', err);
      alert('Failed to create item');
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      let updated;
      switch (activeTab) {
        case 'cameras': updated = await updateCamera(id, data); break;
        case 'lenses': updated = await updateLens(id, data); break;
        case 'flashes': updated = await updateFlash(id, data); break;
        case 'film-backs': updated = await updateFilmBack(id, data); break;
        case 'scanners': updated = await updateScanner(id, data); break;
        case 'films': updated = await updateFilm({ id, ...data }); break;
        default: return;
      }
      // Ensure updated item is valid and update local state
      if (updated && updated.id) {
        await invalidateItems();
      }
      setEditItem(null);
    } catch (err) {
      console.error('Update failed:', err);
      alert('Failed to update item');
    }
  };

  const handleDelete = async (id) => {
    try {
      switch (activeTab) {
        case 'cameras': await deleteCamera(id); break;
        case 'lenses': await deleteLens(id); break;
        case 'flashes': await deleteFlash(id); break;
        case 'film-backs': await deleteFilmBack(id); break;
        case 'scanners': await deleteScanner(id); break;
        case 'films': await deleteFilm(id); break;
        default: return;
      }
      await invalidateItems();
      if (selectedId === id) setSelectedId(null);
      setConfirmDelete(null);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete item');
    }
  };

  const handleImageUpload = async (id, file) => {
    try {
      switch (activeTab) {
        case 'cameras': await uploadCameraImage(id, file); break;
        case 'lenses': await uploadLensImage(id, file); break;
        case 'flashes': await uploadFlashImage(id, file); break;
        case 'film-backs': await uploadFilmBackImage(id, file); break;
        case 'scanners': await uploadScannerImage(id, file); break;
        case 'films': await uploadFilmImage(id, file); break;
        default: return;
      }
      await invalidateItems();
    } catch (err) {
      console.error('Image upload failed:', err);
      alert('Image upload failed');
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 animate-fade-in overflow-hidden">
      <div className="flex-1 flex flex-col p-6 lg:p-8 min-h-0 w-full overflow-hidden">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-700 pb-6 mb-6 flex-shrink-0">
          <div>
             <h2 className="text-3xl font-bold tracking-tight">Equipment Library</h2>
             <p className="text-zinc-500 dark:text-zinc-400 mt-1">Manage your cameras, lenses, flashes, and film formats</p>
          </div>
           <div className="flex items-center gap-2">
             {(activeTab === 'cameras' || activeTab === 'lenses') && (
               <Button
                 variant="flat"
                 onPress={() => setShowImportModal(true)}
                 startContent={<Download className="w-5 h-5" />}
               >
                 从照片导入
               </Button>
             )}
             <Button
               color="primary"
               onPress={() => setShowAddModal(true)}
               startContent={<Plus className="w-5 h-5" />}
             >
               Add {TABS.find(t => t.key === activeTab)?.label.slice(0, -1) || 'Item'}
             </Button>
           </div>
        </header>

        <div className="flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl mb-6 flex-shrink-0">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap
                  ${isActive 
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm' 
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700/50'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* All/Film/Digital 子筛选（仅 cameras/lenses） */}
        {FILTERABLE_TABS.has(activeTab) && (
          <div className="flex items-center gap-2 mb-4 flex-shrink-0">
            <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide mr-1">
              {activeTab === 'cameras' ? 'Body' : 'Workflow'}
            </span>
            {SOURCE_FILTERS.map(f => {
              const isActive = sourceFilter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setSourceFilter(f.key)}
                  className={`
                    px-3 py-1 rounded-full text-xs font-medium transition-all border
                    ${isActive
                      ? 'bg-primary text-white border-primary shadow-sm'
                      : 'bg-transparent text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-300 dark:hover:border-zinc-600'
                    }
                  `}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex gap-6 flex-1 min-h-0">
          {/* List Panel - Fixed 320px width */}
          <div className="w-80 flex-shrink-0 bg-zinc-50 dark:bg-zinc-800 rounded-xl shadow-none flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100vh - 260px)' }}>
            <div className="p-3 border-b border-zinc-200/50 dark:border-zinc-700/50 flex-shrink-0">
              <SearchInput
                placeholder={`Search ${activeTab}...`}
                value={searchQuery}
                onChange={setSearchQuery}
              />
            </div>

            <div className="flex-1 p-2 space-y-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}>
              {loading ? (
                <div className="py-12 flex justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>
              ) : filteredItems.length === 0 ? (
                <div className="py-20 text-center text-zinc-400 dark:text-zinc-500">
                   <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
                   <p>{searchQuery ? 'No matches found' : 'No items found'}</p>
                </div>
              ) : (
                filteredItems.map(item => (
                  <div
                    key={item.id}
                    onClick={() => { setSelectedId(item.id); setEditItem(null); }}
                    className={`
                      group p-3 rounded-lg cursor-pointer transition-all flex gap-3 border
                      ${selectedId === item.id 
                        ? 'bg-primary/10 border-primary/30 shadow-sm' 
                        : 'bg-transparent border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      }
                    `}
                  >
                    <div className="w-16 h-16 rounded-lg bg-zinc-100 dark:bg-zinc-800 overflow-hidden flex-shrink-0 flex items-center justify-center relative">
                      {(item.image_path || item.thumbPath) ? (
                        <img src={buildUploadUrl(item.image_path || item.thumbPath)} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        (() => { const Icon = TABS.find(t=>t.key===activeTab)?.icon; return Icon ? <Icon className="w-6 h-6 text-zinc-300 dark:text-zinc-600" /> : null; })()
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <h4 className={`font-semibold text-sm truncate ${selectedId === item.id ? 'text-primary' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {item.name || 'Unnamed'}
                      </h4>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">{item.brand || item.manufacturer || 'Unknown Brand'}</p>
                      <div className="flex items-center gap-2 mt-2">
                        {item.status && (
                           <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-semibold ${
                             item.status === 'owned' ? 'bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400' : 
                             item.status === 'wishlist' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400' :
                             'bg-zinc-500/10 text-zinc-600 border-zinc-500/20 dark:text-zinc-400'
                           }`}>{item.status}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="p-2 border-t border-zinc-200/50 dark:border-zinc-700/50 text-xs text-zinc-400 dark:text-zinc-500 text-center flex-shrink-0">
               {searchQuery ? `${filteredItems.length} of ${items.length}` : `${items.length} items`}
            </div>
          </div>

          {/* Detail Panel - Takes remaining space */}
          <div className="flex-1 bg-zinc-50 dark:bg-zinc-800 rounded-xl shadow-none flex flex-col overflow-hidden" style={{ maxHeight: 'calc(100vh - 260px)' }}>
            {selectedItem ? (
                <div className="p-6 lg:p-8 overflow-y-auto flex-1 animate-slide-in-right">
                   <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 mb-8">
                      <div className="w-32 h-32 rounded-2xl bg-zinc-100 dark:bg-zinc-800 overflow-hidden flex items-center justify-center shadow-lg relative group">
                        {(selectedItem.image_path || selectedItem.thumbPath) ? (
                           <img src={buildUploadUrl(selectedItem.image_path || selectedItem.thumbPath)} alt={selectedItem.name} className="w-full h-full object-cover" />
                        ) : (
                           (() => { const Icon = TABS.find(t=>t.key===activeTab)?.icon; return Icon ? <Icon className="w-12 h-12 text-zinc-300 dark:text-zinc-600" /> : null; })()
                        )}
                        <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white cursor-pointer transition-opacity">
                           <Upload className="w-6 h-6 mb-1" />
                           <span className="text-xs font-medium">Change</span>
                           <input type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files[0] && handleImageUpload(selectedItem.id, e.target.files[0])} />
                        </label>
                      </div>
                      
                      <div className="flex-1 pt-2">
                         <div className="flex justify-between items-start">
                            <div>
                               <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">{selectedItem.name}</h1>
                               <div className="text-xl text-zinc-500 dark:text-zinc-400">{selectedItem.brand || selectedItem.manufacturer}</div>
                            </div>
                            <div className="flex gap-2">
                               <button onClick={() => setEditItem(selectedItem)} className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                                  <Edit2 className="w-5 h-5" />
                               </button>
                               <button onClick={() => setConfirmDelete({id: selectedItem.id, name: selectedItem.name})} className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors">
                                  <Trash2 className="w-5 h-5" />
                               </button>
                            </div>
                         </div>
                      </div>
                   </div>
                   
                   <div className="mt-6">
                      <EquipmentDetails item={selectedItem} type={activeTab} />
                   </div>
                   
                   {/* Related Rolls Section */}
                   {(activeTab === 'cameras' || activeTab === 'lenses' || activeTab === 'films' || activeTab === 'scanners' || activeTab === 'flashes' || activeTab === 'film-backs') && (
                     <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-700">
                       <div className="flex items-center justify-between mb-4">
                         <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                           Related Rolls {!loadingRolls && `(${relatedRolls?.length || 0})`}
                         </h3>
                       </div>
                       {loadingRolls ? (
                         <div className="text-center py-8 text-zinc-400 dark:text-zinc-500">
                           <p className="text-sm">Loading related rolls...</p>
                         </div>
                       ) : (relatedRolls?.length > 0) ? (
                         <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
                           {relatedRolls.map(roll => (
                             <div
                               key={roll.id}
                               onClick={() => navigate(`/rolls/${roll.id}`)}
                               className="group cursor-pointer flex flex-col gap-1"
                             >
                               <div className="aspect-square rounded bg-zinc-100 dark:bg-zinc-800 overflow-hidden relative">
                                 {(roll.coverPath || roll.cover_photo) ? (
                                   <img src={addCacheKey(buildUploadUrl(roll.coverPath || roll.cover_photo), roll.updated_at)} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                                 ) : (
                                   <div className="w-full h-full flex items-center justify-center">
                                      <ImageIcon className="w-4 h-4 text-zinc-300 dark:text-zinc-600" />
                                   </div>
                                 )}
                                 <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                               </div>
                               <div className="min-w-0 text-center">
                                 <div className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300 truncate group-hover:text-primary transition-colors">
                                   {roll.title || `Roll #${roll.id}`}
                                 </div>
                               </div>
                             </div>
                           ))}
                         </div>
                       ) : (
                         <div className="text-center py-8 text-zinc-400 dark:text-zinc-500">
                           <p className="text-sm">No rolls found with this equipment</p>
                         </div>
                       )}
                     </div>
                   )}
                </div>
            ) : (
               <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500 p-8">
                  <div className="w-24 h-24 rounded-full bg-zinc-100/50 dark:bg-zinc-800/50 flex items-center justify-center mb-6">
                     {(() => { const Icon = TABS.find(t=>t.key===activeTab)?.icon; return Icon ? <Icon className="w-10 h-10 text-zinc-300 dark:text-zinc-600" /> : null; })()}
                  </div>
                  <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">No Item Selected</h3>
                  <p className="max-w-xs text-center">Select an item from the list to view details or click "Add New" to create one.</p>
               </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Add Equipment Modal */}
      <EquipmentEditModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        type={activeTab}
        isNew={true}
        onSave={handleCreate}
      />
      
      {/* Edit Equipment Modal */}
      <EquipmentEditModal
        isOpen={!!editItem}
        onClose={() => setEditItem(null)}
        type={activeTab}
        initialData={editItem || {}}
        isNew={false}
        onSave={async (data) => {
          if (editItem?.id) {
            await handleUpdate(editItem.id, data);
          }
        }}
      />
      
      {confirmDelete && (
        <ModalDialog isOpen title="Delete Item" message={`Are you sure you want to delete "${confirmDelete.name}"?`} type="confirm" onConfirm={() => handleDelete(confirmDelete.id)} onCancel={() => setConfirmDelete(null)} />
      )}

      <EquipmentImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onInvalidate={invalidateItems}
      />
    </div>
  );
}


function DetailRow({ label, value, capitalize }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
       <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">{label}</span>
       <span className={`text-sm text-zinc-900 dark:text-zinc-100 font-medium ${capitalize ? 'capitalize' : ''}`}>{value}</span>
    </div>
  );
}

// ========================================
function EquipmentDetails({ item, type }) {
  // Format production years
  const getProductionYears = () => {
    if (!item.production_year_start && !item.production_year_end) return null;
    if (item.production_year_start && item.production_year_end) {
      return `${item.production_year_start} - ${item.production_year_end}`;
    }
    if (item.production_year_start) return `${item.production_year_start} -`;
    return `- ${item.production_year_end}`;
  };

  // Config for what to show based on type
  const getSpecs = () => {
    const common = [
      { label: type === 'films' ? 'Manufacturer' : 'Brand', value: item.brand || item.manufacturer },
      { label: 'Model', value: item.model },
    ];

    const specific = {
      cameras: [
        { label: 'Type', value: item.type },
        { label: 'Format', value: item.format },
        { label: 'Lens Mount', value: item.mount },
        { label: 'Meter', value: item.meter_type },
        { label: 'Shutter Range', value: (item.shutter_speed_max || item.shutter_speed_min) ? `${item.shutter_speed_max || ''} - ${item.shutter_speed_min || ''}` : null },
        { label: 'Weight', value: item.weight_g ? `${item.weight_g}g` : null },
        { label: 'Battery', value: item.battery_type },
        { label: 'Production', value: getProductionYears() },
        { label: 'Built-in Flash', value: item.has_built_in_flash ? `Yes${item.flash_gn ? ` (GN ${item.flash_gn})` : ''}` : null },
        ...(item.has_fixed_lens ? [
           { label: 'Fixed Lens', value: 'Yes' },
           { label: 'Focal Length', value: item.fixed_lens_focal_length ? `${item.fixed_lens_focal_length}mm` : null },
           { label: 'Max Aperture', value: item.fixed_lens_max_aperture ? `f/${item.fixed_lens_max_aperture}` : null }
        ] : [])
      ],
      lenses: [
        { label: 'Mount', value: item.mount },
        { label: 'Focal Range', value: item.focal_length_min ? `${item.focal_length_min}${item.focal_length_max ? '-' + item.focal_length_max : ''}mm` : null },
        { label: 'Max Aperture', value: item.max_aperture ? `f/${item.max_aperture}${item.max_aperture_tele ? ` - f/${item.max_aperture_tele}` : ''}` : null },
        { label: 'Min Aperture', value: item.min_aperture ? `f/${item.min_aperture}` : null },
        { label: 'Focus Type', value: item.focus_type, capitalize: true },
        { label: 'Optical Design', value: (item.elements || item.groups) ? `${item.elements || '?'}片${item.groups || '?'}组` : null },
        { label: 'Filter Size', value: item.filter_size ? `${item.filter_size}mm` : null },
        { label: 'Aperture Blades', value: item.blade_count },
        { label: 'Min Focus', value: item.min_focus_distance ? `${item.min_focus_distance}m` : null },
        { label: 'Magnification', value: item.magnification_ratio },
        { label: 'Weight', value: item.weight_g ? `${item.weight_g}g` : null },
        { label: 'Production', value: getProductionYears() },
        { label: 'Macro', value: item.is_macro ? 'Yes' : null },
        { label: 'Stabilization', value: item.image_stabilization ? 'Yes' : null }
      ],
      films: [
        { label: 'ISO', value: item.iso },
        { label: 'Format', value: item.format },
        { label: 'Category', value: item.category },
        { label: 'Process', value: item.process }
      ],
      'film-backs': [
        { label: 'Format', value: item.format },
        { label: 'Frame Size', value: item.sub_format },
        { label: 'Frame Dimensions', value: (item.frame_width_mm || item.frame_height_mm) ? `${item.frame_width_mm || '?'} × ${item.frame_height_mm || '?'}mm` : null },
        { label: 'Mount', value: item.mount_type },
        { label: 'Magazine Type', value: item.magazine_type },
        { label: 'Frames/Roll', value: item.frames_per_roll },
        { label: 'Compatible Cameras', value: item.compatible_cameras },
        { label: 'Motorized', value: item.is_motorized ? 'Yes' : null },
        { label: 'Dark Slide', value: item.has_dark_slide !== 0 ? 'Yes' : 'No' }
      ],
      scanners: [
        { label: 'Type', value: item.type },
        { label: 'Max Resolution', value: item.max_resolution ? `${item.max_resolution} DPI` : null },
        { label: 'Sensor', value: item.sensor_type },
        { label: 'Bit Depth', value: item.bit_depth ? `${item.bit_depth}-bit` : null },
        { label: 'Formats', value: item.supported_formats },
        { label: 'Software', value: item.default_software },
        { label: 'IR Cleaning', value: item.has_infrared_cleaning ? 'Yes' : null }
      ],
      flashes: [
        { label: 'Guide Number', value: item.guide_number },
        { label: 'Power Source', value: item.power_source },
        { label: 'Recycle Time', value: item.recycle_time ? `${item.recycle_time}s` : null },
        { label: 'TTL', value: item.ttl_compatible ? 'Yes' : 'No' },
        { label: 'Auto Mode', value: item.has_auto_mode ? 'Yes' : null },
        { label: 'Swivel Head', value: item.swivel_head ? 'Yes' : null },
        { label: 'Bounce Head', value: item.bounce_head ? 'Yes' : null }
      ]
    };

    // Ownership info for all types
    const ownership = [
      { label: 'Status', value: item.status, capitalize: true },
      { label: 'Condition', value: item.condition },
      { label: 'Serial Number', value: item.serial_number },
      { label: 'Acquired', value: item.purchase_date },
      { label: 'Price', value: item.purchase_price ? `¥${item.purchase_price}` : null },
    ];

    return {
      specs: [...common, ...(specific[type] || [])].filter(x => x.value !== null && x.value !== undefined && x.value !== ''),
      ownership: ownership.filter(x => x.value !== null && x.value !== undefined && x.value !== '')
    };
  };

  const { specs, ownership } = getSpecs();

  return (
    <div className="space-y-8">
      {/* Technical Specifications */}
      <div>
        <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
          <span className="w-1 h-4 bg-primary/60 rounded-full" />
          Specifications
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-5">
          {specs.map((spec, i) => (
            <DetailRow key={i} {...spec} />
          ))}
        </div>
      </div>
      
      {/* Ownership Info */}
      {ownership.length > 0 && (
        <div className="pt-6 border-t border-zinc-200 dark:border-zinc-700">
          <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="w-1 h-4 bg-primary/60 rounded-full" />
            Ownership
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-8 gap-y-5">
            {ownership.map((spec, i) => (
              <DetailRow key={i} {...spec} />
            ))}
          </div>
        </div>
      )}
      
      {item.notes && (
        <div className="pt-6 border-t border-zinc-200 dark:border-zinc-700">
          <h4 className="text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-primary/60 rounded-full" />
            Notes
          </h4>
          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed bg-zinc-50/50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">{item.notes}</p>
        </div>
      )}
    </div>
  );
}