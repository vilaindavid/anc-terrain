/**
 * navigator.js — moteur de navigation dans l'arbre (v4, simplifié).
 *
 * Le tree (tree.json) est une map plate { nodeId → node }.
 * Modèle d'affichage : l'app affiche l'arborescence complète d'une section
 * (un onglet par nœud racine `categorie`), dépliée au fur et à mesure des
 * réponses — pas de file de questions séquentielle, pas de "gate".
 *
 * RÈGLES (toute la logique vient de la structure de l'arbre, pas du code) :
 * ──────────────────────────────────────────────────────────────────────
 * - `categorie`      racine de section = onglet. Toujours "actif" (déplié).
 * - `header`         simple titre de sous-partie. Jamais coché : se déplie
 *                     automatiquement dès que son parent est actif.
 * - `critere`        ligne à cocher.
 *                       - a un `exclusionGroup`  → fait partie d'un groupe
 *                         radio (un seul coché parmi tous les nœuds de
 *                         l'arbre partageant la même valeur d'exclusionGroup).
 *                       - pas d'`exclusionGroup`  → case à cocher indépendante.
 *                     Cocher un critère déplie ses enfants.
 * - `saisie_valeur`   ligne de saisie numérique, pas d'enfants à déplier.
 * - `constat` / `recommandation`  jamais affichés comme lignes de l'arbre :
 *                     ce sont les résultats rattachés au critère coché
 *                     (exposés via `records`).
 *
 * RÉPONSES (session.answers)
 * ───────────────────────────
 * answers est un objet { nodeId → answer } :
 *   { checked: true|false }   pour un critere
 *   { value: number }         pour un saisie_valeur
 * Rien n'est jamais "verrouillé" : décocher ne supprime pas les réponses
 * plus profondes, elles réapparaissent si on recoche.
 *
 * CHAMP `excluded` (v4.1)
 * ───────────────────────
 * Un critère appartenant à un exclusionGroup dont un autre membre est coché
 * reçoit `excluded: true` dans l'arbre visible. L'UI peut alors le griser
 * pour indiquer visuellement qu'il a été écarté par la sélection courante.
 * Le clic reste fonctionnel (permet de changer la sélection dans le groupe).
 */

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

/**
 * Un nœud est "actif" (ses enfants doivent être affichés) si :
 * - c'est une racine de section (toujours actif), ou
 * - son parent est un `header` actif (pass-through), ou
 * - son parent est un `critere` coché.
 */
export function isExpanded(nodeId, tree, answers) {
  const node = tree[nodeId];
  if (!node) return false;
  if (node.parentId === null) return true; // racine de section
  const parent = tree[node.parentId];
  if (!parent) return false;
  if (parent.type === 'categorie') return true;
  if (parent.type === 'header') return isExpanded(node.parentId, tree, answers);
  if (parent.type === 'critere') return isChecked(node.parentId, answers);
  return false;
}

// ─── Groupes d'exclusion (radio) ────────────────────────────────────────────

/**
 * Tous les nœuds de l'arbre partageant la même valeur d'exclusionGroup
 * (comparaison globale par valeur, pas seulement entre frères — cohérent
 * avec ANC_TreeEditor_v3.html, qui traite déjà exclusionGroup ainsi).
 */
export function exclusionGroupMembers(nodeId, tree) {
  const node = tree[nodeId];
  if (!node?.exclusionGroup) return [nodeId];
  return Object.keys(tree).filter(id => tree[id]?.exclusionGroup === node.exclusionGroup);
}

/**
 * Coche/décoche un critère. Si `checked` et que le nœud a un exclusionGroup,
 * décoche d'abord tous les autres membres du groupe (comportement radio).
 * Retourne un nouvel objet answers (immuable).
 */
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

// NB : il n'y a pas de setSaisieValue() ici — l'écriture d'une saisie passe
// toujours par db.recordSaisie(), qui est la seule source de vérité pour
// answers[nodeId] ET saisies[] (les deux doivent rester synchronisés, voir
// commentaire dans db.js).

// ─── Nettoyage en cascade (décochage / remplacement radio) ────────────────

/**
 * Liste les nodeId de tous les descendants de `nodeId` qui possèdent une
 * réponse enregistrée dans `answers` — un critère coché ou décoché, ou une
 * saisie_valeur avec une valeur. Descend dans TOUS les enfants (pas
 * seulement ceux actuellement dépliés/affichés), car on veut pouvoir
 * nettoyer même une branche déjà masquée suite à un décochage antérieur
 * incomplet.
 */
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

/** true si `nodeId` a au moins un descendant avec une réponse enregistrée. */
export function hasDescendantAnswers(nodeId, tree, answers) {
  return collectDescendantAnswerIds(nodeId, tree, answers).length > 0;
}

// ─── Réparation des données orphelines (reprise d'une session) ─────────────

/**
 * Ensemble des nodeId actuellement "visibles" dans l'arbre complet (chaîne
 * de parents intégralement dépliée/cochée), toutes sections confondues.
 * Sert de référence pour repérer les réponses orphelines.
 */
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

/**
 * Purge les answers/constats/saisies dont la chaîne de parents n'est plus
 * intégralement cochée dans l'arbre actuel (données "orphelines"). Corrige
 * les sessions enregistrées avant l'introduction du nettoyage en cascade,
 * où décocher un critère ne supprimait pas toujours les réponses de ses
 * descendants (elles restaient invisibles à l'écran mais actives dans le
 * verdict et l'export DOCX).
 *
 * Fonction pure : ne modifie pas `session`, ne sauvegarde rien. L'appelant
 * décide d'enregistrer le résultat si `removedCount > 0`.
 */
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

// ─── Constats / recommandations rattachés ──────────────────────────────────

/**
 * Constats/recommandations à enregistrer automatiquement quand `node`
 * (un critère qui vient d'être coché) est actif. Appariés par index,
 * comme avant (généralement 1 constat : 0 ou 1 recommandation).
 */
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

// ─── Construction de l'arbre visible (pour l'UI) ───────────────────────────

/**
 * Construit l'arborescence actuellement visible d'une section, prête à être
 * rendue récursivement par un composant. Chaque nœud a la forme :
 *
 *   header:       { id, type:'header', label, children }
 *   saisie_valeur:{ id, type:'saisie_valeur', label, value }
 *   critere:      { id, type:'critere', label, exclusionGroup, checked,
 *                    excluded, records, children }
 *
 * `children` ne contient que les nœuds affichables (headers toujours
 * déroulés, critere déroulé seulement si coché). constat/recommandation
 * n'apparaissent jamais comme lignes : ils sont exposés via `records`.
 *
 * `excluded` est true quand un autre membre du même exclusionGroup est coché.
 * L'UI grise le nœud pour indiquer qu'il est écarté, mais le clic reste
 * possible (change la sélection dans le groupe radio).
 */
export function buildVisibleTree(sectionId, tree, answers) {
  if (!tree[sectionId]) return [];

  // Pré-calcul unique (O(n)) : groupes d'exclusion qui ont un membre coché.
  // Évite de rescanner tout l'arbre pour chaque critère pendant _buildChildren.
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
        children: _buildChildren(childId, tree, answers, activeGroups), // toujours déplié
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
      // excluded = un autre membre du même groupe radio est actuellement coché
      const excluded = !checked &&
        !!child.exclusionGroup &&
        activeGroups.has(child.exclusionGroup);

      out.push({
        id: childId,
        type: 'critere',
        label: child.label,
        exclusionGroup: child.exclusionGroup || null,
        checked,
        excluded,
        records: checked ? collectRecords(child, tree) : [],
        children: checked ? _buildChildren(childId, tree, answers, activeGroups) : [],
      });
    }
  }
  return out;
}

// ─── Progression ────────────────────────────────────────────────────────────

/**
 * Progression sur une section : nombre de critere/saisie_valeur actuellement
 * visibles et déjà renseignés (les branches non dépliées ne comptent pas
 * tant qu'elles ne sont pas révélées, ce qui reflète l'effort restant réel).
 */
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
