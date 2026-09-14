/**
 * navigator.js — moteur de navigation dans l'arbre (v4, simplifié).
 *
 * CHAMPS AJOUTÉS SUR LES NŒUDS CRITÈRE (v4.2)
 * ─────────────────────────────────────────────
 * `excluded`          boolean — un autre membre du même exclusionGroup est coché.
 * `previewClassement` string|null — classement le plus grave parmi les constats
 *                     enfants directs de ce critère. Permet à l'UI d'afficher
 *                     la couleur de sévérité attendue AVANT que l'inspecteur
 *                     coche le nœud. null si pas de constat direct pertinent.
 */

import { compareSeverity } from './severity.js';

// ─── Sections (onglets) ────────────────────────────────────────────────────

/** Liste des sections (nœuds racine `categorie`), triées par numéro. */
export function getSections(tree) {
  return Object.entries(tree)
    .filter(([, n]) => n.type === 'categorie')
    .map(([id, n]) => ({ id, label: n.label }))
    .sort((a, b) => {
      const na = parseInt((a.label.match(/\d+/) || [])[0] || '99', 10);
      const nb = parseInt((b.label.match(/\d+/) || [])[0] || '99', 10);
      return na - nb;
    });
}

// ─── État coché / déplié ────────────────────────────────────────────────────

export function isChecked(nodeId, answers) {
  return !!answers?.[nodeId]?.checked;
}

export function isExpanded(nodeId, tree, answers) {
  const node = tree[nodeId];
  if (!node) return false;
  if (node.parentId === null) return true;
  const parent = tree[node.parentId];
  if (!parent) return false;
  if (parent.type === 'categorie') return true;
  if (parent.type === 'header') return isExpanded(node.parentId, tree, answers);
  if (parent.type === 'critere') return isChecked(node.parentId, answers);
  return false;
}

// ─── Groupes d'exclusion (radio) ────────────────────────────────────────────

export function exclusionGroupMembers(nodeId, tree) {
  const node = tree[nodeId];
  if (!node?.exclusionGroup) return [nodeId];
  return Object.keys(tree).filter(id => tree[id]?.exclusionGroup === node.exclusionGroup);
}

export function toggleCritere(nodeId, tree, answers, checked) {
  const node = tree[nodeId];
  if (!node) return answers;
  const next = { ...answers };
  if (checked && node.exclusionGroup) {
    for (const sibId of exclusionGroupMembers(nodeId, tree)) {
      if (sibId !== nodeId) next[sibId] = { ...(next[sibId] || {}), checked: false };
    }
  }
  next[nodeId] = { ...(next[nodeId] || {}), checked };
  return next;
}

// ─── Nettoyage en cascade ─────────────────────────────────────────────────

export function collectDescendantAnswerIds(nodeId, tree, answers) {
  const ids = [];
  const node = tree[nodeId];
  if (!node) return ids;
  for (const childId of (node.children || [])) {
    const child = tree[childId];
    if (!child) continue;
    if (child.type === 'constat' || child.type === 'recommandation') continue;
    if (answers[childId] !== undefined) ids.push(childId);
    ids.push(...collectDescendantAnswerIds(childId, tree, answers));
  }
  return ids;
}

export function hasDescendantAnswers(nodeId, tree, answers) {
  return collectDescendantAnswerIds(nodeId, tree, answers).length > 0;
}

// ─── Réparation des données orphelines ────────────────────────────────────

function collectVisibleNodeIds(tree, answers) {
  const visible = new Set();
  function walk(nodeId) {
    const node = tree[nodeId];
    if (!node) return;
    for (const childId of (node.children || [])) {
      const child = tree[childId];
      if (!child) continue;
      if (child.type === 'constat' || child.type === 'recommandation') continue;
      visible.add(childId);
      if (child.type === 'header') { walk(childId); continue; }
      if (child.type === 'critere' && isChecked(childId, answers)) walk(childId);
    }
  }
  Object.entries(tree)
    .filter(([, n]) => n.type === 'categorie')
    .forEach(([id]) => walk(id));
  return visible;
}

export function repairOrphanedData(session, tree) {
  const answersIn = session.answers || {};
  const visible = collectVisibleNodeIds(tree, answersIn);

  const answers = {};
  for (const [id, ans] of Object.entries(answersIn)) {
    if (visible.has(id)) answers[id] = ans;
  }
  const constats = (session.constats || []).filter(c => visible.has(c.nodeId));
  const saisies  = (session.saisies  || []).filter(s => visible.has(s.nodeId));

  const removedCount =
    (Object.keys(answersIn).length - Object.keys(answers).length) +
    ((session.constats || []).length - constats.length) +
    ((session.saisies  || []).length - saisies.length);

  return { session: { ...session, answers, constats, saisies }, removedCount };
}

// ─── Constats rattachés ──────────────────────────────────────────────────────

export function collectRecords(node, tree) {
  const records = [];
  const cstNodes  = (node.children || []).map(id => tree[id]).filter(n => n && n.type === 'constat');
  const recoNodes = (node.children || []).map(id => tree[id]).filter(n => n && n.type === 'recommandation');
  const maxLen = Math.max(cstNodes.length, recoNodes.length, 1);
  for (let i = 0; i < maxLen; i++) {
    records.push({ cst: cstNodes[i] || null, reco: recoNodes[i] || null });
  }
  return records;
}

// ─── Preview de sévérité ─────────────────────────────────────────────────────

/**
 * Retourne le classement le plus grave parmi les enfants `constat` directs
 * d'un nœud critère. `Simple constat` est exclu (pas pertinent visuellement).
 * Retourne null si aucun constat pertinent n'est trouvé.
 *
 * O(children) — appelé pour chaque critère pendant buildVisibleTree.
 */
function _worstConstatClassement(node, tree) {
  const relevant = (node.children || [])
    .map(id => tree[id])
    .filter(n => n?.type === 'constat' && n.classement && n.classement !== 'Simple constat')
    .map(n => n.classement);

  if (!relevant.length) return null;

  return relevant.reduce((worst, c) =>
    compareSeverity(c, worst) < 0 ? c : worst
  );
}

// ─── Construction de l'arbre visible ──────────────────────────────────────────

/**
 * Construit l'arborescence visible d'une section. Chaque nœud critère reçoit :
 *   - `excluded`          boolean
 *   - `previewClassement` string|null
 */
export function buildVisibleTree(sectionId, tree, answers) {
  if (!tree[sectionId]) return [];

  // Pré-calcul O(n) : groupes d'exclusion ayant un membre coché
  const activeGroups = new Set();
  for (const [id, node] of Object.entries(tree)) {
    if (node.exclusionGroup && isChecked(id, answers)) {
      activeGroups.add(node.exclusionGroup);
    }
  }

  return _buildChildren(sectionId, tree, answers, activeGroups);
}

function _buildChildren(nodeId, tree, answers, activeGroups) {
  const node = tree[nodeId];
  if (!node) return [];
  const out = [];

  for (const childId of (node.children || [])) {
    const child = tree[childId];
    if (!child) continue;
    if (child.type === 'constat' || child.type === 'recommandation') continue;

    if (child.type === 'header') {
      out.push({
        id: childId,
        type: 'header',
        label: child.label,
        children: _buildChildren(childId, tree, answers, activeGroups),
      });
      continue;
    }

    if (child.type === 'saisie_valeur') {
      out.push({
        id: childId,
        type: 'saisie_valeur',
        label: child.label,
        value: answers[childId]?.value ?? null,
      });
      continue;
    }

    if (child.type === 'critere') {
      const checked = isChecked(childId, answers);
      const excluded = !checked && !!child.exclusionGroup && activeGroups.has(child.exclusionGroup);

      out.push({
        id: childId,
        type: 'critere',
        label: child.label,
        exclusionGroup: child.exclusionGroup || null,
        checked,
        excluded,
        previewClassement: _worstConstatClassement(child, tree),
        records: checked ? collectRecords(child, tree) : [],
        children: checked ? _buildChildren(childId, tree, answers, activeGroups) : [],
      });
    }
  }
  return out;
}

// ─── Progression ─────────────────────────────────────────────────────────────

export function sectionProgress(sectionId, tree, answers) {
  let total = 0, done = 0;

  function walk(nodeId) {
    const node = tree[nodeId];
    if (!node) return;
    for (const childId of (node.children || [])) {
      const child = tree[childId];
      if (!child) continue;
      if (child.type === 'constat' || child.type === 'recommandation') continue;

      if (child.type === 'header') { walk(childId); continue; }

      if (child.type === 'saisie_valeur') {
        total++;
        if (answers[childId]) done++;
        continue;
      }

      if (child.type === 'critere') {
        total++;
        const checked = isChecked(childId, answers);
        if (answers[childId]) done++;
        if (checked) walk(childId);
      }
    }
  }
  walk(sectionId);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
