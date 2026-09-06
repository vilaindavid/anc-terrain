/**
 * Severity ordering for classement values.
 * Index 0 = most severe.
 * Source: locked schema in project memory.
 *
 * CORRECTIF (30/08/2026) : une version antérieure (issue d'une session Codex)
 * intervertissait "Défaut de structure ou de fermeture", "Assainissement
 * incomplet" et "Dysfonctionnement majeur". Ordre remis en conformité avec
 * le schéma verrouillé.
 */
export const SEVERITY_ORDER = [
  "Absence d'installation",
  "Danger pour la sécurité des personnes",
  "Défaut de sécurité sanitaire",
  "Défaut de structure ou de fermeture",
  "Assainissement incomplet",
  "Dysfonctionnement majeur",
  "Sous-dimensionnement significatif",
  "Défaut d'entretien ou d'usure",
  "Recommandation de travaux",
  "Simple remarque",
  "Simple constat",
];

/** Lower index = more severe. Returns -1 if unknown (treated as least severe). */
export function severityIndex(classement) {
  const i = SEVERITY_ORDER.indexOf(classement);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** Compare two classement values. Returns negative if a is more severe than b. */
export function compareSeverity(a, b) {
  return severityIndex(a) - severityIndex(b);
}

/** Colour hex for each classement (from the draw.io legend). */
export const SEVERITY_COLOR = {
  "Simple remarque":                    "#dae8fc",
  "Recommandation de travaux":          "#d5e8d4",
  "Défaut d'entretien ou d'usure":      "#fff2cc",
  "Sous-dimensionnement significatif":  "#ffe6cc",
  "Défaut de structure ou de fermeture":"#fa6800",
  "Dysfonctionnement majeur":           "#f8cecc",
  "Assainissement incomplet":           "#e1d5e7",
  "Absence d'installation":             "#76608a",
  "Défaut de sécurité sanitaire":       "#e51400",
  "Danger pour la sécurité des personnes": "#cc0000",
  "Simple constat":                     "#e0e0e0",
};

/** Foreground colour for legibility on the background colour. */
export function severityTextColor(classement) {
  const dark = ["Défaut de structure ou de fermeture", "Absence d'installation", "Défaut de sécurité sanitaire", "Danger pour la sécurité des personnes"];
  return dark.includes(classement) ? "#ffffff" : "#1a1a1a";
}

/**
 * Whether this classement triggers a "travaux obligatoires" verdict.
 * Used by verdict.js.
 */
export const REQUIRES_WORKS = new Set([
  "Absence d'installation",
  "Danger pour la sécurité des personnes",
  "Défaut de sécurité sanitaire",
  "Dysfonctionnement majeur",
  "Assainissement incomplet",
  "Défaut de structure ou de fermeture",
  "Sous-dimensionnement significatif",
]);
