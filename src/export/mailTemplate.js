/**
 * mailTemplate — generate the mail_proprietaire.txt body.
 *
 * The inspector copies this text into their mail client and sends the PDF
 * to the owner after the office finalises the docx.
 */

import { computeVerdict } from '../engine/verdict.js';

const DELAI_TEXT = {
  '1_an':  'sous 1 an (ou 12 mois en cas de cession immobilière)',
  '4_ans': 'sous 4 ans (ou 12 mois en cas de cession immobilière)',
  'aucun': '',
};

export function buildMailText(session) {
  const { admin, constats = [] } = session;
  const verdict = computeVerdict(constats);

  const date = new Date(admin.date_visite).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const objet = `Rapport de contrôle ANC — ${admin.adresse} — dossier ${admin.id_dossier}`;

  const verdictPara = verdict.conforme
    ? `À l'issue du contrôle, l'installation est déclarée CONFORME${verdict.checkboxes.conforme_reco ? ', avec recommandations de travaux ou d\'entretien' : ''}.`
    : `À l'issue du contrôle, l'installation est déclarée NON CONFORME.${
        verdict.delai && verdict.delai !== 'aucun'
          ? ` Des travaux de mise en conformité sont obligatoires ${DELAI_TEXT[verdict.delai]}.`
          : ''
      }`;

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
