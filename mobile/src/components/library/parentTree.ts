export interface AlbumTreeNode {
  id: number;
  parent_id?: number | null;
}

export function computeDepth<T extends AlbumTreeNode>(album: T, albums: T[]): number {
  const ids = new Set(albums.map((a) => a.id));
  let depth = 0;
  let cur: number | null | undefined = album.parent_id;
  const seen = new Set<number>();
  while (cur != null && ids.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    depth++;
    if (depth > 32) break;
    const parent = albums.find((a) => a.id === cur);
    cur = parent?.parent_id;
  }
  return depth;
}

export function computeAncestorChain<T extends AlbumTreeNode>(
  albums: T[],
  leafId: number,
): T[] {
  const byId = new Map(albums.map((a) => [a.id, a] as const));
  const chain: T[] = [];
  const seen = new Set<number>();
  let curId: number | null | undefined = leafId;
  while (curId != null && !seen.has(curId)) {
    seen.add(curId);
    const a = byId.get(curId);
    if (!a) break;
    chain.unshift(a);
    curId = a.parent_id;
  }
  return chain;
}

export function computeDescendantIds<T extends AlbumTreeNode>(
  albums: T[],
  rootId: number,
): Set<number> {
  const childrenByParent = new Map<number, T[]>();
  for (const a of albums) {
    if (a.parent_id == null) continue;
    const list = childrenByParent.get(a.parent_id) ?? [];
    list.push(a);
    childrenByParent.set(a.parent_id, list);
  }
  const out = new Set<number>();
  const stack = [rootId];
  const seen = new Set<number>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const kids = childrenByParent.get(id) ?? [];
    for (const k of kids) {
      if (k.id === rootId) continue;
      out.add(k.id);
      stack.push(k.id);
    }
  }
  return out;
}

export function buildParentOptions<T extends { id: number; parent_id?: number | null }>(
  albums: T[],
  excludeIds?: Set<number>,
): Array<{ album: T; depth: number }> {
  const byId = new Map<number, T>();
  const childrenByParent = new Map<number, T[]>();
  for (const a of albums) {
    byId.set(a.id, a);
    if (a.parent_id != null) {
      const list = childrenByParent.get(a.parent_id) ?? [];
      list.push(a);
      childrenByParent.set(a.parent_id, list);
    }
  }
  const out: Array<{ album: T; depth: number }> = [];
  const visited = new Set<number>();
  const walk = (node: T, depth: number) => {
    if (excludeIds?.has(node.id)) return;
    if (visited.has(node.id)) return;
    visited.add(node.id);
    out.push({ album: node, depth });
    for (const child of childrenByParent.get(node.id) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const a of albums) {
    if (a.parent_id == null || !byId.has(a.parent_id)) {
      walk(a, 0);
    }
  }
  return out;
}
