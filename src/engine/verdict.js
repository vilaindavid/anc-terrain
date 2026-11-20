/**
 * verdict.js — calcul du verdict final de conformité ANC.
 *
 * Base légale : Annexe II de l'arrêté du 27 avril 2012 modifié.
 * Trois catégories de non-conformité avec obligation de travaux :
 *   (a) danger pour la santé des personnes
 *   (b) risque avéré de pollution de l'environnement
 *   (c) installation incomplète, significativement sous-dimensionnée,
 *       ou présentant un dysfonctionnement majeur
 *
 * Note : `Défaut de structure ou de fermeture` est assimilé à (a)/(b) —
 * les cas concrets dans tree.json y sont déjà classés en
 * `Danger pour la sécurité des personnes` (décision CCMV, 2026-09-16).
 *
 * Note : en cas de zone à enjeu sanitaire ou environnemental déclarée
 * dans admin, un cas (c) bascule automatiquement en (a)/(b) → délai 4 ans.
 */

import { compareSeverity, REQUIRES_WORKS } from './severity.js';

// ─── Phrases de conclusion réglementaires (texte exact CCMV) ─────────────────

const SUMMARY = {
  /** Phrase 1 — absence d'installation (délai : meilleurs délais) */
  absence:
    "Absence d'installation accessible, non respect de l'article L1331-1-1 " +
    'du code de la santé publique. ' +
    'Obligation de travaux à réaliser dans les meilleurs délais',

  /** Phrase 2 — risque sanitaire ou environnemental (délai : 4 ans / 1 an vente) */
  risque:
    'Installation non conforme, présentant un risque sanitaire ou environnemental. ' +
    "Travaux obligatoire à réaliser sous 4 ans (ou 1 an pour l'acquéreur en cas de vente)",

  /** Phrase 3 — non-conforme sans risque (obligation uniquement pour acquéreur) */
  sans_risque:
    'Installation non conforme, sans risque sanitaire ou environnemental. ' +
    'Obligation de travaux uniquement pour le futur acquéreur, sous 1 an.',

  /** Phrase 4 — conforme avec recommandations */
  conforme_reco:
    "Installation conforme, avec recommandations de travaux et d'entretien. " +
    'Sans obligation de travaux',
};

// ─── Tables de décision ───────────────────────────────────────────────────────

/**
 * Classements entraînant un risque direct (a)/(b).
 * → Phrase 2 (délai 4 ans) quel que soit le contexte de zone.
 */
const RISQUE_DIRECT = new Set([
  'Danger pour la sécurité des personnes',
  'Défaut de sécurité sanitaire',
  'Défaut de structure ou de fermeture', // assimilé à (a)/(b) — cf. note en-tête
]);

/**
 * Classements relevant du cas (c).
 * → Phrase 2 si zone à enjeu déclarée, Phrase 3 sinon.
 */
const CAS_C = new Set([
  'Assainissement incomplet',
  'Dysfonctionnement majeur',
  'Sous-dimensionnement significatif',
]);

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Calcule le verdict de conformité d'une session.
 *
 * @param {Array<{nodeId, classement, balise_constat, balise_reco}>} constats
 * @param {object} [admin={}]  Données admin de la session (optionnel).
 *   `admin.zone_enjeu_sanitaire`       {boolean}
 *   `admin.zone_enjeu_environnemental` {boolean}
 *
 * @returns {{
 *   maxClassement: string|null,
 *   conforme:      boolean,
 *   caseType:      'absence'|'risque'|'sans_risque'|'conforme_reco'|'conforme',
 *   summaryText:   string,
 *   checkboxes: {
 *     conforme_complete:    boolean,
 *     conforme_reco:        boolean,
 *     non_conforme:         boolean,
 *     sans_risque:          boolean,
 *     risque_sanitaire:     boolean,
 *     absence_installation: boolean,
 *   },
 * }}
 */
export function computeVerdict(constats, admin = {}) {
  const relevant = (constats || []).filter(
    c => c.classement && c.classement !== 'Simple constat'
  );

  if (!relevant.length) return _buildVerdict(null, admin);

  const maxClassement = relevant
    .map(c => c.classement)
    .reduce((acc, cur) => (compareSeverity(cur, acc) < 0 ? cur : acc));

  return _buildVerdict(maxClassement, admin);
}

// ─── Logique interne ───────────────────────────────────────────────────────────

function _buildVerdict(maxClassement, admin) {
  const zoneEnjeu = !!(admin?.zone_enjeu_sanitaire || admin?.zone_enjeu_environnemental);

  // ── Qualification du cas ──────────────────────────────────────────────────

  /** Cas 1 — absence d'installation (cas autonome, traitement spécifique) */
  const isAbsence = maxClassement === "Absence d'installation";

  /**
   * Cas 2 — risque sanitaire ou environnemental.
   * Déclenché par (a)/(b) directs, ou par (c) si zone à enjeu déclarée.
   */
  const isRisque =
    !isAbsence &&
    !!maxClassement &&
    (RISQUE_DIRECT.has(maxClassement) || (CAS_C.has(maxClassement) && zoneEnjeu));

  /**
   * Cas 3 — non-conforme sans risque avéré.
   * Cas (c) hors zone à enjeu : obligation uniquement pour le futur acquéreur.
   */
  const isSansRisque =
    !isAbsence && !isRisque &&
    !!maxClassement && REQUIRES_WORKS.has(maxClassement);

  /** Cas 4 — conforme (avec ou sans recommandations) */
  const conforme = !isAbsence && !isRisque && !isSansRisque;

  /**
   * Variante conforme_reco : installation conforme mais avec recommandations
   * de travaux ou d'entretien (pas d'obligation réglementaire).
   */
  const hasRecoOnly =
    conforme &&
    !!maxClassement &&
    [
      "Autre défaut",
      "Simple remarque",
      "Défaut d'entretien ou d'usure",
    ].includes(maxClassement);

  // ── caseType ─────────────────────────────────────────────────────────────

  const caseType =
      isAbsence    ? 'absence'
    : isRisque     ? 'risque'
    : isSansRisque ? 'sans_risque'
    : hasRecoOnly  ? 'conforme_reco'
    :                'conforme';

  // ── Checkboxes section IV du rapport DOCX ────────────────────────────────

  const checkboxes = {
    conforme_complete:    conforme && !hasRecoOnly,
    conforme_reco:        conforme && hasRecoOnly,
    non_conforme:         !conforme,
    sans_risque:          isSansRisque,
    risque_sanitaire:     isRisque,
    absence_installation: isAbsence,
  };

  return {
    maxClassement,
    conforme,
    caseType,
    summaryText: _buildSummaryText(caseType, maxClassement),
    checkboxes,
  };
}

function _buildSummaryText(caseType, maxClassement) {
  if (SUMMARY[caseType]) return SUMMARY[caseType];
  // caseType === 'conforme' — pas de phrase réglementaire dédiée
  return maxClassement
    ? `Installation conforme. Constat principal : ${maxClassement}.`
    : 'Aucun constat enregistré.';
}
