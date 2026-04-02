/**
 * EquipmentEditModal - 设备编辑模态框
 * 
 * 使用 GlassModal + HeroUI 组件的现代化设备编辑界面
 * 支持相机、镜头、闪光灯、片夹、扫描仪、胶片六种类型
 * 
 * 设计原则:
 * - 使用外部 label 避免重叠问题
 * - 使用内联 style 的 grid 布局确保可靠性
 * - 使用 GlassCard 分组
 * - 使用 SectionTitle 带分隔线的标题
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Input, 
  Select, 
  SelectItem, 
  Button
} from '@heroui/react';
import { GlassModal, GlassCard } from '../ui';
import { 
  Camera, 
  Aperture, 
  Zap, 
  Box, 
  Scan, 
  Film,
  Save,
  X,
  Package,
  Info
} from 'lucide-react';

// ========================================
// CONSTANTS
// ========================================
const CAMERA_TYPES = [
  'SLR', 'Rangefinder', 'P&S', 'TLR', 'Medium Format', 
  'Large Format', 'Instant', 'Half Frame', 'Other'
];

const LENS_MOUNTS = [
  'M42', 'Pentax K', 'Nikon F', 'Canon FD', 'Canon EF', 
  'Minolta MD', 'Minolta A', 'Leica M', 'Leica R', 'Leica L',
  'Contax/Yashica', 'Olympus OM', 'Sony A', 'Sony E',
  'Micro Four Thirds', 'Fuji X', 'Hasselblad V', 'Mamiya 645',
  'Mamiya RB/RZ', 'Pentax 645', 'Pentax 67', 'Fixed'
];

const FILM_FORMATS = [
  '135', '120', '220', '110', '127', 
  'Large Format 4x5', 'Large Format 8x10', 
  'Instant', 'APS', 'Half Frame'
];

const SCANNER_TYPES = [
  'Flatbed', 'Film Scanner', 'Drum Scanner', 
  'DSLR Scan Rig', 'Virtual Drum', 'Lab Scanner', 'Other'
];

const FILM_BACK_SUB_FORMATS = [
  { value: '645', label: '6x4.5 (645)' },
  { value: '6x6', label: '6x6' },
  { value: '6x7', label: '6x7' },
  { value: '6x8', label: '6x8' },
  { value: '6x9', label: '6x9' },
  { value: '6x12', label: '6x12' },
  { value: '6x17', label: '6x17' }
];

const FILM_BACK_MOUNTS = [
  'Hasselblad V', 'Mamiya RB67', 'Mamiya RZ67', 'Mamiya 645',
  'Pentax 645', 'Pentax 67', 'Bronica ETR', 'Bronica SQ', 
  'Bronica GS-1', 'Rollei SL66', 'Graflex', 'Universal'
];

const METER_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'match-needle', label: 'Match-Needle' },
  { value: 'center-weighted', label: 'Center-Weighted' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'spot', label: 'Spot' },
  { value: 'evaluative', label: 'Evaluative' }
];
const FOCUS_TYPES = [
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto' },
  { value: 'hybrid', label: 'Hybrid' }
];
const CONDITIONS = [
  { value: 'mint', label: 'Mint' },
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'for_parts', label: 'For Parts' }
];
const STATUSES = [
  { value: 'owned', label: 'Owned' },
  { value: 'sold', label: 'Sold' },
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'borrowed', label: 'Borrowed' },
  { value: 'lab', label: 'Lab' }
];
const SENSOR_TYPES = ['CCD', 'CMOS', 'PMT'];
const BIT_DEPTHS = [8, 12, 14, 16, 24, 48];

const FILM_CATEGORIES = [
  { value: 'color-negative', label: 'Color Negative' },
  { value: 'color-reversal', label: 'Color Reversal (Slide)' },
  { value: 'bw-negative', label: 'B&W Negative' },
  { value: 'bw-reversal', label: 'B&W Reversal' },
  { value: 'instant', label: 'Instant' },
  { value: 'cine', label: 'Cinema (ECN-2)' },
  { value: 'other', label: 'Other' }
];

const FILM_PROCESSES = [
  { value: 'C-41', label: 'C-41' },
  { value: 'E-6', label: 'E-6' },
  { value: 'B&W', label: 'B&W' },
  { value: 'ECN-2', label: 'ECN-2' },
  { value: 'Cross', label: 'Cross Process' },
  { value: 'Other', label: 'Other' }
];

// Type labels mapping
const TYPE_LABELS = {
  cameras: { singular: 'Camera', icon: Camera },
  lenses: { singular: 'Lens', icon: Aperture },
  flashes: { singular: 'Flash', icon: Zap },
  'film-backs': { singular: 'Film Back', icon: Box },
  scanners: { singular: 'Scanner', icon: Scan },
  films: { singular: 'Film', icon: Film }
};

// ========================================
// UI COMPONENTS
// ========================================

// Section Title with divider line (SKILL pattern)
function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2.5 mt-4 mb-2">
      <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center">
        <Icon size={13} className="text-primary" />
      </div>
      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{children}</span>
      <div className="flex-1 h-px bg-divider/50 ml-1" />
    </div>
  );
}

// Styled Checkbox with external label (SKILL: avoid HeroUI label overlap)
function StyledCheckbox({ children, isSelected, onValueChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => onValueChange?.(e.target.checked)}
        style={{ 
          width: '14px', 
          height: '14px', 
          accentColor: 'var(--heroui-primary)',
          cursor: 'pointer',
          flexShrink: 0
        }}
      />
      <span 
        style={{ 
          fontSize: '13px', 
          color: 'var(--heroui-default-700)', 
          whiteSpace: 'nowrap',
          userSelect: 'none',
          cursor: 'pointer'
        }}
        onClick={() => onValueChange?.(!isSelected)}
      >
        {children}
      </span>
    </div>
  );
}

// Standard Input classNames (SKILL: avoid label overlap)
// 使用明确的 Tailwind 颜色类确保亮色/暗色模式正确显示
// 完全透明背景，仅保留边框
const inputClassNames = { 
  base: "bg-transparent",
  mainWrapper: "bg-transparent",
  // Fix: Explicitly set background color to avoid dark inputs in light mode
  // Use higher opacity for better readability
  inputWrapper: "h-10 min-h-10 bg-white/80 dark:bg-zinc-800/60 shadow-none border border-zinc-200/50 dark:border-zinc-700/50",
  innerWrapper: "bg-transparent",
  input: "text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
};

// Date Input classNames (SKILL: dark mode calendar icon)
const dateInputClassNames = {
  base: "bg-transparent",
  mainWrapper: "bg-transparent",
  inputWrapper: "h-10 min-h-10 bg-white/80 dark:bg-zinc-800/60 shadow-none border border-zinc-200/50 dark:border-zinc-700/50",
  innerWrapper: "bg-transparent",
  input: "text-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark]"
};

// Standard Select classNames (SKILL: opaque dropdown + arrow right)
const selectClassNames = {
  base: "bg-transparent",
  trigger: "h-10 min-h-10 bg-white/80 dark:bg-zinc-800/60 shadow-none border border-zinc-200/50 dark:border-zinc-700/50",
  value: "text-sm truncate pr-6 text-zinc-900 dark:text-zinc-100",
  selectorIcon: "right-2 text-zinc-500 dark:text-zinc-400",
  listbox: "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100",
  popoverContent: "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
};

const selectPopoverProps = {
  classNames: {
    content: "min-w-[180px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg text-zinc-900 dark:text-zinc-100"
  }
};

// Field wrapper with external label (using inline style for reliable dark mode)
function Field({ label, children, span = 1 }) {
  const divStyle = span > 1 ? { gridColumn: `span ${span}` } : {};
  return (
    <div style={divStyle}>
      <label 
        style={{ 
          display: 'block', 
          fontSize: '11px', 
          fontWeight: 500, 
          color: 'var(--heroui-default-600)', 
          marginBottom: '6px' 
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ========================================
// MAIN COMPONENT
// ========================================
export default function EquipmentEditModal({
  isOpen,
  onClose,
  type = 'cameras',
  initialData = {},
  isNew = false,
  onSave
}) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const prevIsOpenRef = useRef(false);
  
  useEffect(() => {
    // Only initialize form when modal transitions from closed to open
    // This prevents re-initialization on every re-render caused by
    // initialData being a new {} object reference each time
    if (isOpen && !prevIsOpenRef.current) {
      setForm(initialData || {});
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]); // intentionally exclude initialData to avoid reference-trap resets

  const typeInfo = TYPE_LABELS[type] || TYPE_LABELS.cameras;
  const TypeIcon = typeInfo.icon;

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    setSaving(true);
    try {
      await onSave?.(form);
      onClose?.();
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      title={isNew ? `Add New ${typeInfo.singular}` : `Edit ${typeInfo.singular}`}
      subtitle="Fill in the details below"
      icon={<TypeIcon className="w-5 h-5" />}
      scrollBehavior="inside"
      footer={
        <div className="flex gap-3 justify-end w-full">
          <Button
            variant="flat"
            onPress={onClose}
            startContent={<X className="w-4 h-4" />}
          >
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={handleSubmit}
            isLoading={saving}
            startContent={!saving && <Save className="w-4 h-4" />}
          >
            {isNew ? 'Create' : 'Save Changes'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* ========================================
            BASIC INFORMATION - All types
        ======================================== */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info size={14} className="text-primary" />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Basic Information</span>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <Field label="Name *">
              <Input
                placeholder="Display name"
                value={form.name || ''}
                onValueChange={(v) => handleChange('name', v)}
                isRequired
                variant="bordered"
                size="sm"
                classNames={inputClassNames}
              />
            </Field>
            
            <Field label={type === 'films' ? 'Manufacturer' : 'Brand'}>
              <Input
                placeholder={type === 'films' ? 'e.g. Kodak' : 'e.g. Nikon'}
                value={form.brand || ''}
                onValueChange={(v) => handleChange('brand', v)}
                variant="bordered"
                size="sm"
                classNames={inputClassNames}
              />
            </Field>
            
            <Field label="Model">
              <Input
                placeholder="Model number"
                value={form.model || ''}
                onValueChange={(v) => handleChange('model', v)}
                variant="bordered"
                size="sm"
                classNames={inputClassNames}
              />
            </Field>
          </div>
        </GlassCard>

        {/* ========================================
            CAMERA SPECIFICATIONS
        ======================================== */}
        {type === 'cameras' && (
          <>
            <SectionTitle icon={Camera}>Camera Specifications</SectionTitle>
            <GlassCard className="p-4">
              {/* Row 1: Type, Format, Mount, Meter */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Type">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.type ? [form.type] : []}
                    onSelectionChange={(keys) => handleChange('type', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {CAMERA_TYPES.map(t => <SelectItem key={t}>{t}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Film Format">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.format ? [form.format] : []}
                    onSelectionChange={(keys) => handleChange('format', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {FILM_FORMATS.map(f => <SelectItem key={f}>{f}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Lens Mount">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.mount ? [form.mount] : []}
                    onSelectionChange={(keys) => handleChange('mount', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {LENS_MOUNTS.map(m => <SelectItem key={m}>{m}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Meter Type">
                  <Select
                    placeholder="None"
                    selectedKeys={form.meter_type ? [form.meter_type] : []}
                    onSelectionChange={(keys) => handleChange('meter_type', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {METER_TYPES.map(m => <SelectItem key={m.value}>{m.label}</SelectItem>)}
                  </Select>
                </Field>
              </div>
              
              {/* Row 2: Shutter, Weight, Battery, Years */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Shutter Max">
                  <Input
                    placeholder="e.g. 1/500"
                    value={form.shutter_speed_max || ''}
                    onValueChange={(v) => handleChange('shutter_speed_max', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Shutter Min">
                  <Input
                    placeholder="e.g. 1s"
                    value={form.shutter_speed_min || ''}
                    onValueChange={(v) => handleChange('shutter_speed_min', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Weight (g)">
                  <Input
                    type="number"
                    placeholder="grams"
                    value={form.weight_g?.toString() || ''}
                    onValueChange={(v) => handleChange('weight_g', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Battery">
                  <Input
                    placeholder="e.g. LR44"
                    value={form.battery_type || ''}
                    onValueChange={(v) => handleChange('battery_type', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>

              {/* Row 3: Production Years */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Prod. Start Year">
                  <Input
                    type="number"
                    placeholder="e.g. 1985"
                    value={form.production_year_start?.toString() || ''}
                    onValueChange={(v) => handleChange('production_year_start', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Prod. End Year">
                  <Input
                    type="number"
                    placeholder="e.g. 1995"
                    value={form.production_year_end?.toString() || ''}
                    onValueChange={(v) => handleChange('production_year_end', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>
              
              {/* Checkboxes */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '32px', paddingTop: '12px', marginTop: '12px', borderTop: '1px solid var(--heroui-divider)' }}>
                <StyledCheckbox
                  isSelected={form.has_built_in_flash === 1}
                  onValueChange={(v) => handleChange('has_built_in_flash', v ? 1 : 0)}
                >
                  Built-in Flash
                </StyledCheckbox>
                <StyledCheckbox
                  isSelected={form.has_fixed_lens === 1}
                  onValueChange={(v) => handleChange('has_fixed_lens', v ? 1 : 0)}
                >
                  Fixed Lens
                </StyledCheckbox>
              </div>
              
              {/* Fixed Lens Details */}
              {form.has_fixed_lens === 1 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--heroui-divider)' }}>
                  <Field label="Focal Length (mm)">
                    <Input
                      type="number"
                      placeholder="35"
                      value={form.fixed_lens_focal_length?.toString() || ''}
                      onValueChange={(v) => handleChange('fixed_lens_focal_length', v ? parseFloat(v) : null)}
                      variant="bordered"
                      size="sm"
                      classNames={inputClassNames}
                    />
                  </Field>
                  <Field label="Max Aperture">
                    <Input
                      type="number"
                      placeholder="2.8"
                      step="0.1"
                      value={form.fixed_lens_max_aperture?.toString() || ''}
                      onValueChange={(v) => handleChange('fixed_lens_max_aperture', v ? parseFloat(v) : null)}
                      variant="bordered"
                      size="sm"
                      classNames={inputClassNames}
                    />
                  </Field>
                </div>
              )}
            </GlassCard>
          </>
        )}

        {/* ========================================
            LENS SPECIFICATIONS
        ======================================== */}
        {type === 'lenses' && (
          <>
            <SectionTitle icon={Aperture}>Lens Specifications</SectionTitle>
            <GlassCard className="p-4">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Min Focal (mm)">
                  <Input
                    type="number"
                    placeholder="Wide/Prime"
                    value={form.focal_length_min?.toString() || ''}
                    onValueChange={(v) => handleChange('focal_length_min', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Max Focal (mm)">
                  <Input
                    type="number"
                    placeholder="Tele (zoom)"
                    value={form.focal_length_max?.toString() || ''}
                    onValueChange={(v) => handleChange('focal_length_max', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Mount">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.mount ? [form.mount] : []}
                    onSelectionChange={(keys) => handleChange('mount', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {LENS_MOUNTS.map(m => <SelectItem key={m}>{m}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Focus Type">
                  <Select
                    selectedKeys={form.focus_type ? [form.focus_type] : ['manual']}
                    onSelectionChange={(keys) => handleChange('focus_type', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {FOCUS_TYPES.map(t => <SelectItem key={t.value}>{t.label}</SelectItem>)}
                  </Select>
                </Field>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Max Aperture">
                  <Input
                    type="number"
                    placeholder="e.g. 1.4"
                    step="0.1"
                    value={form.max_aperture?.toString() || ''}
                    onValueChange={(v) => handleChange('max_aperture', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Max Aperture (Tele)">
                  <Input
                    type="number"
                    placeholder="e.g. 5.6"
                    step="0.1"
                    value={form.max_aperture_tele?.toString() || ''}
                    onValueChange={(v) => handleChange('max_aperture_tele', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Min Aperture">
                  <Input
                    type="number"
                    placeholder="e.g. 22"
                    step="0.1"
                    value={form.min_aperture?.toString() || ''}
                    onValueChange={(v) => handleChange('min_aperture', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Filter Size (mm)">
                  <Input
                    type="number"
                    placeholder="52"
                    value={form.filter_size?.toString() || ''}
                    onValueChange={(v) => handleChange('filter_size', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Aperture Blades">
                  <Input
                    type="number"
                    placeholder="e.g. 8"
                    value={form.blade_count?.toString() || ''}
                    onValueChange={(v) => handleChange('blade_count', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Elements">
                  <Input
                    type="number"
                    placeholder="镜片数"
                    value={form.elements?.toString() || ''}
                    onValueChange={(v) => handleChange('elements', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Groups">
                  <Input
                    type="number"
                    placeholder="镜组数"
                    value={form.groups?.toString() || ''}
                    onValueChange={(v) => handleChange('groups', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Weight (g)">
                  <Input
                    type="number"
                    placeholder="grams"
                    value={form.weight_g?.toString() || ''}
                    onValueChange={(v) => handleChange('weight_g', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Min Focus (m)">
                  <Input
                    type="number"
                    placeholder="0.45"
                    step="0.01"
                    value={form.min_focus_distance?.toString() || ''}
                    onValueChange={(v) => handleChange('min_focus_distance', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Magnification">
                  <Input
                    placeholder="e.g. 1:1, 1:2"
                    value={form.magnification_ratio || ''}
                    onValueChange={(v) => handleChange('magnification_ratio', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Prod. Start Year">
                  <Input
                    type="number"
                    placeholder="e.g. 1985"
                    value={form.production_year_start?.toString() || ''}
                    onValueChange={(v) => handleChange('production_year_start', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Prod. End Year">
                  <Input
                    type="number"
                    placeholder="e.g. 1995"
                    value={form.production_year_end?.toString() || ''}
                    onValueChange={(v) => handleChange('production_year_end', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '32px', paddingTop: '12px', marginTop: '12px', borderTop: '1px solid var(--heroui-divider)' }}>
                <StyledCheckbox
                  isSelected={form.is_macro === 1}
                  onValueChange={(v) => handleChange('is_macro', v ? 1 : 0)}
                >
                  Macro Lens
                </StyledCheckbox>
                <StyledCheckbox
                  isSelected={form.image_stabilization === 1}
                  onValueChange={(v) => handleChange('image_stabilization', v ? 1 : 0)}
                >
                  Image Stabilization
                </StyledCheckbox>
              </div>
            </GlassCard>
          </>
        )}

        {/* ========================================
            FLASH SPECIFICATIONS
        ======================================== */}
        {type === 'flashes' && (
          <>
            <SectionTitle icon={Zap}>Flash Specifications</SectionTitle>
            <GlassCard className="p-4">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Guide Number">
                  <Input
                    type="number"
                    placeholder="e.g. 36"
                    value={form.guide_number?.toString() || ''}
                    onValueChange={(v) => handleChange('guide_number', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Power Source">
                  <Input
                    placeholder="e.g. 4xAA"
                    value={form.power_source || ''}
                    onValueChange={(v) => handleChange('power_source', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Recycle Time (s)">
                  <Input
                    type="number"
                    placeholder="e.g. 3.5"
                    step="0.1"
                    value={form.recycle_time?.toString() || ''}
                    onValueChange={(v) => handleChange('recycle_time', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '32px', paddingTop: '12px', marginTop: '12px', borderTop: '1px solid var(--heroui-divider)' }}>
                <StyledCheckbox
                  isSelected={form.ttl_compatible === 1}
                  onValueChange={(v) => handleChange('ttl_compatible', v ? 1 : 0)}
                >
                  TTL Compatible
                </StyledCheckbox>
                <StyledCheckbox
                  isSelected={form.has_auto_mode === 1}
                  onValueChange={(v) => handleChange('has_auto_mode', v ? 1 : 0)}
                >
                  Auto Mode
                </StyledCheckbox>
                <StyledCheckbox
                  isSelected={form.swivel_head === 1}
                  onValueChange={(v) => handleChange('swivel_head', v ? 1 : 0)}
                >
                  Swivel Head
                </StyledCheckbox>
                <StyledCheckbox
                  isSelected={form.bounce_head === 1}
                  onValueChange={(v) => handleChange('bounce_head', v ? 1 : 0)}
                >
                  Bounce Head
                </StyledCheckbox>
              </div>
            </GlassCard>
          </>
        )}

        {/* ========================================
            FILM BACK SPECIFICATIONS
        ======================================== */}
        {type === 'film-backs' && (
          <>
            <SectionTitle icon={Box}>Film Back Specifications</SectionTitle>
            <GlassCard className="p-4">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Format">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.format ? [form.format] : []}
                    onSelectionChange={(keys) => handleChange('format', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {['120', '220', '4x5', 'Instant', 'Other'].map(f => <SelectItem key={f}>{f}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Sub-Format">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.sub_format ? [form.sub_format] : []}
                    onSelectionChange={(keys) => handleChange('sub_format', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {FILM_BACK_SUB_FORMATS.map(f => <SelectItem key={f.value}>{f.label}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Mount Type">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.mount_type ? [form.mount_type] : []}
                    onSelectionChange={(keys) => handleChange('mount_type', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {FILM_BACK_MOUNTS.map(m => <SelectItem key={m}>{m}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Magazine Type">
                  <Input
                    placeholder="e.g. A12, A24"
                    value={form.magazine_type || ''}
                    onValueChange={(v) => handleChange('magazine_type', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Frames/Roll">
                  <Input
                    type="number"
                    placeholder="e.g. 12"
                    value={form.frames_per_roll?.toString() || ''}
                    onValueChange={(v) => handleChange('frames_per_roll', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Frame Width (mm)">
                  <Input
                    type="number"
                    placeholder="56"
                    step="0.1"
                    value={form.frame_width_mm?.toString() || ''}
                    onValueChange={(v) => handleChange('frame_width_mm', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Frame Height (mm)">
                  <Input
                    type="number"
                    placeholder="56"
                    step="0.1"
                    value={form.frame_height_mm?.toString() || ''}
                    onValueChange={(v) => handleChange('frame_height_mm', v ? parseFloat(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Compatible Cameras">
                  <Input
                    placeholder="e.g. 500C, 500CM"
                    value={form.compatible_cameras || ''}
                    onValueChange={(v) => handleChange('compatible_cameras', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '32px', paddingTop: '12px', marginTop: '12px', borderTop: '1px solid var(--heroui-divider)' }}>
                <StyledCheckbox
                  isSelected={form.is_motorized === 1}
                  onValueChange={(v) => handleChange('is_motorized', v ? 1 : 0)}
                >
                  Motorized
                </StyledCheckbox>
                <StyledCheckbox
                  isSelected={form.has_dark_slide !== 0}
                  onValueChange={(v) => handleChange('has_dark_slide', v ? 1 : 0)}
                >
                  Has Dark Slide
                </StyledCheckbox>
              </div>
            </GlassCard>
          </>
        )}

        {/* ========================================
            SCANNER SPECIFICATIONS
        ======================================== */}
        {type === 'scanners' && (
          <>
            <SectionTitle icon={Scan}>Scanner Specifications</SectionTitle>
            <GlassCard className="p-4">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
                <Field label="Type">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.type ? [form.type] : []}
                    onSelectionChange={(keys) => handleChange('type', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {SCANNER_TYPES.map(t => <SelectItem key={t}>{t}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Max Resolution (DPI)">
                  <Input
                    type="number"
                    placeholder="e.g. 4800"
                    value={form.max_resolution?.toString() || ''}
                    onValueChange={(v) => handleChange('max_resolution', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Sensor Type">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.sensor_type ? [form.sensor_type] : []}
                    onSelectionChange={(keys) => handleChange('sensor_type', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {SENSOR_TYPES.map(t => <SelectItem key={t}>{t}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Bit Depth">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.bit_depth ? [form.bit_depth.toString()] : []}
                    onSelectionChange={(keys) => handleChange('bit_depth', parseInt(Array.from(keys)[0]))}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {BIT_DEPTHS.map(b => <SelectItem key={b.toString()}>{b}-bit</SelectItem>)}
                  </Select>
                </Field>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <Field label="Supported Formats">
                  <Input
                    placeholder="e.g. 35mm, 120, 4x5"
                    value={form.supported_formats || ''}
                    onValueChange={(v) => handleChange('supported_formats', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Default Software">
                  <Input
                    placeholder="e.g. SilverFast, VueScan"
                    value={form.default_software || ''}
                    onValueChange={(v) => handleChange('default_software', v)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '32px', paddingTop: '12px', marginTop: '12px', borderTop: '1px solid var(--heroui-divider)' }}>
                <StyledCheckbox
                  isSelected={form.has_infrared_cleaning === 1}
                  onValueChange={(v) => handleChange('has_infrared_cleaning', v ? 1 : 0)}
                >
                  Infrared Dust Removal (ICE/iSRD)
                </StyledCheckbox>
              </div>
            </GlassCard>
          </>
        )}

        {/* ========================================
            FILM STOCK SPECIFICATIONS
        ======================================== */}
        {type === 'films' && (
          <>
            <SectionTitle icon={Film}>Film Specifications</SectionTitle>
            <GlassCard className="p-4">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <Field label="ISO Speed">
                  <Input
                    type="number"
                    placeholder="e.g. 400"
                    value={form.iso?.toString() || ''}
                    onValueChange={(v) => handleChange('iso', v ? parseInt(v) : null)}
                    variant="bordered"
                    size="sm"
                    classNames={inputClassNames}
                  />
                </Field>
                
                <Field label="Format">
                  <Select
                    selectedKeys={form.format ? [form.format] : ['135']}
                    onSelectionChange={(keys) => handleChange('format', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {FILM_FORMATS.map(f => <SelectItem key={f}>{f}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Category">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.category ? [form.category] : []}
                    onSelectionChange={(keys) => handleChange('category', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {FILM_CATEGORIES.map(c => <SelectItem key={c.value}>{c.label}</SelectItem>)}
                  </Select>
                </Field>
                
                <Field label="Process">
                  <Select
                    placeholder="Select"
                    selectedKeys={form.process ? [form.process] : []}
                    onSelectionChange={(keys) => handleChange('process', Array.from(keys)[0])}
                    variant="bordered"
                    size="sm"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                  >
                    {FILM_PROCESSES.map(p => <SelectItem key={p.value}>{p.label}</SelectItem>)}
                  </Select>
                </Field>
              </div>
            </GlassCard>
          </>
        )}

        {/* ========================================
            OWNERSHIP DETAILS - All types
        ======================================== */}
        <SectionTitle icon={Package}>Ownership Details</SectionTitle>
        <GlassCard className="p-4">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '12px' }}>
            <Field label="Status">
              <Select
                selectedKeys={form.status ? [form.status] : ['owned']}
                onSelectionChange={(keys) => handleChange('status', Array.from(keys)[0])}
                variant="bordered"
                size="sm"
                classNames={selectClassNames}
                popoverProps={selectPopoverProps}
              >
                {STATUSES.map(s => <SelectItem key={s.value}>{s.label}</SelectItem>)}
              </Select>
            </Field>
            
            <Field label="Condition">
              <Select
                placeholder="Select"
                selectedKeys={form.condition ? [form.condition] : []}
                onSelectionChange={(keys) => handleChange('condition', Array.from(keys)[0])}
                variant="bordered"
                size="sm"
                classNames={selectClassNames}
                popoverProps={selectPopoverProps}
              >
                {CONDITIONS.map(c => <SelectItem key={c.value}>{c.label}</SelectItem>)}
              </Select>
            </Field>
            
            <Field label="Purchase Date">
              <Input
                type="date"
                value={form.purchase_date || ''}
                onValueChange={(v) => handleChange('purchase_date', v)}
                variant="bordered"
                size="sm"
                classNames={dateInputClassNames}
              />
            </Field>
            
            <Field label="Purchase Price">
              <Input
                type="number"
                placeholder=""
                step="0.01"
                value={form.purchase_price?.toString() || ''}
                onValueChange={(v) => handleChange('purchase_price', v ? parseFloat(v) : null)}
                variant="bordered"
                size="sm"
                startContent={<span className="text-zinc-400 dark:text-zinc-500 mr-1">¥</span>}
                classNames={inputClassNames}
              />
            </Field>
          </div>
          
          {/* Serial Number - Not for films */}
          {type !== 'films' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <Field label="Serial Number" span={2}>
                <Input
                  placeholder="S/N"
                  value={form.serial_number || ''}
                  onValueChange={(v) => handleChange('serial_number', v)}
                  variant="bordered"
                  size="sm"
                  classNames={inputClassNames}
                />
              </Field>
            </div>
          )}
          
          {/* Notes */}
          <div style={{ marginTop: '12px', paddingBottom: '2px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: 'var(--heroui-default-600)', marginBottom: '6px' }}>
              Notes
            </label>
            <textarea
              placeholder="Additional notes..."
              value={form.notes || ''}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={2}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '14px',
                color: 'var(--heroui-foreground)',
                backgroundColor: 'var(--heroui-content1)',
                border: '1px solid var(--heroui-divider)',
                borderRadius: '8px',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit'
              }}
            />
          </div>
        </GlassCard>
      </form>
    </GlassModal>
  );
}
