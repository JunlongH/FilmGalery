/**
 * FilmItemEditModal - 编辑胶片库存项
 * 
 * 玻璃态设计版本
 * - 使用 GlassModal 和 GlassCard 组件
 * - 分组展示：基础信息、购买信息、使用信息、冲洗信息
 * - 根据状态动态显示/隐藏相关字段
 */

import React, { useState, useEffect, useRef } from 'react';
import { Button, Input, Select, SelectItem } from '@heroui/react';
import GlassModal, { GlassCard } from './ui/GlassModal';
import EquipmentSelector from './EquipmentSelector';
import { 
  Edit, 
  Package, 
  Camera, 
  Disc3, 
  FlaskConical, 
  CheckCircle2, 
  Archive,
  ShoppingCart,
  Calendar,
  DollarSign,
  Tag,
  Store,
  FileText,
  Beaker
} from 'lucide-react';
import { updateFilmItem } from '../api';

// 标准化的 Input/Select classNames（确保亮色/暗色模式正确显示）
// 完全透明背景，仅保留边框
const inputClassNames = { 
  base: "bg-transparent",
  mainWrapper: "bg-transparent",
  inputWrapper: "h-10 min-h-10 bg-transparent shadow-none",
  innerWrapper: "bg-transparent",
  input: "text-zinc-900 dark:text-zinc-100"
};

const dateInputClassNames = {
  base: "bg-transparent",
  mainWrapper: "bg-transparent",
  inputWrapper: "h-10 min-h-10 bg-transparent shadow-none",
  innerWrapper: "bg-transparent",
  input: "text-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark]"
};

const selectClassNames = {
  base: "bg-transparent",
  trigger: "h-10 min-h-10 bg-transparent shadow-none",
  value: "text-sm truncate text-zinc-900 dark:text-zinc-100",
  selectorIcon: "right-2 text-zinc-500 dark:text-zinc-400",
  listbox: "bg-white dark:bg-zinc-800",
  popoverContent: "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
};

const selectPopoverProps = {
  classNames: {
    content: "min-w-[180px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg"
  }
};

// Listbox item 样式 - 用于 Select 下拉列表项
const selectListboxProps = {
  itemClasses: {
    base: 'text-zinc-900 dark:text-zinc-100 data-[hover=true]:bg-zinc-100 dark:data-[hover=true]:bg-zinc-700 data-[selected=true]:bg-primary/20 data-[selected=true]:text-primary data-[focus=true]:bg-zinc-100 dark:data-[focus=true]:bg-zinc-700'
  }
};

// 状态配置
const STATUS_OPTIONS = [
  { key: 'in_stock', label: 'In Stock', icon: Package, color: 'success' },
  { key: 'loaded', label: 'Loaded', icon: Camera, color: 'primary' },
  { key: 'shot', label: 'Shot', icon: Disc3, color: 'warning' },
  { key: 'sent_to_lab', label: 'Sent to Lab', icon: FlaskConical, color: 'secondary' },
  { key: 'developed', label: 'Developed', icon: CheckCircle2, color: 'success' },
  { key: 'archived', label: 'Archived', icon: Archive, color: 'default' }
];

// 冲洗工艺选项
const PROCESS_OPTIONS = ['C-41', 'E-6', 'BW', 'ECN-2'];

// 分组标题组件
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

export default function FilmItemEditModal({ item, isOpen, onClose, onUpdated }) {
  const emptyForm = {
    status: 'in_stock',
    label: '',
    loaded_camera: '',
    camera_equip_id: null,
    // Purchase info
    purchase_price: '',
    purchase_shipping_share: '',
    purchase_date: '',
    expiry_date: '',
    batch_number: '',
    purchase_channel: '',
    purchase_vendor: '',
    purchase_order_id: '',
    purchase_note: '',
    // Usage info
    loaded_date: '',
    finished_date: '',
    // Develop info
    develop_lab: '',
    develop_process: '',
    develop_price: '',
    develop_shipping: '',
    develop_channel: '',
    develop_date: '',
    sent_to_lab_at: '',
    scan_date: '',
    develop_note: ''
  };

  const [formData, setFormData] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const itemRef = useRef(item);
  itemRef.current = item;

  useEffect(() => {
    const currentItem = itemRef.current;
    if (currentItem) {
      setFormData({
        status: currentItem.status || 'in_stock',
        label: currentItem.label || '',
        loaded_camera: currentItem.loaded_camera || '',
        camera_equip_id: currentItem.camera_equip_id || null,
        purchase_price: currentItem.purchase_price ?? '',
        purchase_shipping_share: currentItem.purchase_shipping_share ?? '',
        purchase_date: currentItem.purchase_date || '',
        expiry_date: currentItem.expiry_date || '',
        batch_number: currentItem.batch_number || '',
        purchase_channel: currentItem.purchase_channel || '',
        purchase_vendor: currentItem.purchase_vendor || '',
        purchase_order_id: currentItem.purchase_order_id || '',
        purchase_note: currentItem.purchase_note || '',
        loaded_date: currentItem.loaded_date || '',
        finished_date: currentItem.finished_date || '',
        develop_lab: currentItem.develop_lab || '',
        develop_process: currentItem.develop_process || '',
        develop_price: currentItem.develop_price ?? '',
        develop_shipping: currentItem.develop_shipping ?? '',
        develop_channel: currentItem.develop_channel || '',
        develop_date: currentItem.develop_date || '',
        sent_to_lab_at: currentItem.sent_to_lab_at || '',
        scan_date: currentItem.scan_date || '',
        develop_note: currentItem.develop_note || ''
      });
      setError(null);
    } else {
      setFormData(emptyForm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: key on item?.id (stable primitive) so user edits aren't clobbered when the parent re-renders with a new `item` object reference
  }, [item?.id]);

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (loading || !item) return;
    setLoading(true);
    setError(null);
    try {
      const patch = { ...formData };
      // Convert numbers
      if (patch.purchase_price !== '') patch.purchase_price = Number(patch.purchase_price);
      if (patch.purchase_shipping_share !== '') patch.purchase_shipping_share = Number(patch.purchase_shipping_share);
      if (patch.develop_price !== '') patch.develop_price = Number(patch.develop_price);
      if (patch.develop_shipping !== '') patch.develop_shipping = Number(patch.develop_shipping);
      
      const res = await updateFilmItem(item.id, patch);
      if (!res || res.ok === false) {
        throw new Error((res && res.error) || 'Update failed');
      }

      if (onUpdated) await onUpdated();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  // 判断是否显示冲洗信息
  const showDevelopInfo = ['sent_to_lab', 'developed', 'archived'].includes(formData.status);
  // 判断是否显示使用信息
  const showUsageInfo = ['loaded', 'shot', 'sent_to_lab', 'developed', 'archived'].includes(formData.status);

  return (
    <GlassModal 
      isOpen={isOpen} 
      onClose={onClose}
      size="lg"
      title={`Edit Film Item #${item?.id || ''}`}
      icon={<Edit size={18} />}
      footer={
        <div className="flex gap-2 w-full justify-end">
          <Button 
            variant="flat" 
            onPress={onClose}
            size="sm"
          >
            Cancel
          </Button>
          <Button 
            color="primary" 
            onPress={handleSubmit}
            isLoading={loading}
            size="sm"
          >
            Save Changes
          </Button>
        </div>
      }
    >
      {error && (
        <div className="bg-danger-50 dark:bg-danger-900/30 border border-danger-200 dark:border-danger-800 text-danger-700 dark:text-danger-400 px-3 py-2 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}
      
      <div className="space-y-3">
        {/* 基础信息 */}
        <GlassCard className="p-4">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Status</label>
              <Select
                selectedKeys={formData.status ? [formData.status] : []}
                onSelectionChange={(keys) => handleChange('status', Array.from(keys)[0])}
                size="sm"
                variant="flat"
                classNames={selectClassNames}
                style={{ maxWidth: '100%' }}
                popoverProps={selectPopoverProps}
                listboxProps={selectListboxProps}
              >
                {STATUS_OPTIONS.map(opt => (
                  <SelectItem key={opt.key} textValue={opt.label}>
                    <div className="flex items-center gap-2.5">
                      <opt.icon size={14} />
                      <span>{opt.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Label</label>
              <Input
                value={formData.label}
                onValueChange={(v) => handleChange('label', v)}
                placeholder="Optional label"
                size="sm"
                variant="bordered"
                classNames={inputClassNames}
              />
            </div>
          </div>

          {/* 装载相机 - 仅 loaded 状态显示 */}
          {formData.status === 'loaded' && (
            <div className="mt-3">
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Loaded Camera</label>
              <EquipmentSelector 
                type="camera"
                mode="film"
                value={formData.camera_equip_id}
                onChange={(id, equipItem) => {
                  setFormData(prev => ({
                    ...prev,
                    camera_equip_id: id,
                    loaded_camera: equipItem ? `${equipItem.brand} ${equipItem.model}` : ''
                  }));
                }}
                placeholder="Select camera..."
              />
            </div>
          )}
        </GlassCard>

        {/* 购买信息 */}
        <SectionTitle icon={ShoppingCart}>Purchase Info</SectionTitle>
        
        <GlassCard className="p-4">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Price</label>
              <Input
                type="number"
                step="0.01"
                value={formData.purchase_price}
                onValueChange={(v) => handleChange('purchase_price', v)}
                placeholder="0.00"
                size="sm"
                variant="bordered"
                startContent={<DollarSign size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
                classNames={inputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Shipping Share</label>
              <Input
                type="number"
                step="0.01"
                value={formData.purchase_shipping_share}
                onValueChange={(v) => handleChange('purchase_shipping_share', v)}
                placeholder="0.00"
                size="sm"
                variant="bordered"
                startContent={<DollarSign size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
                classNames={inputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Purchase Date</label>
              <Input
                type="date"
                value={formData.purchase_date}
                onValueChange={(v) => handleChange('purchase_date', v)}
                size="sm"
                variant="bordered"
                classNames={dateInputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Expiry Date</label>
              <Input
                type="date"
                value={formData.expiry_date}
                onValueChange={(v) => handleChange('expiry_date', v)}
                size="sm"
                variant="bordered"
                classNames={dateInputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Batch #</label>
              <Input
                value={formData.batch_number}
                onValueChange={(v) => handleChange('batch_number', v)}
                placeholder="Batch number"
                size="sm"
                variant="bordered"
                startContent={<Tag size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
                classNames={inputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Order ID</label>
              <Input
                value={formData.purchase_order_id}
                onValueChange={(v) => handleChange('purchase_order_id', v)}
                placeholder="Order number"
                size="sm"
                variant="bordered"
                classNames={inputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Channel</label>
              <Input
                value={formData.purchase_channel}
                onValueChange={(v) => handleChange('purchase_channel', v)}
                placeholder="Taobao, Amazon, etc."
                size="sm"
                variant="bordered"
                classNames={inputClassNames}
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Vendor</label>
              <Input
                value={formData.purchase_vendor}
                onValueChange={(v) => handleChange('purchase_vendor', v)}
                placeholder="Store name"
                size="sm"
                variant="bordered"
                startContent={<Store size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
                classNames={inputClassNames}
              />
            </div>
          </div>
          
          <div className="mt-3">
            <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Purchase Note</label>
            <Input
              value={formData.purchase_note}
              onValueChange={(v) => handleChange('purchase_note', v)}
              placeholder="Additional notes..."
              size="sm"
              variant="bordered"
              startContent={<FileText size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
              classNames={inputClassNames}
            />
          </div>
        </GlassCard>

        {/* 使用信息 - 仅相关状态显示 */}
        {showUsageInfo && (
          <>
            <SectionTitle icon={Calendar}>Usage Info</SectionTitle>
            
            <GlassCard className="p-4">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Loaded Date</label>
                  <Input
                    type="date"
                    value={formData.loaded_date}
                    onValueChange={(v) => handleChange('loaded_date', v)}
                    size="sm"
                    variant="bordered"
                    classNames={dateInputClassNames}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Finished Date</label>
                  <Input
                    type="date"
                    value={formData.finished_date}
                    onValueChange={(v) => handleChange('finished_date', v)}
                    size="sm"
                    variant="bordered"
                    classNames={dateInputClassNames}
                  />
                </div>
              </div>
            </GlassCard>
          </>
        )}

        {/* 冲洗信息 - 仅相关状态显示 */}
        {showDevelopInfo && (
          <>
            <SectionTitle icon={Beaker}>Develop Info</SectionTitle>
            
            <GlassCard className="p-4">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Lab</label>
                  <Input
                    value={formData.develop_lab}
                    onValueChange={(v) => handleChange('develop_lab', v)}
                    placeholder="Lab name"
                    size="sm"
                    variant="bordered"
                    startContent={<FlaskConical size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
                    classNames={inputClassNames}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Process</label>
                  <Select
                    selectedKeys={formData.develop_process ? [formData.develop_process] : []}
                    onSelectionChange={(keys) => handleChange('develop_process', Array.from(keys)[0] || '')}
                    size="sm"
                    variant="flat"
                    placeholder="Select process"
                    classNames={selectClassNames}
                    popoverProps={selectPopoverProps}
                    listboxProps={selectListboxProps}
                  >
                    {PROCESS_OPTIONS.map(p => (
                      <SelectItem key={p} textValue={p}>{p}</SelectItem>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Dev Price</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.develop_price}
                    onValueChange={(v) => handleChange('develop_price', v)}
                    placeholder="0.00"
                    size="sm"
                    variant="bordered"
                    startContent={<DollarSign size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
                    classNames={inputClassNames}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Dev Shipping</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.develop_shipping}
                    onValueChange={(v) => handleChange('develop_shipping', v)}
                    placeholder="0.00"
                    size="sm"
                    variant="bordered"
                    startContent={<DollarSign size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
                    classNames={inputClassNames}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Dev Channel</label>
                  <Input
                    value={formData.develop_channel}
                    onValueChange={(v) => handleChange('develop_channel', v)}
                    placeholder="Taobao, direct, etc."
                    size="sm"
                    variant="bordered"
                    classNames={inputClassNames}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Sent Date</label>
                  <Input
                    type="date"
                    value={formData.sent_to_lab_at}
                    onValueChange={(v) => handleChange('sent_to_lab_at', v)}
                    size="sm"
                    variant="bordered"
                    classNames={dateInputClassNames}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Developed Date</label>
                  <Input
                    type="date"
                    value={formData.develop_date}
                    onValueChange={(v) => handleChange('develop_date', v)}
                    size="sm"
                    variant="bordered"
                    classNames={dateInputClassNames}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Scan Date</label>
                  <Input
                    type="date"
                    value={formData.scan_date}
                    onValueChange={(v) => handleChange('scan_date', v)}
                    size="sm"
                    variant="bordered"
                    classNames={dateInputClassNames}
                  />
                </div>
              </div>
              
              <div className="mt-3">
                <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">Develop Note</label>
                <Input
                  value={formData.develop_note}
                  onValueChange={(v) => handleChange('develop_note', v)}
                  placeholder="Development notes..."
                  size="sm"
                  variant="bordered"
                  startContent={<FileText size={14} className="text-zinc-400 dark:text-zinc-500 mr-1" />}
                  classNames={inputClassNames}
                />
              </div>
            </GlassCard>
          </>
        )}

      </div>
    </GlassModal>
  );
}
