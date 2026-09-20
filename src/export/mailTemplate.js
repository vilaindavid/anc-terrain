/**
 * mailTemplate — génère le corps du mail mail_proprietaire.txt.
 *
 * L'inspecteur copie ce texte dans son client mail et y joint le PDF
 * du rapport après finalisation du .docx au bureau.
 */

import { computeVerdict } from '../engine/verdict.js';

export function buildMailText(session) {
  const { admin, constats = [] } = session;
  const verdict = computeVerdict(constats, admin);

  const date = new Date(admin.date_visite).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const objet = `Rapport de contrôle ANC — ${admin.adresse} — dossier ${admin.id_dossier}`;
  const verdictPara = _mailVerdictParagraph(verdict);

  return `Objet : ${objet}

Madame, Monsieur ${admin.nom_proprietaire},

Suite au contrôle de votre installation d'assainissement non collectif réalisé le ${date} à l'adresse ${admin.adresse}, veuillez trouver ci-joint le rapport de visite établi par le Service Public d'Assainissement Non Collectif (SPANC) de la Communauté de communes du massif du Vercors.

${verdictPara}

Le rapport joint détaille l'ensemble des constats effectués et, le cas échéant, les recommandations pour atteindre un bon fonctionnement et/ou la conformité réglementaire.

Conformément au règlement de service, toute démarche de réhabilitation devra être réalisée en coordination avec le SPANC.

Pour toute question, vous pouvez nous contacter :
  - Téléphone : 07 86 59 28 35
  - Email : spanc@vercors.org

Cordialement,

Le Service SPANC
Communauté de communes du massif du Vercors
19 chemin de la Croix Margot, 38250 Villard-de-Lans

──────────────────────────────────────────────────────────────
N° dossier : ${admin.id_dossier}
Propriétaire : ${admin.nom_proprietaire}
${admin.nom_occupant ? `Occupant : ${admin.nom_occupant}\n` : ''}Date de visite : ${date}
`;
}

/**
 * Construit le paragraphe de verdict pour le mail selon le caseType.
 * Les phrases réglementaires (absence/risque/sans_risque) sont utilisées
 * telles quelles depuis verdict.summaryText — texte exact CCMV.
 */
function _mailVerdictParagraph(verdict) {
  const addPeriod = s => /[.!?]$/.test(s.trim()) ? s : `${s}.`;

  switch (verdict.caseType) {
    case 'absence':
    case 'risque':
    case 'sans_risque':
      // Phrases 1, 2, 3 — texte réglementaire utilisé directement
      return addPeriod(verdict.summaryText);

    case 'conforme_reco':
      return (
        "À l'issue du contrôle, l'installation est déclarée CONFORME, " +
        "avec recommandations de travaux et d'entretien. Sans obligation de travaux."
      );

    case 'conforme':
    default:
      return "À l'issue du contrôle, l'installation est déclarée CONFORME.";
  }
}
