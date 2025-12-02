import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFilms, getFilmItems, createFilmItemsBatch } from '../api';
import ModalDialog from './ModalDialog';

// Simple status options aligned with backend VALID_STATUSES
const STATUS_OPTIONS = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'loaded', label: 'Loaded' },
  { value: 'shot', label: 'Shot' },
  { value: 'sent_to_lab', label: 'Sent to lab' },
  { value: 'developed', label: 'Developed' },
  { value: 'archived', label: 'Archived' },
];

function formatMoney(v) {
  if (v == null) return '';
  const num = Number(v);
  if (Number.isNaN(num)) return '';
  return num.toFixed(2);
}

export default function FilmInventory() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null, onCancel: null });
  const [filters, setFilters] = useState({ status: 'in_stock' });

  const [batchForm, setBatchForm] = useState({
    purchase_date: '',
    purchase_channel: '',
    purchase_vendor: '',
    purchase_order_id: '',
    total_shipping: '',
    purchase_currency: 'CNY',
    note: '',
    items: [
      { film_id: '', quantity: 1, unit_price: '', expiry_date: '', batch_number: '', note_purchase: '' },
    ],
  });

  const showAlert = (title, message) => {
    setDialog({
      isOpen: true,
      type: 'alert',
      title,
      message,
      onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false })),
      onCancel: () => setDialog(prev => ({ ...prev, isOpen: false })),
    });
  };

  const { data: filmsData } = useQuery({
    queryKey: ['films'],
    queryFn: getFilms,
  });

  const films = Array.isArray(filmsData) ? filmsData : [];

  const { data: filmItemsData, isLoading: loadingItems } = useQuery({
    queryKey: ['film-items', filters],
    queryFn: () => getFilmItems({ status: filters.status }),
  });

  const items = filmItemsData && Array.isArray(filmItemsData.items) ? filmItemsData.items : [];

  const createBatchMutation = useMutation({
    mutationFn: createFilmItemsBatch,
    onSuccess: () => {
      queryClient.invalidateQueries(['film-items']);
      // reset batch form but keep some defaults
      setBatchForm(prev => ({
        ...prev,
        total_shipping: '',
        note: '',
        items: [
          { film_id: '', quantity: 1, unit_price: '', expiry_date: '', batch_number: '', note_purchase: '' },
        ],
      }));
    },
  });

  const onChangeFilterStatus = (e) => {
    setFilters(prev => ({ ...prev, status: e.target.value || undefined }));
  };

  const onChangeBatchOrderField = (key, value) => {
    setBatchForm(prev => ({ ...prev, [key]: value }));
  };

  const onChangeBatchItemField = (index, key, value) => {
    setBatchForm(prev => {
      const nextItems = prev.items.slice();
      nextItems[index] = { ...nextItems[index], [key]: value };
      return { ...prev, items: nextItems };
    });
  };

  const onAddBatchRow = () => {
    setBatchForm(prev => ({
      ...prev,
      items: [
        ...prev.items,
        { film_id: '', quantity: 1, unit_price: '', expiry_date: '', batch_number: '', note_purchase: '' },
      ],
    }));
  };

  const onRemoveBatchRow = (index) => {
    setBatchForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const onSubmitBatch = async (e) => {
    e.preventDefault();
    try {
      const totalQty = batchForm.items.reduce((sum, row) => sum + (Number(row.quantity || 0) || 0), 0);
      if (!totalQty) {
        showAlert('验证失败', '总数量必须大于 0');
        return;
      }
      const totalShippingNum = Number(batchForm.total_shipping || 0) || 0;
      const perItem = totalQty ? totalShippingNum / totalQty : 0;
      const confirmMsg = `本次共 ${totalQty} 卷，将把总运费 ${formatMoney(totalShippingNum)} 均分为每卷约 ${formatMoney(perItem)}。`;
      // 简单用浏览器 confirm，未来可换成统一对话框
      // eslint-disable-next-line no-alert
      const ok = window.confirm(confirmMsg);
      if (!ok) return;

      const payload = {
        ...batchForm,
        total_shipping: totalShippingNum,
        items: batchForm.items.map(row => ({
          ...row,
          film_id: row.film_id ? Number(row.film_id) : undefined,
          quantity: row.quantity ? Number(row.quantity) : 0,
          unit_price: row.unit_price ? Number(row.unit_price) : undefined,
        })),
      };
      await createBatchMutation.mutateAsync(payload);
    } catch (err) {
      console.error(err);
      showAlert('错误', '创建购买批次失败：' + (err.message || String(err)));
    }
  };

  const filmNameById = (id) => {
    const f = films.find(x => x.id === id);
    return f ? f.name : `Film #${id}`;
  };

  // Helper to get thumb url
  const getFilmThumbUrl = (film) => {
    if (!film || !film.thumbPath) return null;
    // Assuming buildUploadUrl is available or we construct it manually
    // Since this file didn't import buildUploadUrl, let's just use relative path if it starts with /uploads
    // or we can import it. But to be safe and minimal changes:
    return film.thumbPath; 
  };

  return (
    <div>
      <ModalDialog
        isOpen={dialog.isOpen}
        type={dialog.type}
        title={dialog.title}
        message={dialog.message}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />

      <div className="page-header" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Film Inventory</h3>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <label style={{ fontSize: 13 }}>Status:</label>
        <select value={filters.status || ''} onChange={onChangeFilterStatus}>
          <option value="">All</option>
          {STATUS_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Inventory list */}
      <div style={{ marginBottom: 32 }}>
        {loadingItems ? (
          <div>Loading inventory...</div>
        ) : items.length ? (
          <table className="table table-sm" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th align="left">Film</th>
                <th align="left">Status</th>
                <th align="left">Expiry</th>
                <th align="right">Price</th>
                <th align="right">Ship/Share</th>
                <th align="left">Channel</th>
                <th align="left">Vendor</th>
                <th align="left">Batch</th>
                <th align="left">Label</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>{filmNameById(it.film_id)}</td>
                  <td>{it.status}</td>
                  <td>{it.expiry_date || ''}</td>
                  <td align="right">{formatMoney(it.purchase_price)}</td>
                  <td align="right">{formatMoney(it.purchase_shipping_share)}</td>
                  <td>{it.purchase_channel || ''}</td>
                  <td>{it.purchase_vendor || ''}</td>
                  <td>{it.batch_number || ''}</td>
                  <td>{it.label || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div>No film items</div>
        )}
      </div>

      {/* Batch purchase form */}
      <div style={{ borderTop: '1px solid #eee', paddingTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>New Purchase Batch</h4>
        <form onSubmit={onSubmitBatch} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 160 }}>
              <label style={{ fontSize: 12 }}>Purchase date</label>
              <input type="date" value={batchForm.purchase_date} onChange={e => onChangeBatchOrderField('purchase_date', e.target.value)} />
            </div>
            <div style={{ minWidth: 160 }}>
              <label style={{ fontSize: 12 }}>Channel</label>
              <input value={batchForm.purchase_channel} onChange={e => onChangeBatchOrderField('purchase_channel', e.target.value)} placeholder="Taobao / JD / Store" />
            </div>
            <div style={{ minWidth: 160 }}>
              <label style={{ fontSize: 12 }}>Vendor</label>
              <input value={batchForm.purchase_vendor} onChange={e => onChangeBatchOrderField('purchase_vendor', e.target.value)} />
            </div>
            <div style={{ minWidth: 160 }}>
              <label style={{ fontSize: 12 }}>Order ID</label>
              <input value={batchForm.purchase_order_id} onChange={e => onChangeBatchOrderField('purchase_order_id', e.target.value)} />
            </div>
            <div style={{ minWidth: 120 }}>
              <label style={{ fontSize: 12 }}>Total shipping</label>
              <input type="number" step="0.01" value={batchForm.total_shipping} onChange={e => onChangeBatchOrderField('total_shipping', e.target.value)} />
            </div>
            <div style={{ minWidth: 80 }}>
              <label style={{ fontSize: 12 }}>Currency</label>
              <input value={batchForm.purchase_currency} onChange={e => onChangeBatchOrderField('purchase_currency', e.target.value)} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12 }}>Order note</label>
            <textarea value={batchForm.note} onChange={e => onChangeBatchOrderField('note', e.target.value)} rows={2} />
          </div>

          <div style={{ marginTop: 8 }}>
            <h5 style={{ marginTop: 0 }}>Lines</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {batchForm.items.map((row, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 180 }}>
                    <label style={{ fontSize: 12 }}>Film</label>
                    <select
                      value={row.film_id}
                      onChange={e => onChangeBatchItemField(index, 'film_id', e.target.value)}
                    >
                      <option value="">Select film</option>
                      {films.map(f => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ width: 80 }}>
                    <label style={{ fontSize: 12 }}>Qty</label>
                    <input type="number" min={1} value={row.quantity} onChange={e => onChangeBatchItemField(index, 'quantity', e.target.value)} />
                  </div>
                  <div style={{ width: 120 }}>
                    <label style={{ fontSize: 12 }}>Unit price</label>
                    <input type="number" step="0.01" value={row.unit_price} onChange={e => onChangeBatchItemField(index, 'unit_price', e.target.value)} />
                  </div>
                  <div style={{ minWidth: 140 }}>
                    <label style={{ fontSize: 12 }}>Expiry</label>
                    <input type="date" value={row.expiry_date} onChange={e => onChangeBatchItemField(index, 'expiry_date', e.target.value)} />
                  </div>
                  <div style={{ minWidth: 120 }}>
                    <label style={{ fontSize: 12 }}>Batch</label>
                    <input value={row.batch_number} onChange={e => onChangeBatchItemField(index, 'batch_number', e.target.value)} />
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ fontSize: 12 }}>Line note</label>
                    <input value={row.note_purchase} onChange={e => onChangeBatchItemField(index, 'note_purchase', e.target.value)} />
                  </div>
                  <div>
                    <button type="button" className="btn btn-sm" onClick={() => onRemoveBatchRow(index)} disabled={batchForm.items.length === 1}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm" onClick={onAddBatchRow}>Add line</button>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={createBatchMutation.isLoading}>
              {createBatchMutation.isLoading ? 'Saving...' : 'Save batch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
