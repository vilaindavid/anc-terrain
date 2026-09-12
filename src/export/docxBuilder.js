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
 *
 * ── Mise en forme par gravité (balises riches) ──────────────────────────────
 * Les valeurs des balises listées dans balise_registry.json#richTextBalises
 * sont enrichies d'un système de marqueurs inline :
 *   «RRGGBB:B»texte du constat«END»   (B = 0 normal, 1 gras)
 * Après le rendu docxtemplater, applyRichFormatting() remplace ces marqueurs
 * par des runs Word colorés (<w:color>/<w:b>). Pas de package supplémentaire
 * requis : on utilise des tags {balise} standard (pas {@balise}).
 */

import PizZip        from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { compareSeverity, SEVERITY_DOCX_STYLE } from '../engine/severity.js';
import { computeVerdict }                        from '../engine/verdict.js';

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

// ─── Marqueurs de couleur ────────────────────────────────────────────────────
//
// Format : «RRGGBB:B»texte«END»
// Les guillemets « [U+00AB] et » [U+00BB] ne sont pas des caractères XML
// spéciaux et passent inchangés à travers l'échappement de docxtemplater.
// Le texte capturé entre les marqueurs est déjà échappé XML (par docxtemplater)
// et doit être réinséré tel quel dans <w:t>.

const MARKER_END = '\u00ABEND\u00BB';

/**
 * Construit la valeur pour une balise riche (avec données).
 *
 * Ordre :
 *   1. valeur de saisie (texte neutre, sans marqueur)
 *   2. constats triés par gravité, chacun sur sa propre ligne :
 *        ligne  texte constat  → marqueur coloré
 *        ligne  [Note : ...]   → marqueur gris italique (si note présente)
 *
 * Le \n entre lignes est converti en <w:br/> par docxtemplater (linebreaks:true),
 * ce qui place chaque segment dans son propre run — indispensable pour que
 * applyRichFormatting() puisse les cibler individuellement.
 *
 * @param {string|null} saisieText  valeur mesurée (ex. « 3000 L »)
 * @param {Array<{text,classement,note}>} cstItems  constats triés sévérité desc
 */
function buildRichValue(saisieText, cstItems) {
  const parts = [];
  if (saisieText) parts.push(saisieText); // texte neutre, pas de marqueur
  for (const { text, classement, note } of cstItems) {
    const st = SEVERITY_DOCX_STYLE[classement] || { color: '1A1A1A', bold: false };
    parts.push(`\u00AB${st.color}:${st.bold ? '1' : '0'}\u00BB${text}${MARKER_END}`);
    if (note) parts.push(`\u00AB888888:0\u00BB[Note\u00a0: ${note}]${MARKER_END}`);
  }
  return parts.join('\n');
}

// ─── Registre des balises ────────────────────────────────────────────────────

let _baliseTextConfigCache = null;

/**
 * Charge defaultTexts, defaultFallbackText et richTextBalises depuis
 * balise_registry.json (cache mémoire).
 */
async function loadBaliseTextConfig() {
  if (_baliseTextConfigCache) return _baliseTextConfigCache;
  const empty = { defaultTexts: {}, fallbackText: '', richTextBalises: new Set() };
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}balise_registry.json`);
    if (!res.ok) { _baliseTextConfigCache = empty; return _baliseTextConfigCache; }
    const json = await res.json();
    _baliseTextConfigCache = {
      defaultTexts: (json && typeof json.defaultTexts === 'object' && json.defaultTexts) || {},
      fallbackText: (json && typeof json.defaultFallbackText === 'string') ? json.defaultFallbackText : '',
      richTextBalises: new Set(Array.isArray(json.richTextBalises) ? json.richTextBalises : []),
    };
  } catch (e) {
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
 * Remplit dans `map` les balises de la liste `balises` qui sont encore vides,
 * avec leur texte de remplacement.
 * Appelé APRÈS le calcul des flags d'affichage, uniquement pour les balises
 * des blocs conditionnels actuellement visibles.
 * Les balises riches reçoivent du texte plat (sans marqueur) car le texte par
 * défaut n'est pas lié à un classement et n'a pas à être coloré.
 */
function applyDefaultTexts(map, balises, defaultTexts, fallbackText) {
  for (const balise of balises) {
    const current = map[balise];
    if (current === undefined || current === null || String(current).trim() === '') {
      map[balise] = resolveDefaultText(balise, defaultTexts, fallbackText);
    }
  }
}

// ─── Construction des placeholders ─────────────────────────────────────────

/**
 * Build the placeholder map from session data.
 *
 * Corrections par rapport à la version précédente :
 *  1. Bug « écrasement » corrigé : les constats écrasaient silencieusement la
 *     saisie sur les 4 balises partagées (fosse_dimensions, BàG_dimensions,
 *     secondaire_dimensions, fa_dimensions). Désormais, saisie et constats sont
 *     concaténés, la saisie en premier.
 *  2. Balises riches : la valeur contient des marqueurs de couleur qui seront
 *     convertis en runs Word colorés par applyRichFormatting() après le rendu.
 */
function buildPlaceholders(session, { defaultTexts = {}, fallbackText = '', richTextBalises = new Set() } = {}) {
  const { admin, constats = [], saisies = [] } = session;
  const verdict = computeVerdict(constats);

  // ── Métadonnées admin ──────────────────────────────────────────────────
  const map = {
    date_visite: formatDateForReport(admin.date_visite),
    nom_prenom:  admin.nom_proprietaire,
    adresse:     admin.adresse,
    chk_conforme:             verdict.conforme ? '☑' : '☐',
    chk_non_conforme:         !verdict.conforme ? '☑' : '☐',
    chk_conforme_complete:    verdict.checkboxes.conforme_complete    ? '☑' : '☐',
    chk_conforme_reco:        verdict.checkboxes.conforme_reco        ? '☑' : '☐',
    chk_sans_risque:          verdict.checkboxes.sans_risque          ? '☑' : '☐',
    chk_rejet_superficiel:    verdict.checkboxes.rejet_superficiel    ? '☑' : '☐',
    chk_risque_sanitaire:     verdict.checkboxes.risque_sanitaire     ? '☑' : '☐',
    chk_absence_installation: verdict.checkboxes.absence_installation ? '☑' : '☐',
    verdict_summary: verdict.summaryText,
  };

  // ── Saisies (indexées par balise, texte brut) ──────────────────────────
  const saisieTextByBalise = {};
  for (const sv of saisies) {
    if (sv.balise) saisieTextByBalise[sv.balise] = String(sv.valeur);
  }

  // ── Constats (groupés par balise, classement conservé) ─────────────────
  // Triés sévérité desc, puis nodeId asc — identique à l'ancienne logique.
  const constatsByBalise = {}; // { balise: [{text, classement, note}] }
  const recosByBalise    = {}; // { balise: [string] }

  const sorted = [...constats].sort((a, b) =>
    compareSeverity(a.classement, b.classement) || a.nodeId.localeCompare(b.nodeId)
  );

  for (const cst of sorted) {
    const bc = cst.balise_constat;
    const br = cst.balise_reco;
    if (bc) {
      if (!constatsByBalise[bc]) constatsByBalise[bc] = [];
      constatsByBalise[bc].push({
        text:       cst.label_constat || '',
        classement: cst.classement   || 'Simple constat',
        note:       cst.note_libre   || '',
      });
    }
    if (br) {
      if (!recosByBalise[br]) recosByBalise[br] = [];
      if (cst.label_reco) recosByBalise[br].push(cst.label_reco);
    }
  }

  // ── Fusion saisies + constats ──────────────────────────────────────────
  const allTouchedBalises = new Set([
    ...Object.keys(saisieTextByBalise),
    ...Object.keys(constatsByBalise),
  ]);

  for (const balise of allTouchedBalises) {
    const saisieText = saisieTextByBalise[balise] || null;
    const cstItems   = constatsByBalise[balise]   || [];

    if (richTextBalises.has(balise)) {
      // Balise riche → valeur avec marqueurs de couleur
      map[balise] = buildRichValue(saisieText, cstItems);
    } else {
      // Balise ordinaire → concaténation texte brut
      const parts = [];
      if (saisieText) parts.push(saisieText);
      for (const c of cstItems) {
        parts.push(c.note ? `${c.text}\n[Note\u00a0: ${c.note}]` : c.text);
      }
      map[balise] = parts.join('\n');
    }
  }

  // ── Recommandations (toujours texte plat, dédupliquées) ─────────────────
  for (const [balise, lines] of Object.entries(recosByBalise)) {
    map[balise] = [...new Set(lines)].join('\n\n');
  }

  // ── Flags d'affichage conditionnel ──────────────────────────────────────
  // Calculés sur les données brutes, AVANT les textes par défaut, pour que
  // les blocs vides n'apparaissent pas comme remplis.
  const { flags, activeBalises } = buildAffichageFlags(map);
  Object.assign(map, flags);

  // ── Textes par défaut pour les blocs conditionnels actifs ───────────────
  applyDefaultTexts(map, activeBalises, defaultTexts, fallbackText);

  // Proxy : '' pour toute balise absente (évite les erreurs docxtemplater)
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
 * Calcule les indicateurs booléens afficher_* et la liste activeBalises.
 * (Inchangé — liste des groupes maintenue en sync avec le template DOCX.)
 */
function buildAffichageFlags(map) {
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
    primaireOwn: ['conclusions_primaire', 'reco_primaire_conformité', 'reco_primaire_bf'],
    annexesOwn:  ['conclusions_annexes', 'reco_annexe_conformité', 'reco_annexe_bf'],
  };

  const has = (key) => _hasContent(map, groups[key]);

  const afficher_bag        = has('bag');
  const afficher_fosse      = has('fosse');
  const afficher_prefiltre  = has('prefiltre');
  const afficher_pr         = has('pr');
  const afficher_ca         = has('ca');
  const afficher_pe         = has('pe');
  const afficher_canaEU     = has('canaEU');
  const afficher_secondaire = has('secondaire');
  const afficher_fa         = has('fa');
  const afficher_rejet      = has('rejet');

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

  const activeGroupKeys = [];
  if (afficher_canaEU)    activeGroupKeys.push('canaEU');
  if (afficher_bag)       activeGroupKeys.push('bag');
  if (afficher_fosse)     activeGroupKeys.push('fosse');
  if (afficher_prefiltre) activeGroupKeys.push('prefiltre');
  if (afficher_primaire)  activeGroupKeys.push('primaireOwn');
  if (afficher_secondaire)activeGroupKeys.push('secondaire');
  if (afficher_fa)        activeGroupKeys.push('fa');
  if (afficher_pr)        activeGroupKeys.push('pr');
  if (afficher_ca)        activeGroupKeys.push('ca');
  if (afficher_pe)        activeGroupKeys.push('pe');
  if (afficher_annexes)   activeGroupKeys.push('annexesOwn');
  if (afficher_rejet)     activeGroupKeys.push('rejet');

  const activeBalises = activeGroupKeys.flatMap((k) => groups[k]);

  return { flags, activeBalises };
}

// ─── Post-rendu : coloration des constats ────────────────────────────────────

/**
 * Remplace les marqueurs de couleur dans word/document.xml par des runs Word
 * colorés, après que docxtemplater a rendu le template.
 *
 * Chaque marqueur «RRGGBB:B»texte«END» est détecté dans un élément <w:t>.
 * On remplace le <w:rPr> du run parent (propriétés héritées du template)
 * par notre <w:rPr> coloré, et le <w:t> par une version sans marqueur.
 *
 * Note : le contenu capturé entre les marqueurs est déjà échappé XML par
 * docxtemplater (&amp; pour &, &lt; pour <, etc.) — on le réinsère tel quel.
 *
 * @param {PizZip} zip  zip issu de doc.getZip() après doc.render()
 */
function applyRichFormatting(zip) {
  const file = zip.files['word/document.xml'];
  if (!file) return;

  let xml = file.asText();

  // Pattern : (rPr existant optionnel) + <w:t> contenant notre marqueur
  // Les guillemets «/» (U+00AB / U+00BB) ne nécessitent pas d'échappement XML.
  // Le flag 'g' traite chaque run marqué indépendamment.
  // ⚠️  Le token négatif (?:(?!<\/w:rPr>)[\s\S])* est indispensable pour éviter
  // le backtracking cross-run : avec [\s\S]*? (lazy simple), le moteur peut
  // étirer la capture du rPr à travers plusieurs runs entiers avant de trouver
  // un <w:t>«...» valide, consommant ainsi le contenu des runs intermédiaires.
  const MARKER_RE = /(?:<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?<w:t(?:\s[^>]*)?>«([0-9A-Fa-f]{6}):([01])»([\s\S]*?)«END»<\/w:t>/g;

  xml = xml.replace(MARKER_RE, (_match, color, bold, text) => {
    const rPr = `<w:rPr><w:color w:val="${color}"/>${bold === '1' ? '<w:b/>' : ''}</w:rPr>`;
    // `text` est déjà échappé XML par docxtemplater — réinsertion directe.
    return `${rPr}<w:t xml:space="preserve">${text}</w:t>`;
  });

  zip.file('word/document.xml', xml);
}

// ─── Export public ───────────────────────────────────────────────────────────

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
    nullGetter:    () => '',
  });

  const textConfig   = await loadBaliseTextConfig();
  const placeholders = buildPlaceholders(session, textConfig);
  doc.render(placeholders);

  // Coloration post-rendu des constats (balises richTextBalises)
  applyRichFormatting(doc.getZip());

  return doc.getZip().generate({ type: 'uint8array' });
}
