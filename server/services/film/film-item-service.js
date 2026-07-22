const db = require('../../db');
const { runAsync, allAsync } = require('../../utils/db-helpers');
const PreparedStmt = require('../../utils/prepared-statements');
const { isValidLatLng } = require('@filmgallery/shared/mapUtils');

// Central place for allowed status transitions
const VALID_STATUSES = ['in_stock', 'loaded', 'shot', 'sent_to_lab', 'developed', 'archived'];

function assertStatus(status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid film item status: ${status}`);
  }
}

async function createFilmItemsFromPurchase(batch) {
  const {
    purchase_date,
    purchase_channel,
    purchase_vendor,
    purchase_order_id,
    total_shipping = 0,
    purchase_currency,
    note,
    items = [],
  } = batch || {};

  if (!Array.isArray(items) || !items.length) {
    throw new Error('items must be a non-empty array');
  }

  // Compute total quantity for shipping split
  let totalCount = 0;
  for (const row of items) {
    const qty = Number(row.quantity || 0);
    if (qty > 0) totalCount += qty;
  }
  if (!totalCount) throw new Error('Total quantity must be > 0');

  const perItemShipping = total_shipping ? (Number(total_shipping) / totalCount) : 0;

  const createdItems = [];

  await runAsync('BEGIN');
  try {
    for (const row of items) {
      const film_id = Number(row.film_id);
      const quantity = Number(row.quantity || 0);
      if (!film_id || quantity <= 0) continue;

      const unit_price = row.unit_price != null ? Number(row.unit_price) : null;
      for (let i = 0; i < quantity; i++) {
        const result = await runAsync(
          `INSERT INTO film_items (
            film_id, status, label,
            purchase_channel, purchase_vendor, purchase_order_id,
            purchase_price, purchase_currency, purchase_date,
            expiry_date, batch_number, purchase_shipping_share,
            purchase_note
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            film_id,
            'in_stock',
            row.label || null,
            purchase_channel || null,
            purchase_vendor || null,
            purchase_order_id || null,
            unit_price,
            purchase_currency || null,
            purchase_date || null,
            row.expiry_date || null,
            row.batch_number || null,
            perItemShipping || 0,
            row.note_purchase || note || null,
          ]
        );
        createdItems.push({ id: result.lastID, film_id });
      }
    }

    await runAsync('COMMIT');
    return createdItems;
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch {}
    throw e;
  }
}

async function listFilmItems(filters = {}) {
  const {
    status,
    film_id,
    includeDeleted = false,
    limit = 100,
    offset = 0,
  } = filters;

  const where = [];
  const params = [];

  if (status) {
    if (Array.isArray(status)) {
      const placeholders = status.map(() => '?').join(',');
      where.push(`status IN (${placeholders})`);
      params.push(...status);
    } else {
      where.push('status = ?');
      params.push(status);
    }
  }

  if (film_id) {
    where.push('film_id = ?');
    params.push(Number(film_id));
  }

  if (!includeDeleted) {
    where.push('deleted_at IS NULL');
  }

  // Smart sorting: loaded first, then in_stock by expiry_date ASC, then others by created_at DESC
  const orderBy = `
    CASE 
      WHEN status = 'loaded' THEN 1
      WHEN status = 'in_stock' THEN 2
      ELSE 3
    END,
    CASE 
      WHEN status = 'in_stock' THEN expiry_date
      ELSE NULL
    END ASC,
    created_at DESC
  `;
  const sql = `SELECT * FROM film_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const rows = await allAsync(sql, params);
  return rows;
}

async function getFilmItemById(id) {
  const row = await PreparedStmt.getAsync('film_items.getById', [id]);
  return row || null;
}

async function updateFilmItem(id, patch) {
  const allowed = [
    'status', 'label',
    'purchase_channel', 'purchase_vendor', 'purchase_order_id',
    'purchase_price', 'purchase_currency', 'purchase_date',
    'expiry_date', 'batch_number', 'purchase_shipping_share', 'purchase_note',
    'develop_lab', 'develop_process', 'develop_price', 'develop_shipping',
    'develop_date', 'develop_channel', 'develop_note', 'scan_date',
    'loaded_camera', 'camera_equip_id', 'loaded_at', 'shot_at', 'sent_to_lab_at', 'developed_at', 'archived_at',
    'loaded_date', 'finished_date',
    'roll_id', 'negative_archived', 'shot_logs'
  ];

  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      if (key === 'status' && patch[key]) assertStatus(patch[key]);
      if (key === 'shot_logs' && patch[key] != null && patch[key] !== '') {
        // shot_logs is a JSON string; parse and validate each entry.
        try {
          const logs = JSON.parse(patch[key]);
          if (!Array.isArray(logs)) throw new Error('shot_logs must be an array');
          for (const [i, entry] of logs.entries()) {
            if (!entry.date) throw new Error(`entry[${i}]: date required`);
            if (!isValidLatLng(entry.latitude ?? null, entry.longitude ?? null)) {
              throw new Error(`entry[${i}]: invalid latitude/longitude (must be both null or both in range ±90/±180)`);
            }
          }
        } catch (e) {
          throw new Error(`invalid shot_logs: ${e.message}`);
        }
      }
      sets.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }

  if (!sets.length) return;

  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  await runAsync(`UPDATE film_items SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function softDeleteFilmItem(id) {
  const item = await getFilmItemById(id);
  if (!item) throw new Error('Film item not found');
  if (item.roll_id) throw new Error('Cannot delete film item that is linked to a roll');
  await PreparedStmt.runAsync('film_items.softDelete', [id]);
}

async function hardDeleteFilmItem(id) {
  const item = await getFilmItemById(id);
  if (!item) throw new Error('Film item not found');
  if (item.roll_id) throw new Error('Cannot delete film item that is linked to a roll');
  await PreparedStmt.runAsync('film_items.hardDelete', [id]);
}

// Link a film item to a roll, update status and copy relevant fields to roll
async function linkFilmItemToRoll({ filmItemId, rollId, loadedCamera, targetStatus = 'shot' }) {
  assertStatus(targetStatus);

  const item = await getFilmItemById(filmItemId);
  if (!item) throw new Error('Film item not found');
  if (item.deleted_at) throw new Error('Film item is deleted');
  if (item.roll_id && item.roll_id !== rollId) {
    throw new Error('Film item already linked to another roll');
  }
  
  // Allow linking from these valid states:
  // - in_stock: unused roll, first time linking
  // - loaded: roll loaded in camera, linking when creating roll
  // - shot: roll shot but not yet sent to lab, now uploading scans
  // - sent_to_lab: roll at lab, now received and uploading scans
  // DO NOT allow: developed (already linked), archived (completed)
  const validSourceStatuses = ['in_stock', 'loaded', 'shot', 'sent_to_lab'];
  if (!validSourceStatuses.includes(item.status)) {
    throw new Error(`Film item status must be one of [${validSourceStatuses.join(', ')}] to link, got ${item.status}`);
  }

  const now = new Date().toISOString();
  const patch = {
    status: targetStatus,
    roll_id: rollId,
  };

  // Only set loaded_camera and loaded_at if not already set
  if (loadedCamera && !item.loaded_camera) {
    patch.loaded_camera = loadedCamera;
    patch.loaded_at = now;
  }

  // Only set timestamp if transitioning TO that status (don't overwrite existing timestamps)
  if (targetStatus === 'shot' && !item.shot_at) patch.shot_at = now;
  if (targetStatus === 'sent_to_lab' && !item.sent_to_lab_at) patch.sent_to_lab_at = now;
  if (targetStatus === 'developed' && !item.developed_at) patch.developed_at = now;

  await updateFilmItem(filmItemId, patch);

  // Copy relevant fields from film_items to rolls (denormalized cache)
  const rollPatch = {
    film_item_id: filmItemId,
    filmId: item.film_id,
    purchase_cost: item.purchase_price,
    develop_cost: item.develop_price,
    purchase_channel: item.purchase_channel,
    batch_number: item.batch_number,
    develop_lab: item.develop_lab,
    develop_process: item.develop_process,
    develop_date: item.develop_date,
    develop_note: item.develop_note,
  };

  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(rollPatch)) {
    if (typeof value !== 'undefined') {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }
  if (sets.length) {
    params.push(rollId);
    await runAsync(`UPDATE rolls SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  return { filmItemId, rollId };
}

module.exports = {
  VALID_STATUSES,
  createFilmItemsFromPurchase,
  listFilmItems,
  getFilmItemById,
  updateFilmItem,
  softDeleteFilmItem,
  hardDeleteFilmItem,
  linkFilmItemToRoll,
};
