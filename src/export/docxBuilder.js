/**
 * docxBuilder — generates the filled Word report from a session.
 *
 * Uses docxtemplater + PizZip to replace {balise} placeholders in
 * Trame_rapport_avec_balises.docx with session constats and metadata.
 *
 * The template file is expected at /public/Trame_rapport_avec_balises.docx
 * and is cached by the service worker for offline use.
 *
 * IMPORTANT (GitHub Pages) : on utilise `import.meta.env.BASE_URL` au lieu
 * d'un chemin absolu commençant par "/", car l'application peut être servie
 * depuis un sous-dossier (ex : https://utilisateur.github.io/anc-terrain/).
 * BASE_URL contient déjà le bon préfixe et se termine toujours par "/".
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
  const res = await fetch(`${import.meta.env.BASE_URL}Trame_rapport_avec_balises.docx`);
  if (!res.ok) throw new Error(`Impossible de charger le template DOCX (${res.status})`);
  return res.arrayBuffer();
}

// ─── Registre des balises : textes de remplacement ─────────────────────────
//
// balise_registry.json (kit du SPANC, servi depuis /public/ comme tree.json)
// peut contenir :
//   - `defaultTexts: { balise: "texte" }` — texte spécifique à UNE balise,
//   - `defaultFallbackText: "texte"`      — texte de repli global, utilisé
//     pour toute balise sans entrée dans defaultTexts.
// Les deux sont des choix de rédaction du contrôleur, éditables depuis
// ANC_TreeEditor_v4.html (panneau 🏷️ Balises). Il n'y a AUCUNE règle basée
// sur le nom de la balise (préfixe reco_, suffixe _type, etc.) codée ici :
// chaque balise est traitée de façon identique, sans cas particulier.
//
// Si le kit ne fournit pas encore ces champs (ancien format), le texte de
// repli est une chaîne vide — aucune balise vide ne sera alors décorée tant
// que le contrôleur n'aura pas renseigné au moins le texte de repli global.

let _baliseTextConfigCache = null;

/** Charge defaultTexts + defaultFallbackText de balise_registry.json (cache mémoire). */
async function loadBaliseTextConfig() {
  if (_baliseTextConfigCache) return _baliseTextConfigCache;
  const empty = { defaultTexts: {}, fallbackText: '' };
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}balise_registry.json`);
    if (!res.ok) { _baliseTextConfigCache = empty; return _baliseTextConfigCache; }
    const json = await res.json();
    _baliseTextConfigCache = {
      defaultTexts: (json && typeof json.defaultTexts === 'object' && json.defaultTexts) || {},
      fallbackText: (json && typeof json.defaultFallbackText === 'string') ? json.defaultFallbackText : '',
    };
  } catch (e) {
    // Kit sans balise_registry.json ou ancien format : pas bloquant.
    _baliseTextConfigCache = empty;
  }
  return _baliseTextConfigCache;
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
function buildPlaceholders(session, { defaultTexts = {}, fallbackText = '' } = {}) {
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
  const { flags, activeBalises } = buildAffichageFlags(map);
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
 * Calcule les indicateurs booléens afficher_* pilotant les blocs conditionnels
 * du template DOCX (sections 3 à 6 + tableaux individuels imbriqués), ET la
 * liste des balises appartenant à un bloc actuellement affiché (utilisée
 * ensuite pour appliquer les textes de remplacement des balises vides).
 *
 * IMPORTANT : la liste des balises par bloc doit rester synchronisée avec les
 * marqueurs {#afficher_x}...{/afficher_x} posés dans Trame_rapport_avec_balises.docx.
 * Toute balise ajoutée/retirée d'un bloc dans le DOCX doit être répercutée ici.
 * Ces mêmes listes servent de base aux deux usages (affichage ET texte par
 * défaut) afin d'éviter toute divergence entre les deux mécanismes.
 */
function buildAffichageFlags(map) {
  // Ces listes ont été vérifiées balise par balise contre les placeholders
  // réels de Trame_rapport_avec_balises.docx (grep sur {...}) et contre les
  // champs `section` effectivement utilisés dans tree.json. Ne pas les
  // modifier sans revérifier les deux sources.
  const groups = {
    canaEU: ['canaEU_acces', 'canaEU_parasites', 'canaEU_entretien', 'canaEU_structurel', 'conclusions_canaEU', 'reco_canaEU_conformité', 'reco_canaEU_bf'],
    bag: ['BàG_acces', 'BàG_dimensions', 'BàG_parasites', 'BàG_entretien', 'BàG_structurel'],
    fosse: ['fosse_acces', 'fosse_dimensions', 'fosse_parasites', 'fosse_entretien', 'fosse_structurel', 'fosse_ventilation'],
    prefiltre: ['prefiltre_type', 'prefiltre_entretien'],
    secondaire: [
      'secondaire_type', 'secondaire_acces', 'secondaire_dimensions', 'secondaire_parasites',
      'secondaire_regard_repartition', 'secondaire_regard_bouclage', 'secondaire_regard_collecte',
      'conclusions_secondaire', 'reco_secondaire_conformité', 'reco_secondaire_bf',
    ],
    fa: ['fa_type', 'fa_dimensions', 'fa_agrement', 'fa_parasites', 'fa_entretien', 'fa_structurel', 'conclusions_fa', 'reco_fa_conformité', 'reco_fa_bf'],
    pr: ['annexe_PR_acces', 'annexe_PR_dimensions', 'annexe_PR_parasites', 'annexe_PR_entretien', 'annexe_PR_structurel'],
    ca: ['annexe_CA_acces', 'annexe_CA_dimensions', 'annexe_CA_parasites', 'annexe_CA_entretien', 'annexe_CA_structurel'],
    pe: ['annexe_PE_acces', 'annexe_PE_dimensions', 'annexe_PE_parasites', 'annexe_PE_entretien', 'annexe_PE_structurel'],
    rejet: ['rejet_type', 'rejet_pb', 'conclusions_rejet', 'reco_rejet_conformité', 'reco_rejet_bf'],
    // Balises "propres" au niveau parent (hors sous-blocs bag/fosse/prefiltre et pr/ca/pe)
    primaireOwn: ['conclusions_primaire', 'reco_primaire_conformité', 'reco_primaire_bf'],
    annexesOwn:  ['conclusions_annexes', 'reco_annexe_conformité', 'reco_annexe_bf'],
  };

  const has = (key) => _hasContent(map, groups[key]);

  const afficher_bag       = has('bag');
  const afficher_fosse     = has('fosse');
  const afficher_prefiltre = has('prefiltre');
  const afficher_pr        = has('pr');
  const afficher_ca        = has('ca');
  const afficher_pe        = has('pe');
  const afficher_canaEU    = has('canaEU');
  const afficher_secondaire = has('secondaire');
  const afficher_fa        = has('fa');
  const afficher_rejet     = has('rejet');

  const afficher_primaire = afficher_bag || afficher_fosse || afficher_prefiltre
    || _hasContent(map, groups.primaireOwn);
  const afficher_annexes = afficher_pr || afficher_ca || afficher_pe
    || _hasContent(map, groups.annexesOwn);

  const flags = {
    afficher_canaEU,
    afficher_bag,
    afficher_fosse,
    afficher_prefiltre,
    afficher_primaire,
    afficher_secondaire,
    afficher_fa,
    afficher_pr,
    afficher_ca,
    afficher_pe,
    afficher_annexes,
    afficher_rejet,
  };

  // Balises à considérer pour le remplissage par défaut : uniquement celles
  // appartenant à un bloc dont le flag est actif.
  const activeGroupKeys = [];
  if (afficher_canaEU) activeGroupKeys.push('canaEU');
  if (afficher_bag) activeGroupKeys.push('bag');
  if (afficher_fosse) activeGroupKeys.push('fosse');
  if (afficher_prefiltre) activeGroupKeys.push('prefiltre');
  if (afficher_primaire) activeGroupKeys.push('primaireOwn');
  if (afficher_secondaire) activeGroupKeys.push('secondaire');
  if (afficher_fa) activeGroupKeys.push('fa');
  if (afficher_pr) activeGroupKeys.push('pr');
  if (afficher_ca) activeGroupKeys.push('ca');
  if (afficher_pe) activeGroupKeys.push('pe');
  if (afficher_annexes) activeGroupKeys.push('annexesOwn');
  if (afficher_rejet) activeGroupKeys.push('rejet');

  const activeBalises = activeGroupKeys.flatMap((k) => groups[k]);

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

  const textConfig  = await loadBaliseTextConfig();
  const placeholders = buildPlaceholders(session, textConfig);
  doc.render(placeholders);

  return doc.getZip().generate({ type: 'uint8array' });
}
