/**
 * EquipmentSelector - 设备选择器组件
 * 
 * 通用的设备选择组件，支持相机、镜头、闪光灯的选择
 * 特性：
 * - 下拉选择 + 搜索过滤
 * - 显示设备缩略图
 * - 快速添加新设备
 * - 卡口兼容性过滤（镜头）
 * - 固定镜头相机自动处理
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getCameras, getLenses, getFlashes, getScanners, getFilmBacks, getCompatibleLenses, createCamera, createLens, createFlash, createScanner, createFilmBack } from '../api';
import { buildUploadUrl } from '../api';
import { Popover, PopoverTrigger, PopoverContent } from "@heroui/react";
import '../styles/forms.css';
import '../styles/equipment-selector.css';

// 设备类型配置
const EQUIPMENT_CONFIG = {
  camera: {
    fetchAll: getCameras,
    create: createCamera,
    label: 'Camera',
    placeholder: 'Select camera...',
    icon: '📷'
  },
  lens: {
    fetchAll: getLenses,
    create: createLens,
    label: 'Lens',
    placeholder: 'Select lens...',
    icon: '🔭'
  },
  flash: {
    fetchAll: getFlashes,
    create: createFlash,
    label: 'Flash',
    placeholder: 'Select flash...',
    icon: '⚡'
  },
  scanner: {
    fetchAll: getScanners,
    create: createScanner,
    label: 'Scanner',
    placeholder: 'Select scanner...',
    icon: '🖨️'
  },
  'film-back': {
    fetchAll: getFilmBacks,
    create: createFilmBack,
    label: 'Film Back',
    placeholder: 'Select film back...',
    icon: '📦'
  }
};

export default function EquipmentSelector({
  type = 'camera', // 'camera' | 'lens' | 'flash' | 'scanner' | 'film-back'
  value = null,     // equipment ID or null
  onChange,         // (id, item) => void
  cameraId = null,  // for lens: filter by camera's mount
  disabled = false,
  showQuickAdd = true,
  mode = null,      // 'film' | 'digital' | null — filters cameras/lenses by is_digital
  className = '',
  style = {}
}) {
  const config = EQUIPMENT_CONFIG[type];
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [fixedLensInfo, setFixedLensInfo] = useState(null); // For PS cameras
  const [useAdapter, setUseAdapter] = useState(false); // Show all lenses regardless of mount
  const [cameraMount, setCameraMount] = useState(null); // Camera's mount for display
  const dropdownRef = useRef(null);

  // Load equipment list
  useEffect(() => {
    let mounted = true;
    
    const fetchItems = async () => {
      setLoading(true);
      try {
        let data;
        
        // For lens, check camera compatibility
        if (type === 'lens' && cameraId) {
          const result = await getCompatibleLenses(cameraId, mode);
          if (result.fixed_lens) {
            // Camera has fixed lens - show info instead of lens picker
            setFixedLensInfo({
              focal_length: result.focal_length,
              max_aperture: result.max_aperture
            });
            setCameraMount(null);
            setItems([]);
            if (mounted) setLoading(false);
            return;
          }
          setFixedLensInfo(null);
          setCameraMount(result.camera_mount || null);
          
          if (useAdapter) {
            // Adapter mode: fetch ALL lenses regardless of mount (respect mode filter)
            data = await config.fetchAll(mode ? { mode } : {});
          } else {
            // Normal mode: only compatible lenses (already mode-filtered server-side)
            data = result.lenses || [];
          }
          if (mounted) setItems(Array.isArray(data) ? data : []);
        } else {
          // Pass mode to fetchAll for cameras/lenses so the server can filter.
          // mode is ignored by flashes/scanners/film-backs (no is_digital column).
          const fetchArgs = (type === 'camera' || type === 'lens') && mode ? { mode } : {};
          data = await config.fetchAll(fetchArgs);
          if (mounted) {
            setItems(Array.isArray(data) ? data : []);
            setFixedLensInfo(null);
            setCameraMount(null);
          }
        }
      } catch (err) {
        console.error(`[EquipmentSelector] Failed to load ${type}:`, err);
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    
    fetchItems();
    return () => { mounted = false; };
  }, [type, cameraId, config, useAdapter, mode]);

  // Find selected item
  const selectedItem = useMemo(() => {
    if (!value) return null;
    return items.find(item => item.id === value) || null;
  }, [value, items]);

  // Filter items by search
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(item => 
      item.name?.toLowerCase().includes(q) ||
      item.brand?.toLowerCase().includes(q) ||
      item.model?.toLowerCase().includes(q)
    );
  }, [items, search]);

  // Handle item selection
  const handleSelect = (item) => {
    // Prevent event from bubbling to parent components (like Modals) that might interpret it as an outside click
    // Note: Since this is often triggered from a Portal, event bubbling follows React tree.
    // However, we rely on setIsOpen(false) to close the dropdown.
    onChange?.(item.id, item);
    setIsOpen(false);
    setSearch('');
  };

  // Handle clear selection
  const handleClear = (e) => {
    e.stopPropagation();
    onChange?.(null, null);
  };

  // Handle quick add
  const handleQuickAdd = async () => {
    if (!newName.trim()) return;
    try {
      const created = await config.create({ name: newName.trim() });
      setItems(prev => [...prev, created]);
      onChange?.(created.id, created);
      setNewName('');
      setShowAddForm(false);
      setIsOpen(false);
    } catch (err) {
      console.error(`[EquipmentSelector] Failed to create ${type}:`, err);
      alert(`Failed to create ${config.label}`);
    }
  };

  // Render item display
  const renderItemDisplay = (item, isDropdown = false) => {
    const imgUrl = item.image_path ? buildUploadUrl(item.image_path) : null;
    
    return (
      <div className={`equip-item ${isDropdown ? 'equip-item-dropdown' : 'equip-item-selected'}`}>
        {imgUrl ? (
          <img src={imgUrl} alt={item.name} className="equip-thumb" />
        ) : (
          <span className="equip-icon">{config.icon}</span>
        )}
        <div className="equip-info">
          <span className="equip-name">{item.name}</span>
          {item.brand && <span className="equip-brand">{item.brand}</span>}
          {type === 'lens' && item.focal_length_min && (
            <span className="equip-spec">
              {item.focal_length_min === item.focal_length_max 
                ? `${item.focal_length_min}mm` 
                : `${item.focal_length_min}-${item.focal_length_max}mm`}
              {item.max_aperture && ` f/${item.max_aperture}`}
            </span>
          )}
          {type === 'camera' && item.mount && (
            <span className="equip-spec">{item.mount} mount</span>
          )}
        </div>
      </div>
    );
  };

  // For fixed lens cameras, show info instead of picker
  if (type === 'lens' && fixedLensInfo) {
    return (
      <div className={`equip-selector equip-selector-fixed ${className}`} style={style}>
        <div className="equip-fixed-lens">
          <span className="equip-icon">🔒</span>
          <span>Fixed Lens: {fixedLensInfo.focal_length}mm f/{fixedLensInfo.max_aperture}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`equip-selector ${className}`} style={style} ref={dropdownRef}>
      <Popover 
        isOpen={isOpen} 
        onOpenChange={(open) => !disabled && setIsOpen(open)}
        placement="bottom"
        triggerScaleOnOpen={false}
        offset={4}
        classNames={{
          content: "bg-transparent p-0 shadow-none border-none overflow-visible"
        }}
      >
        <PopoverTrigger>
          <div 
            className={`equip-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`}
            role="button"
            tabIndex={0}
          >
            {loading ? (
              <span className="equip-loading">Loading...</span>
            ) : selectedItem ? (
              <>
                {renderItemDisplay(selectedItem)}
                <button className="equip-clear" onClick={handleClear} title="Clear">×</button>
              </>
            ) : (
              <span className="equip-placeholder">{config.placeholder}</span>
            )}
            <span className="equip-arrow">{isOpen ? '▲' : '▼'}</span>
          </div>
        </PopoverTrigger>

        <PopoverContent className="w-[300px]">
          <div className="equip-dropdown" style={{ position: 'relative', top: 0, width: '100%', maxWidth: '100%', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
            {/* Search input */}
            <input
              type="text"
              className="equip-search"
              placeholder={`Search ${config.label.toLowerCase()}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />

            {/* Adapter toggle for lens selection with camera */}
            {type === 'lens' && cameraId && cameraMount && (
              <div className="equip-adapter-toggle">
                <label className="equip-adapter-label">
                  <input
                    type="checkbox"
                    checked={useAdapter}
                    onChange={(e) => setUseAdapter(e.target.checked)}
                  />
                  <span>Use Adapter (show all lenses)</span>
                </label>
                <span className="equip-mount-info">
                  Camera mount: {cameraMount}
                </span>
              </div>
            )}

            {/* Items list */}
            <div className="equip-list">
              {filteredItems.length === 0 ? (
                <div className="equip-empty">
                  {search ? `No ${config.label.toLowerCase()} found` : `No ${config.label.toLowerCase()} in library`}
                </div>
              ) : (
                filteredItems.map(item => (
                  <div 
                    key={item.id} 
                    className={`equip-option ${item.id === value ? 'selected' : ''} ${type === 'lens' && useAdapter && item.mount && item.mount !== cameraMount ? 'adapted' : ''}`}
                    onClick={() => handleSelect(item)}
                  >
                    {renderItemDisplay(item, true)}
                    {type === 'lens' && useAdapter && item.mount && item.mount !== cameraMount && (
                      <span className="equip-adapter-badge">Adapter</span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Quick add */}
            {showQuickAdd && (
              <div className="equip-add-section">
                {showAddForm ? (
                  <div className="equip-add-form">
                    <input
                      type="text"
                      className="equip-add-input"
                      placeholder={`New ${config.label.toLowerCase()} name...`}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd()}
                    />
                    <button className="equip-add-btn" onClick={handleQuickAdd}>Add</button>
                    <button className="equip-add-cancel" onClick={() => setShowAddForm(false)}>×</button>
                  </div>
                ) : (
                  <button 
                    className="equip-add-trigger"
                    onClick={() => setShowAddForm(true)}
                  >
                    + Add New {config.label}
                  </button>
                )}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
