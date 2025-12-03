const { runAsync, allAsync, getAsync } = require('../utils/db-helpers');
const PreparedStmt = require('../utils/prepared-statements');

/**
 * Normalize tag names: trim, deduplicate (case-insensitive), convert to lowercase
 * @param {Array<string>} input - Raw tag names from client
 * @returns {Array<string>} - Normalized lowercase tag names
 */
const normalizeTagNames = (input) => {
  if (!Array.isArray(input)) return [];
  
  const seen = new Set();
  const result = [];
  
  for (const raw of input) {
    if (raw === null || raw === undefined) continue;
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(lower); // Store as lowercase for database
    }
  }
  
  return result;
};

/**
 * Ensure tags exist in database (insert if missing)
 * @param {Array<string>} names - Normalized lowercase tag names
 * @returns {Promise<Map<string, {id: number, name: string}>>} - Map of lowercase name -> tag object
 */
async function ensureTagsExist(names) {
  if (!names || !names.length) return new Map();
  
  // Insert all tags (INSERT OR IGNORE handles duplicates)
  for (const name of names) {
    try {
      await PreparedStmt.runAsync('tags.insert', [name]);
    } catch (err) {
      // If UNIQUE constraint fails despite OR IGNORE, log but continue
      console.warn(`[TAG] Insert failed for "${name}":`, err.message);
    }
  }
  
  // Retrieve all tags by name
  const placeholders = names.map(() => '?').join(',');
  const rows = await allAsync(
    `SELECT id, name FROM tags WHERE name IN (${placeholders})`,
    names
  );
  
  // Build map: lowercase name -> tag object
  const tagMap = new Map();
  for (const row of rows) {
    if (row && row.id && row.name) {
      tagMap.set(row.name.toLowerCase(), row);
    }
  }
  
  return tagMap;
}

/**
 * Save tags for a photo (replaces existing tags)
 * @param {number} photoId - Photo ID
 * @param {Array<string>} rawNames - Raw tag names from client
 * @returns {Promise<Array<{id: number, name: string}>>} - Applied tags
 */
async function savePhotoTags(photoId, rawNames) {
  console.log(`[TAG] savePhotoTags called for photo ${photoId}:`, rawNames);
  
  // Normalize: trim, deduplicate, lowercase
  const names = normalizeTagNames(rawNames);
  console.log(`[TAG] Normalized tag names:`, names);
  
  try {
    // Step 1: Remove all existing photo-tag associations for this photo
    await PreparedStmt.runAsync('photo_tags.deleteByPhoto', [photoId]);
    console.log(`[TAG] Deleted existing tags for photo ${photoId}`);
    
    if (!names.length) {
      console.log(`[TAG] No tags to add for photo ${photoId}`);
      // Cleanup orphaned tags (non-blocking)
      runAsync('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)')
        .catch(err => console.warn('[TAG] Cleanup failed (non-critical):', err.message));
      return [];
    }
    
    // Step 2: Ensure all tags exist in database
    const tagMap = await ensureTagsExist(names);
    console.log(`[TAG] Ensured ${tagMap.size} tags exist`);
    
    // Step 3: Link tags to photo
    const linkPromises = names
      .map(name => tagMap.get(name))
      .filter(Boolean)
      .map(tag => {
        console.log(`[TAG] Linking tag ${tag.id} (${tag.name}) to photo ${photoId}`);
        return PreparedStmt.runAsync('photo_tags.insert', [photoId, tag.id]);
      });
    
    await Promise.all(linkPromises);
    console.log(`[TAG] Linked ${linkPromises.length} tags to photo ${photoId}`);
    
    // Step 4: Cleanup orphaned tags (non-blocking)
    runAsync('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM photo_tags)')
      .catch(err => console.warn('[TAG] Cleanup failed (non-critical):', err.message));
    
    // Step 5: Return the applied tags
    const appliedTags = Array.from(tagMap.values());
    console.log(`[TAG] Successfully saved tags for photo ${photoId}:`, appliedTags);
    return appliedTags;
    
  } catch (err) {
    console.error(`[TAG] Error in savePhotoTags for photo ${photoId}:`, err);
    throw err;
  }
}

async function attachTagsToPhotos(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = rows.map(r => r && r.id).filter(id => id !== undefined && id !== null);
  if (!ids.length) return rows;
  const placeholders = ids.map(() => '?').join(',');
  const tagRows = await allAsync(
    `SELECT pt.photo_id, t.id AS tag_id, t.name
     FROM photo_tags pt
     JOIN tags t ON t.id = pt.tag_id
     WHERE pt.photo_id IN (${placeholders})
     ORDER BY t.name COLLATE NOCASE`,
    ids
  );
  const map = new Map();
  tagRows.forEach(row => {
    if (!map.has(row.photo_id)) map.set(row.photo_id, []);
    map.get(row.photo_id).push({ id: row.tag_id, name: row.name });
  });
  return rows.map(r => Object.assign({}, r, { tags: map.get(r.id) || [] }));
}

module.exports = { savePhotoTags, attachTagsToPhotos };
