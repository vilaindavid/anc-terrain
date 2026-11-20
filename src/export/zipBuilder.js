/**
 * zipBuilder — assemble the export zip bundle.
 *
 * Bundle contents
 * ───────────────
 * {id_dossier}_Rapport_{adresse_slug}.docx
 * photos/
 *   {id_dossier}_{balise}_{nn}.jpg   (each photo captured in-app)
 * mail_proprietaire.txt
 *
 * Returns a Blob that can be saved via the File System Access API or
 * triggered as a download via an <a> element.
 */

import JSZip from 'jszip';
import { buildDocx }     from './docxBuilder.js';
import { buildMailText } from './mailTemplate.js';
import { getPhotosForSession } from '../data/db.js';

/**
 * @param {object}  session   full session object from IndexedDB
 * @param {fn}      onProgress  called with 0-100 as generation progresses
 * @returns {Promise<{blob: Blob, docxName: string, skippedPhotos: number}>}
 */
export async function buildExportZip(session, onProgress) {
  const zip = new JSZip();
  const report = progress => onProgress?.(progress);

  report(5);

  // ── 1. Generate filled DOCX ──────────────────────────────────────────────
  const docxBytes = await buildDocx(session);
  const adresseSlug = session.admin.adresse
    .replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  const docxName = `${session.id}_Rapport_${adresseSlug}.docx`;
  zip.file(docxName, docxBytes);
  report(50);

  // ── 2. Add photos ────────────────────────────────────────────────────────
  const photos = await getPhotosForSession(session.id);
  let skippedPhotos = 0;
  let excludedPhotos = 0;
  const activeConstatNodeIds = new Set(
    (session.constats || []).map(constat => constat.nodeId).filter(Boolean),
  );
  const usablePhotos = photos.filter(p => {
    // Défense pour les dossiers créés avant le nettoyage des photos : une
    // image n'est exportée que si son constat existe encore dans ce rapport.
    if (!activeConstatNodeIds.has(p.nodeId)) {
      console.warn(`Photo exclue de l'export (constat inactif) — id=${p.id}, nodeId=${p.nodeId}`);
      excludedPhotos++;
      return false;
    }

    // Une entrée peut exister sans contenu binaire exploitable (dataUrl
    // manquant, tronqué, ou stockage sous-jacent défaillant au moment de
    // la capture). On l'ignore proprement plutôt que de faire échouer tout
    // l'export du dossier avec les autres photos et le rapport DOCX déjà
    // générés.
    const ok = typeof p.dataUrl === 'string' && p.dataUrl.includes(',') && p.dataUrl.split(',')[1];
    if (!ok) {
      console.warn(`Photo ignorée à l'export (dataUrl manquant/invalide) — id=${p.id}, nodeId=${p.nodeId}`);
      skippedPhotos++;
    }
    return ok;
  });
  if (usablePhotos.length) {
    const photoFolder = zip.folder('photos');
    // Track per-balise counter for sequential numbering
    const counters = {};
    for (const photo of usablePhotos) {
      const key = photo.balise || photo.nodeId;
      counters[key] = (counters[key] || 0) + 1;
      const nn  = String(counters[key]).padStart(2, '0');
      const ext = (photo.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
      const fname = `${session.id}_${key}_${nn}.${ext}`;

      // dataUrl → raw bytes
      const base64 = photo.dataUrl.split(',')[1];
      photoFolder.file(fname, base64, { base64: true });
    }
  }
  report(80);

  // ── 3. Pre-written email body ────────────────────────────────────────────
  const mailText = buildMailText(session);
  zip.file('mail_proprietaire.txt', mailText);
  report(90);

  // ── 4. Generate zip ──────────────────────────────────────────────────────
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    ({ percent }) => report(90 + Math.round(percent * 0.1))
  );
  report(100);
  return { blob, docxName, skippedPhotos, excludedPhotos };
}

/**
 * Trigger browser download of a Blob.
 * Uses the File System Access API (showSaveFilePicker) if available,
 * falls back to a hidden <a> tag.
 * @returns {Promise<boolean>} true when a save/download was triggered;
 *                            false when the user cancels the save dialog.
 */
export async function downloadBlob(blob, filename) {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false; // user cancelled
      // fall through to anchor fallback
    }
  }

  // Fallback: hidden anchor
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
  return true;
}
