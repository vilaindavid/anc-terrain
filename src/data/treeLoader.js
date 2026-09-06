/**
 * Load and normalise tree.json.
 *
 * tree.json is a flat map { nodeId → node } where nodes do NOT embed their
 * own key. We enrich each node with `node._id = key` so the rest of the app
 * never has to carry (id, node) pairs separately.
 *
 * The file lives in /public/tree.json and is cached by the service worker.
 */

let _tree = null;

export async function loadTree() {
  if (_tree) return _tree;

  const res = await fetch('/tree.json');
  if (!res.ok) throw new Error(`Cannot load tree.json: ${res.status}`);

  const raw = await res.json();

  // Enrich with self-referential _id
  for (const [id, node] of Object.entries(raw)) {
    node._id = id;
  }

  _tree = raw;
  return _tree;
}

/** Cached tree access (throws if loadTree hasn't been called). */
export function getTree() {
  if (!_tree) throw new Error('Tree not loaded yet. Call loadTree() first.');
  return _tree;
}

/**
 * Return a flat array of all constat/recommandation nodes across the tree,
 * useful for building the docx placeholder map.
 */
export function allConstats(tree) {
  return Object.values(tree).filter(n => n.type === 'constat');
}

export function allRecos(tree) {
  return Object.values(tree).filter(n => n.type === 'recommandation');
}

/**
 * Walk upward from nodeId to build a breadcrumb path.
 * Returns array of { id, label, type }.
 */
export function breadcrumb(nodeId, tree) {
  const path = [];
  let current = tree[nodeId];
  while (current) {
    path.unshift({ id: current._id, label: current.label, type: current.type });
    current = current.parentId ? tree[current.parentId] : null;
  }
  return path;
}

/**
 * Get section label (categorie.label) for any node.
 */
export function sectionLabel(nodeId, tree) {
  let current = tree[nodeId];
  while (current) {
    if (current.type === 'categorie') return current.label;
    current = current.parentId ? tree[current.parentId] : null;
  }
  return '';
}
