/**
 * docxBuilder — generates the filled Word report from a session.
 *
 * Uses docxtemplater + PizZip to replace {balise} placeholders in
 * Trame_rapport_avec_balises.docx with session constats and metadata.
 *
 * The template file is expected at /public/Trame_rapport_avec_balises.docx
 * and is cached by the service worker for offline use.
 *
 * Returns an ArrayBuffer (the finished .docx) suitable for JSZip.
 */

import PizZip       from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { compareSeverity } from '../engine/severity.js';
import { computeVerdict }  from '../engine/verdict.js';

/** Format an ISO date (YYYY-MM-DD) for display in the report. */
function formatDateForReport(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
}

/** Load the docx template as an ArrayBuffer (cached by SW). */
async function loadTemplate() {
  const res = await fetch('/Trame_rapport_avec_balises.docx');
  if (!res.ok) throw new Error(`Impossible de charger le template DOCX (${res.status})`);
  return res.arrayBuffer();
}

// ─── Registre des balises : configuration chargée au runtime ───────────────
//
// balise_registry.json (kit du SPANC, servi depuis /public/ comme tree.json)
// peut contenir :
//   - `defaultTexts: { balise: "texte" }` — texte spécifique à UNE balise,
//   - `defaultFallbackText: "texte"`      — texte de repli global, utilisé
//     pour toute balise sans entrée dans defaultTexts,
//   - `displayBlocks: { blocId: { flag, balises, children? } }` — la liste
//     des blocs conditionnels du template DOCX ({#afficher_x}...{/afficher_x})
//     et des balises qui déclenchent leur affichage (voir buildAffichageFlags
//     plus bas pour le détail du format).
// Les trois sont des choix propres au kit SPANC, éditables depuis
// ANC_TreeEditor_v4.html (panneau 🏷️ Balises). Il n'y a AUCUNE règle basée
// sur le nom d'un bloc ou d'une balise (préfixe reco_, suffixe _type, etc.)
// codée en dur ici : adapter un autre SPANC ou faire évoluer le template se
// fait en éditant balise_registry.json, sans toucher à ce fichier.
//
// Si le kit ne fournit pas encore `displayBlocks` (ancien format du fichier,
// ou fichier absent), DEFAULT_DISPLAY_BLOCKS sert de filet de sécurité pour
// ne pas casser la génération du rapport — voir plus bas. Un avertissement
// est loggé dans la console dans ce cas, pour signaler qu'il vaut mieux
// migrer balise_registry.json plutôt que de rester sur ce filet.

/**
 * Filet de sécurité UNIQUEMENT — reprend l'état des blocs conditionnels du
 * template au moment de la migration vers displayBlocks. Ne pas faire
 * évoluer cette constante pour suivre de futurs changements du template :
 * ces changements doivent être faits dans balise_registry.json (édité via
 * le panneau 🏷️ Balises de ANC_TreeEditor_v4.html), pas ici.
 */
const DEFAULT_DISPLAY_BLOCKS = {
  canaEU:     { flag: 'afficher_canaEU', balises: ['canaEU_acces', 'canaEU_parasites', 'canaEU_entretien', 'canaEU_structurel', 'conclusions_canaEU', 'reco_canaEU_conformité', 'reco_canaEU_bf'] },
  bag:        { flag: 'afficher_bag', balises: ['BàG_acces', 'BàG_dimensions', 'BàG_parasites', 'BàG_entretien', 'BàG_structurel'] },
  fosse:      { flag: 'afficher_fosse', balises: ['fosse_acces', 'fosse_dimensions', 'fosse_parasites', 'fosse_entretien', 'fosse_structurel', 'fosse_ventilation'] },
  prefiltre:  { flag: 'afficher_prefiltre', balises: ['prefiltre_type', 'prefiltre_entretien'] },
  primaire:   { flag: 'afficher_primaire', children: ['bag', 'fosse', 'prefiltre'], balises: ['conclusions_primaire', 'reco_primaire_conformité', 'reco_primaire_bf'] },
  secondaire: { flag: 'afficher_secondaire', balises: ['secondaire_type', 'secondaire_acces', 'secondaire_dimensions', 'secondaire_parasites', 'secondaire_regard_repartition', 'secondaire_regard_bouclage', 'secondaire_regard_collecte', 'conclusions_secondaire', 'reco_secondaire_conformité', 'reco_secondaire_bf'] },
  fa:         { flag: 'afficher_fa', balises: ['fa_type', 'fa_dimensions', 'fa_agrement', 'fa_parasites', 'fa_entretien', 'fa_structurel', 'conclusions_fa', 'reco_fa_conformité', 'reco_fa_bf'] },
  pr:         { flag: 'afficher_pr', balises: ['annexe_PR_acces', 'annexe_PR_dimensions', 'annexe_PR_parasites', 'annexe_PR_entretien', 'annexe_PR_structurel'] },
  ca:         { flag: 'afficher_ca', balises: ['annexe_CA_acces', 'annexe_CA_dimensions', 'annexe_CA_parasites', 'annexe_CA_entretien', 'annexe_CA_structurel'] },
  pe:         { flag: 'afficher_pe', balises: ['annexe_PE_acces', 'annexe_PE_dimensions', 'annexe_PE_parasites', 'annexe_PE_entretien', 'annexe_PE_structurel'] },
  annexes:    { flag: 'afficher_annexes', children: ['pr', 'ca', 'pe'], balises: ['conclusions_annexes', 'reco_annexe_conformité', 'reco_annexe_bf'] },
  rejet:      { flag: 'afficher_rejet', balises: ['rejet_type', 'rejet_pb', 'conclusions_rejet', 'reco_rejet_conformité', 'reco_rejet_bf'] },
  // Balises imprimées inconditionnellement (section I/II + "Implantation"),
  // jamais derrière un {#afficher_x} dans le template — pas de `flag` ici,
  // seulement `alwaysVisible` pour qu'elles bénéficient du texte de
  // remplacement au même titre que les balises d'un bloc conditionnel visible.
  toujoursVisible: {
    alwaysVisible: true,
    balises: [
      'zone_enjeu', 'habitation', 'PP', 'Année_constr', 'obl_travaux',
      'acces_installation', 'obstacle_acces', 'note_accessibilite',
      'cadre_visite', 'cadre_visite2', 'implantation',
      'reco_acces_conformité', 'reco_contexte_conformité', 'reco_zone_enjeu_conformité',
      'reco_implantation_conformité', 'reco_implantation_bf',
    ],
  },
};

function _warnUsingFallbackDisplayBlocks() {
  console.warn(
    "[docxBuilder] balise_registry.json ne fournit pas (encore) de clé 'displayBlocks' : " +
    "utilisation d'une configuration de secours codée en dur (état du template au moment " +
    "de cette migration). Ajoutez 'displayBlocks' à balise_registry.json pour reprendre la " +
    "main sur les blocs conditionnels sans redéployer l'application."
  );
}

let _baliseConfigCache = null;

/** Charge defaultTexts + defaultFallbackText + displayBlocks de balise_registry.json (cache mémoire). */
async function loadBaliseConfig() {
  if (_baliseConfigCache) return _baliseConfigCache;
  try {
    const res = await fetch('/balise_registry.json');
    if (!res.ok) {
      _warnUsingFallbackDisplayBlocks();
      _baliseConfigCache = { defaultTexts: {}, fallbackText: '', displayBlocks: DEFAULT_DISPLAY_BLOCKS };
      return _baliseConfigCache;
    }
    const json = await res.json();
    const hasDisplayBlocks = !!(json && json.displayBlocks && typeof json.displayBlocks === 'object'
      && Object.keys(json.displayBlocks).length > 0);
    if (!hasDisplayBlocks) _warnUsingFallbackDisplayBlocks();
    _baliseConfigCache = {
      defaultTexts: (json && typeof json.defaultTexts === 'object' && json.defaultTexts) || {},
      fallbackText: (json && typeof json.defaultFallbackText === 'string') ? json.defaultFallbackText : '',
      displayBlocks: hasDisplayBlocks ? json.displayBlocks : DEFAULT_DISPLAY_BLOCKS,
    };
  } catch (e) {
    // Kit sans balise_registry.json ou fichier invalide : pas bloquant, filet de secours.
    _warnUsingFallbackDisplayBlocks();
    _baliseConfigCache = { defaultTexts: {}, fallbackText: '', displayBlocks: DEFAULT_DISPLAY_BLOCKS };
  }
  return _baliseConfigCache;
}

/** Texte à utiliser pour une balise vide : texte spécifique, sinon repli global, sinon ''. */
function resolveDefaultText(balise, defaultTexts, fallbackText) {
  const override = defaultTexts ? defaultTexts[balise] : undefined;
  if (override !== undefined && override !== null && String(override).trim() !== '') {
    return override;
  }
  return fallbackText || '';
}

/**
 * Remplit dans `map` les balises de la liste `balises` qui sont encore
 * vides, avec leur texte de remplacement. N'est appelé QUE pour les balises
 * appartenant à un bloc conditionnel actuellement affiché (voir
 * buildAffichageFlags / activeBalises) — les balises toujours visibles
 * (section I/II, métadonnées) ne sont pas concernées par ce mécanisme.
 */
function applyDefaultTexts(map, balises, defaultTexts, fallbackText) {
  for (const balise of balises) {
    const current = map[balise];
    if (current === undefined || current === null || String(current).trim() === '') {
      map[balise] = resolveDefaultText(balise, defaultTexts, fallbackText);
    }
  }
}

/**
 * Build the placeholder map from session data.
 *
 * Multiple constats sharing a balise are concatenated with a newline,
 * sorted by severity (desc) then nodeId (asc) — matching the locked spec.
 */
function buildPlaceholders(session, { defaultTexts = {}, fallbackText = '', displayBlocks = null } = {}) {
  const { admin, constats = [], saisies = [] } = session;
  const verdict = computeVerdict(constats);

  // ── Métadonnées admin (injectées directement depuis session.admin) ─────────
  // Les balises de contenu (cadre_visite2, habitation, PP, Année_constr,
  // zone_enjeu, etc.) sont renseignées automatiquement par les boucles
  // constats/saisies ci-dessous, à partir de leur propre champ `section`.
  // La Proxy en fin de fonction retourne '' pour toute balise absente du map,
  // donc il est inutile de pré-remplir ici les balises qui seront couvertes
  // par un nœud constat/saisie de l'arbre.
  const map = {
    date_visite: formatDateForReport(admin.date_visite),
    nom_prenom:  admin.nom_proprietaire,
    adresse:     admin.adresse,
    // Verdict checkboxes (☑ ou ☐)
    chk_conforme:         verdict.conforme ? '☑' : '☐',
    chk_non_conforme:     !verdict.conforme ? '☑' : '☐',
    chk_conforme_complete: verdict.checkboxes.conforme_complete ? '☑' : '☐',
    chk_conforme_reco:     verdict.checkboxes.conforme_reco     ? '☑' : '☐',
    chk_sans_risque:       verdict.checkboxes.sans_risque       ? '☑' : '☐',
    chk_rejet_superficiel: verdict.checkboxes.rejet_superficiel ? '☑' : '☐',
    chk_risque_sanitaire:  verdict.checkboxes.risque_sanitaire  ? '☑' : '☐',
    chk_absence_installation: verdict.checkboxes.absence_installation ? '☑' : '☐',
    verdict_summary: verdict.summaryText,
  };

  // ── Saisies numériques ───────────────────────────────────────────────────
  for (const sv of saisies) {
    if (sv.balise) map[sv.balise] = String(sv.valeur);
  }

  // ── Constats → group by balise_constat, sorted ───────────────────────────
  const constatsByBalise = {};
  const recosByBalise    = {};

  const sorted = [...constats].sort((a, b) =>
    compareSeverity(a.classement, b.classement) || a.nodeId.localeCompare(b.nodeId)
  );

  for (const cst of sorted) {
    const bc = cst.balise_constat;
    const br = cst.balise_reco;
    if (bc) {
      if (!constatsByBalise[bc]) constatsByBalise[bc] = [];
      let text = cst.label_constat || '';
      if (cst.note_libre) text += `\n[Note : ${cst.note_libre}]`;
      constatsByBalise[bc].push(text);
    }
    if (br) {
      if (!recosByBalise[br]) recosByBalise[br] = [];
      if (cst.label_reco) recosByBalise[br].push(cst.label_reco);
    }
  }

  for (const [balise, lines] of Object.entries(constatsByBalise)) {
    map[balise] = lines.join('\n\n');
  }
  for (const [balise, lines] of Object.entries(recosByBalise)) {
    // Deduplicate reco text (multiple constats may share same reco wording)
    map[balise] = [...new Set(lines)].join('\n\n');
  }

  // ── Affichage conditionnel des sections/tableaux (docxtemplater {#afficher_x}) ──
  // Une section/tableau ne s'affiche dans le rapport que si au moins une de ses
  // balises contient réellement du texte (constat, saisie ou recommandation).
  // Calculé ICI (après remplissage du map ci-dessus) pour rester fidèle à ce qui
  // sera effectivement imprimé, indépendamment d'éventuels décalages de nommage
  // entre tree.json et le template.
  const { flags, activeBalises } = buildAffichageFlags(map, displayBlocks);
  Object.assign(map, flags);

  // ── Textes de remplacement pour les balises vides des blocs affichés ─────
  // IMPORTANT : appliqué APRÈS le calcul des flags ci-dessus, sinon toute
  // balise aurait toujours du texte et toutes les sections s'afficheraient
  // toujours. La visibilité se décide sur les données brutes ; le texte de
  // remplacement ne fait que "décorer" les balises vides des blocs déjà
  // décidés visibles.
  applyDefaultTexts(map, activeBalises, defaultTexts, fallbackText);

  // Fill any template placeholder that hasn't been set with empty string
  // (prevents docxtemplater "tag not found" errors)
  return new Proxy(map, {
    get: (target, prop) => (prop in target ? target[prop] : ''),
  });
}

/** True si au moins une des balises listées contient du texte non vide dans map. */
function _hasContent(map, balises) {
  return balises.some((b) => {
    const v = map[b];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
}

/**
 * Calcule récursivement si un bloc `displayBlocks[key]` est visible :
 *   - un bloc `alwaysVisible: true` est toujours visible, quel que soit son
 *     contenu — utilisé pour les balises qui ne sont derrière AUCUN
 *     {#afficher_x} dans le template (section I/II, "Implantation") : elles
 *     s'impriment de toute façon, donc leurs balises vides doivent recevoir
 *     un texte de remplacement au même titre que celles d'un bloc conditionnel
 *     visible ;
 *   - sinon, visible si au moins une de ses `balises` contient du texte, OU
 *     si au moins un de ses `children` (autres clés de blocs) l'est.
 * `children` permet à un bloc parent (ex : "primaire") de s'afficher dès
 * qu'un sous-bloc (ex : "fosse") a du contenu, même sans balise propre.
 * Mémoïse (`cache`) et détecte les cycles (`path`) pour rester sûr même si
 * balise_registry.json contient une configuration mal formée.
 */
function _computeBlockVisibility(key, blocks, map, cache, path) {
  if (cache.has(key)) return cache.get(key);
  const block = blocks[key];
  if (!block) return false;
  if (block.alwaysVisible) { cache.set(key, true); return true; }
  if (path.has(key)) {
    console.warn(`[docxBuilder] Cycle détecté dans displayBlocks autour de "${key}" — traité comme non visible.`);
    return false;
  }
  path.add(key);
  const ownVisible = _hasContent(map, block.balises || []);
  const childrenVisible = (block.children || []).some(
    (childKey) => _computeBlockVisibility(childKey, blocks, map, cache, path)
  );
  path.delete(key);
  const visible = ownVisible || childrenVisible;
  cache.set(key, visible);
  return visible;
}

/**
 * Calcule les indicateurs booléens afficher_* pilotant les blocs conditionnels
 * du template DOCX ({#afficher_x}...{/afficher_x}), ET la liste des balises
 * appartenant à un bloc actuellement affiché (utilisée ensuite pour appliquer
 * les textes de remplacement des balises vides).
 *
 * Moteur générique : la structure des blocs (quelles balises déclenchent
 * quel flag, quels blocs parents dépendent de quels sous-blocs, quels blocs
 * sont toujours visibles) vient de `displayBlocks`, chargé depuis
 * balise_registry.json (voir loadBaliseConfig plus haut) — rien n'est codé
 * en dur ici. Format de chaque bloc :
 *   { flag?: "afficher_x", balises: [...], children?: [...], alwaysVisible?: true }
 * `flag` est optionnel : un bloc sans balise conditionnelle correspondante
 * dans le template (ex : les champs toujours imprimés de la section I/II)
 * n'a pas besoin de flag — seules ses `balises` comptent, pour bénéficier du
 * texte de remplacement même sans être derrière un {#afficher_x}.
 * Si balise_registry.json ne fournit pas encore `displayBlocks`,
 * DEFAULT_DISPLAY_BLOCKS sert de filet de sécurité (voir plus haut).
 */
function buildAffichageFlags(map, displayBlocks) {
  const blocks = displayBlocks || DEFAULT_DISPLAY_BLOCKS;
  const cache = new Map();
  const flags = {};
  const activeBalises = [];

  for (const key of Object.keys(blocks)) {
    const block = blocks[key] || {};
    const visible = _computeBlockVisibility(key, blocks, map, cache, new Set());
    if (block.flag) flags[block.flag] = visible;
    if (visible && Array.isArray(block.balises)) {
      activeBalises.push(...block.balises);
    }
  }

  return { flags, activeBalises };
}

/**
 * Generate the filled DOCX.
 * @returns {Promise<Uint8Array>}
 */
export async function buildDocx(session) {
  const templateBuffer = await loadTemplate();
  const zip = new PizZip(templateBuffer);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks:    true,
    // nullGetter: return empty string for missing tags instead of throwing
    nullGetter: () => '',
  });

  const config = await loadBaliseConfig();
  const placeholders = buildPlaceholders(session, config);
  doc.render(placeholders);

  return doc.getZip().generate({ type: 'uint8array' });
}
