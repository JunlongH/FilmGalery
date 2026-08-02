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
