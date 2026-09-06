import { compareSeverity, REQUIRES_WORKS } from './severity.js';

/**
 * Compute the overall verdict for a session from its constats array.
 *
 * @param {Array<{nodeId, classement, balise_constat, balise_reco}>} constats
 * @returns {{
 *   maxClassement: string|null,
 *   conforme: boolean,
 *   delai: 'aucun'|'4_ans'|'1_an'|'immediat',
 *   checkboxes: {
 *     conforme_complete: boolean,
 *     conforme_reco: boolean,
 *     non_conforme: boolean,
 *     sans_risque: boolean,
 *     rejet_superficiel: boolean,
 *     risque_sanitaire: boolean,
 *     absence_installation: boolean,
 *   },
 *   summaryText: string,
 * }}
 */
export function computeVerdict(constats) {
  if (!constats || constats.length === 0) {
    return _buildVerdict(null, constats);
  }

  // Find most severe classement (excluding "Simple constat")
  const relevant = constats.filter(c => c.classement && c.classement !== 'Simple constat');
  if (relevant.length === 0) return _buildVerdict(null, constats);

  const maxClassement = relevant
    .map(c => c.classement)
    .reduce((acc, cur) => (compareSeverity(cur, acc) < 0 ? cur : acc));

  return _buildVerdict(maxClassement, constats);
}

function _buildVerdict(maxClassement, constats) {
  const hasAbsence   = maxClassement === "Absence d'installation";
  const hasSanitaire = ["Défaut de sécurité sanitaire", "Danger pour la sécurité des personnes"].includes(maxClassement);
  const hasMajeur    = REQUIRES_WORKS.has(maxClassement);
  const isConformant = !maxClassement || !REQUIRES_WORKS.has(maxClassement);

  // hasRecoOnly : conforme mais avec un classement résiduel de faible
  // sévérité (reco/remarque/simple constat) plutôt qu'aucun constat du tout.
  const hasRecoOnly = isConformant && !!maxClassement &&
    ["Recommandation de travaux", "Simple remarque", "Simple constat"].includes(maxClassement);

  // Délai de travaux
  let delai = 'aucun';
  if (hasAbsence) delai = '1_an';
  else if (hasSanitaire) delai = '1_an';
  else if (hasMajeur) delai = '4_ans';

  const conforme = isConformant;

  const checkboxes = {
    conforme_complete: conforme && !hasRecoOnly,
    conforme_reco:     conforme && hasRecoOnly,
    non_conforme:      !conforme,
    sans_risque:       !conforme && !hasSanitaire && !hasAbsence,
    // rejet_superficiel : reste TOUJOURS false ici — décision en attente,
    // voir note dans la conversation du 30/08/2026 (aucune UI de révision ne
    // permet actuellement de le cocher manuellement).
    rejet_superficiel: false,
    risque_sanitaire:  !conforme && hasSanitaire,
    absence_installation: hasAbsence,
  };

  const summaryText = _buildSummaryText(conforme, delai, maxClassement);

  return { maxClassement, conforme, delai, checkboxes, summaryText };
}

function _buildSummaryText(conforme, delai, maxClassement) {
  if (!maxClassement) return "Aucun constat enregistré.";
  if (conforme) return `Installation conforme. Constat principal : ${maxClassement}.`;

  const delaiTexts = {
    '1_an':    'Travaux obligatoires sous 1 an (ou 12 mois en cas de vente).',
    '4_ans':   'Travaux obligatoires sous 4 ans (ou 12 mois en cas de vente).',
    'immediat':'Travaux à réaliser immédiatement.',
    'aucun':   '',
  };

  return `Installation non conforme — ${maxClassement}. ${delaiTexts[delai] || ''}`.trim();
}
