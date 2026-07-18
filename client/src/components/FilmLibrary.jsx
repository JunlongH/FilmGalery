// src/components/FilmLibrary.jsx
/**
 * FilmLibrary 页面组件 (已现代化)
 * 
 * 使用 HeroUI 组件和子组件实现胶片库存管理
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button, Spinner } from '@heroui/react';
import { Plus, Package, AlertCircle } from 'lucide-react';
import FilmItemEditModal from './FilmItemEditModal';
import { LoadFilmModal, DevelopFilmModal, UnloadFilmModal, ArchiveFilmModal } from './FilmActionModals';
import { getFilms, getFilmItems, createFilmItemsBatch, updateFilmItem, deleteFilmItem } from '../api';
import { getCacheStrategy } from '../lib';
import ModalDialog from './ModalDialog';
import { lazyModal } from './common/lazyModal';
import FilmStatusTabs from './FilmLibrary/FilmStatusTabs';
import FilmInventoryCard from './FilmLibrary/FilmInventoryCard';
import PurchaseBatchModal from './FilmLibrary/PurchaseBatchModal';

// ShotLogModal 为 1600+ 行大组件，首次打开时才加载
const ShotLogModal = lazyModal(() => import('./ShotLogModal'));

export default function FilmLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });

  // Inventory state
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState('all');
  const [formatFilter, setFormatFilter] = useState('');
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  
  // Store IDs for modals to ensure fresh data from query cache
  const [loadModalItemId, setLoadModalItemId] = useState(null);
  const [unloadModalItemId, setUnloadModalItemId] = useState(null);
  const [developModalItemId, setDevelopModalItemId] = useState(null);
  const [archiveModalItemId, setArchiveModalItemId] = useState(null);
  const [shotLogModalItemId, setShotLogModalItemId] = useState(null);
  
  // 展开的卡片ID
  const [expandedItemId, setExpandedItemId] = useState(null);

  const showAlert = (title, message) => {
    setDialog({ isOpen: true, type: 'alert', title, message, onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false })) });
  };

  const showConfirm = (title, message, onConfirm) => {
    setDialog({ 
      isOpen: true, 
      type: 'confirm', 
      title, 
      message, 
      onConfirm: () => {
        onConfirm();
        setDialog(prev => ({ ...prev, isOpen: false }));
      },
      onCancel: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  const { data: filmsData } = useQuery({
    queryKey: ['films'],
    queryFn: getFilms,
    ...getCacheStrategy('films'),
  });

  const { data: filmItemsData, isLoading: loadingFilmItems } = useQuery({
    queryKey: ['filmItems'],
    queryFn: () => getFilmItems(),
    ...getCacheStrategy('filmItems'),
  });

  const films = Array.isArray(filmsData) ? filmsData : [];
  const allFilmItems = filmItemsData && Array.isArray(filmItemsData.items) ? filmItemsData.items : [];

  // Get unique formats from films for filter dropdown
  const availableFormats = [...new Set(films.map(f => f.format).filter(Boolean))].sort();

  // Calculate counts
  const statusCounts = allFilmItems.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const totalCount = allFilmItems.length;

  // Filter for display - apply both status and format filters
  let filmItems = inventoryStatusFilter === 'all' 
    ? allFilmItems 
    : allFilmItems.filter(item => item.status === inventoryStatusFilter);
  
  // Apply format filter
  if (formatFilter) {
    filmItems = filmItems.filter(item => {
      const film = films.find(f => f.id === item.film_id);
      return film && film.format === formatFilter;
    });
  }

  // Sort items
  filmItems = React.useMemo(() => {
    const STATUS_ORDER = ['loaded', 'in_stock', 'shot', 'sent_to_lab', 'developed', 'archived'];
    return [...filmItems].sort((a, b) => {
      const statusA = a.status || 'in_stock';
      const statusB = b.status || 'in_stock';
      
      const idxA = STATUS_ORDER.indexOf(statusA);
      const idxB = STATUS_ORDER.indexOf(statusB);
      
      // 1. Status order (only if showing all)
      if (inventoryStatusFilter === 'all') {
        if (idxA !== -1 && idxB !== -1) {
          if (idxA !== idxB) return idxA - idxB;
        } else if (idxA !== -1) {
          return -1;
        } else if (idxB !== -1) {
          return 1;
        }
      }

      // 2. Within status sorting
      // In stock: Expiry ASC
      // Others: Use Date DESC (shooting date, finished date, loaded date)
      if (statusA === 'in_stock') {
        if (!a.expiry_date) return 1;
        if (!b.expiry_date) return -1;
        return a.expiry_date.localeCompare(b.expiry_date);
      } else {
        const getDate = (item) => {
          if (item.status === 'loaded') return item.loaded_date;
          // For others, try finished, then loaded
          // Or developed_date for processed ones?
          // User said "按照拍摄时间排序" (sort by shooting time)
          return item.finished_date || item.loaded_date || item.purchase_date || ''; 
        };
        const dateA = getDate(a) || '';
        const dateB = getDate(b) || '';
        // DESC sort
        if (dateA === dateB) return (b.id || 0) - (a.id || 0);
        return dateB.localeCompare(dateA);
      }
    });
  }, [filmItems, inventoryStatusFilter]);

  const createFilmItemsBatchMutation = useMutation({
    mutationFn: createFilmItemsBatch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['filmItems'] });
    }
  });

  return (
    <div className="min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 pb-20">
      {/* Dialog for alerts/confirms */}
      <ModalDialog 
        isOpen={dialog.isOpen} 
        type={dialog.type} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />

      {/* Page Header */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Package className="w-7 h-7 text-primary" />
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Film Inventory</h1>
          </div>
          <Button
            color="primary"
            startContent={<Plus className="w-4 h-4" />}
            onPress={() => setIsBatchModalOpen(true)}
          >
            Add Purchase
          </Button>
        </div>
      </motion.div>

      {/* Status Tabs and Filters */}
      <FilmStatusTabs
        selectedStatus={inventoryStatusFilter}
        onStatusChange={setInventoryStatusFilter}
        statusCounts={statusCounts}
        totalCount={totalCount}
        formatFilter={formatFilter}
        onFormatChange={setFormatFilter}
        availableFormats={availableFormats}
      />

      {/* Inventory Grid */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        {loadingFilmItems ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="lg" color="primary" />
          </div>
        ) : filmItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400 dark:text-zinc-500">
            <AlertCircle className="w-12 h-12 mb-4" />
            <p className="text-lg">No inventory records found</p>
            <p className="text-sm">Try adjusting your filters or add a new purchase</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6 gap-5" style={{ alignItems: 'start' }}>
              {filmItems.map((item, index) => {
                const film = films.find(f => f.id === item.film_id);
                const isExpanded = expandedItemId === item.id;
                return (
                  <div
                    key={item.id}
                    className={isExpanded ? 'col-span-4 row-span-2' : ''}
                    style={{
                      transition: 'none'
                    }}
                  >
                    <FilmInventoryCard
                      isExpanded={isExpanded}
                      onToggleExpand={() => setExpandedItemId(isExpanded ? null : item.id)}
                      item={item}
                      film={film}
                      onLoad={() => setLoadModalItemId(item.id)}
                      onUnload={() => setUnloadModalItemId(item.id)}
                      onLogShots={() => setShotLogModalItemId(item.id)}
                      onDevelop={() => setDevelopModalItemId(item.id)}
                      onCreateRoll={() => {
                        navigate('/rolls/new', {
                          state: {
                            filmItemId: item.id,
                            developInfo: {
                              develop_lab: item.develop_lab,
                              develop_process: item.develop_process,
                              develop_date: item.develop_date,
                              develop_cost: item.develop_price,
                              develop_note: item.develop_note
                            }
                          }
                        });
                      }}
                      onArchive={() => {
                        setArchiveModalItemId(item.id);
                      }}
                      onEdit={() => setEditingItem(item)}
                      onDelete={() => {
                        showConfirm('Delete Film Item', 'Permanently delete this film item? This cannot be undone.', async () => {
                          try {
                            const res = await deleteFilmItem(item.id, true);
                            if (!res.ok) throw new Error(res.error || 'Delete failed');
                            queryClient.invalidateQueries({ queryKey: ['filmItems'] });
                          } catch (err) {
                            console.error(err);
                            showAlert('Error', 'Failed to delete: ' + err.message);
                          }
                        });
                      }}
                      onViewRoll={(rollId) => navigate(`/rolls/${rollId}`)}
                      onToggleNegativeArchived={async () => {
                        await updateFilmItem(item.id, { negative_archived: item.negative_archived ? 0 : 1 });
                        queryClient.invalidateQueries({ queryKey: ['filmItems'] });
                      }}
                    />
                  </div>
                );
              })}
          </div>
        )}
      </motion.div>

          {loadModalItemId && (
            <LoadFilmModal 
              item={allFilmItems.find(i => i.id === loadModalItemId)}
              isOpen={!!loadModalItemId}
              onClose={() => setLoadModalItemId(null)}
              onLoaded={async (updated) => {
                if (updated && updated.optimistic && updated.item) {
                  // optimistic local update - use correct cache key
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                  return;
                }
                // Server response - update cache directly without invalidation
                if (updated && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                }
              }}
            />
          )}

          {unloadModalItemId && (
            <UnloadFilmModal 
              item={allFilmItems.find(i => i.id === unloadModalItemId)}
              isOpen={!!unloadModalItemId}
              onClose={() => setUnloadModalItemId(null)}
              onUnloaded={async (updated) => {
                if (updated && updated.optimistic && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                  return;
                }
                if (updated && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                }
              }}
            />
          )}

          {developModalItemId && (
            <DevelopFilmModal
              item={allFilmItems.find(i => i.id === developModalItemId)}
              isOpen={!!developModalItemId}
              onClose={() => setDevelopModalItemId(null)}
              onDeveloped={async (updated) => {
                if (updated && updated.optimistic && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                  return;
                }
                if (updated && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                }
              }}
            />
          )}

          {shotLogModalItemId && (
            <ShotLogModal
              item={allFilmItems.find(i => i.id === shotLogModalItemId)}
              isOpen={!!shotLogModalItemId}
              onClose={() => setShotLogModalItemId(null)}
              onUpdated={async () => { await queryClient.invalidateQueries({ queryKey: ['filmItems'] }); }}
            />
          )}

          {archiveModalItemId && (
            <ArchiveFilmModal
              item={allFilmItems.find(i => i.id === archiveModalItemId)}
              isOpen={!!archiveModalItemId}
              onClose={() => setArchiveModalItemId(null)}
              onArchived={async (updated) => {
                setArchiveModalItemId(null);
                if (updated && updated.optimistic) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                  return;
                }
                if (updated && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                }
              }}
            />
          )}

          {editingItem && (
            <FilmItemEditModal
              item={editingItem}
              isOpen={!!editingItem}
              onClose={() => setEditingItem(null)}
              onUpdated={async () => {
                await queryClient.invalidateQueries({ queryKey: ['filmItems'] });
              }}
            />
          )}

          {isBatchModalOpen && (
            <PurchaseBatchModal
              isOpen={isBatchModalOpen}
              onClose={() => setIsBatchModalOpen(false)}
              films={films}
              isLoading={createFilmItemsBatchMutation.isLoading}
              onSubmit={async (data) => {
                try {
                  await createFilmItemsBatchMutation.mutateAsync(data);
                  setIsBatchModalOpen(false);
                } catch (err) {
                  console.error(err);
                  showAlert('Error', 'Create film items failed');
                }
              }}
            />
          )}
    </div>
  );
}