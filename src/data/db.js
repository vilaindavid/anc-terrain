/**
 * IndexedDB wrapper using the `idb` library.
 *
 * STORES
 * ──────
 * sessions   { id, admin, answers, constats, saisies, annotations, status, createdAt, updatedAt }
 * photos     { id, sessionId, nodeId, balise, filename, mimeType, capturedAt, _opfs?, dataUrl? }
 *
 * STOCKAGE DES PHOTOS (v4.1)
 * ──────────────────────────
 * Les binaires des photos sont stockés dans l'OPFS (Origin Private File
 * System), séparé du cache HTTP et d'IndexedDB :
 *  - stockage natif binaire → −33 % vs base64 en IndexedDB
 *  - résiste au vidage du cache navigateur ordinaire
 *  - accessible programmatiquement → le ZIP d'export continue de fonctionner
 *
 * IndexedDB ne contient que les métadonnées (sessionId, nodeId, balise,
 * filename, mimeType, _opfs: true).
 *
 * Si l'OPFS n'est pas disponible (navigateur ancien), la photo est stockée
 * en base64 dans IndexedDB comme avant (champ dataUrl, pas de champ _opfs).
 * Les deux formats coexistent : les anciens enregistrements (avant la mise
 * à jour) continuent de fonctionner sans migration.
 *
 * Le tree lui-même n'est PAS stocké ici — il est chargé depuis /tree.json au
 * démarrage et conservé dans l'état React (lecture seule, versionné via le
 * cache PWA).
 */

import { openDB } from 'idb';

const DB_NAME    = 'anc-inspection';
const DB_VERSION = 1;
const OPFS_DIR   = 'anc-photos'; // dossier dans l'OPFS

let _db = null;

export async function openDatabase() {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // ── sessions ──────────────────────────────────────────────────
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('by_status', 'status');
      sessions.createIndex('by_date',   'createdAt');

      // ── photos ────────────────────────────────────────────────────
      const photos = db.createObjectStore('photos', {
        keyPath: 'id',
        autoIncrement: true,
      });
      photos.createIndex('by_session', 'sessionId');
      photos.createIndex('by_node',    ['sessionId', 'nodeId']);
    },
  });
  return _db;
}

// ─── OPFS helpers ────────────────────────────────────────────────────────────
//
// L'OPFS (Origin Private File System) est le système de fichiers privé du
// navigateur, disponible via navigator.storage.getDirectory(). Il stocke des
// Blob natifs (pas de base64) et sa quota est gérée séparément du cache HTTP.
//
// API asynchrone utilisée depuis le thread principal (pas de Worker requis).

/** Handle mis en cache pour le dossier OPFS des photos. null = non disponible. */
let _opfsDirHandle = undefined; // undefined = pas encore initialisé

/** Retourne le handle OPFS des photos, ou null si non supporté / erreur. */
async function _getOpfsDir() {
  if (_opfsDirHandle !== undefined) return _opfsDirHandle;
  try {
    if (typeof navigator?.storage?.getDirectory !== 'function') {
      _opfsDirHandle = null;
      return null;
    }
    const root = await navigator.storage.getDirectory();
    _opfsDirHandle = await root.getDirectoryHandle(OPFS_DIR, { create: true });
  } catch (e) {
    console.warn('[ANC] OPFS non disponible, fallback IndexedDB :', e);
    _opfsDirHandle = null;
  }
  return _opfsDirHandle;
}

/**
 * Écrit un Blob (photo) dans l'OPFS.
 * @param {string} filename  Nom de fichier unique (ex : "2025-001_fosse_01.jpg")
 * @param {string} dataUrl   Data URL issu de FileReader (vient de l'appareil photo)
 */
async function _writeToOpfs(filename, dataUrl) {
  const dir = await _getOpfsDir();
  if (!dir) throw new Error('OPFS non disponible');
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable   = await fileHandle.createWritable();
  // Conversion data URL → Blob via fetch() — plus fiable que atob() pour les
  // grands fichiers et les types MIME variés.
  const res  = await fetch(dataUrl);
  const blob = await res.blob();
  await writable.write(blob);
  await writable.close();
}

/**
 * Lit une photo depuis l'OPFS et retourne une data URL.
 * Retourne null si le fichier est introuvable.
 */
async function _readFromOpfs(filename) {
  try {
    const dir = await _getOpfsDir();
    if (!dir) return null;
    const fileHandle = await dir.getFileHandle(filename);
    const file       = await fileHandle.getFile();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } catch {
    return null; // fichier absent ou OPFS non disponible
  }
}

/**
 * Supprime une photo de l'OPFS. Ne lance pas d'erreur si le fichier est absent.
 */
async function _deleteFromOpfs(filename) {
  try {
    const dir = await _getOpfsDir();
    if (!dir) return;
    await dir.removeEntry(filename);
  } catch {
    // Fichier absent ou déjà supprimé — ignoré
  }
}

// ─── Session CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new session.
 * @param {object} admin  { id_dossier, adresse, nom_proprietaire, nom_occupant,
 *                          telephone, email, type_filiere, date_visite }
 * @returns {string} session id (id_dossier)
 */
export async function createSession(admin) {
  const db = await openDatabase();
  const session = {
    id:          admin.id_dossier,
    admin,
    // answers: Map<nodeId → answer> — stored as plain object for serialisation
    answers:     {},
    // constats: Array<{nodeId, classement, balise_constat, balise_reco, note_libre}>
    constats:    [],
    // saisies: Array<{nodeId, valeur, balise}>
    saisies:     [],
    // Current wizard position
    currentSection: '1',
    queue:           [],
    status:       'active',  // 'active' | 'incomplete' | 'exported'
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };
  await db.put('sessions', session);
  return session.id;
}

export async function getSession(id) {
  const db = await openDatabase();
  const session = await db.get('sessions', id);
  if (session) _backfillSaisieAnswers(session);
  return session;
}

/**
 * Répare rétroactivement les sessions enregistrées avant le correctif de
 * recordSaisie() : auparavant, une saisie_valeur n'écrivait que dans
 * session.saisies, jamais dans session.answers, ce qui la faisait
 * apparaître "vide" au rechargement (le champ affiché se base sur
 * answers[nodeId].value) alors que la vraie valeur était bien conservée
 * dans saisies[]. On resynchronise ici answers depuis saisies pour toute
 * entrée manquante. Ne modifie que l'objet en mémoire — la sauvegarde
 * effective aura lieu à la prochaine interaction de l'utilisateur.
 */
function _backfillSaisieAnswers(session) {
  if (!session.answers) session.answers = {};
  for (const s of session.saisies || []) {
    if (session.answers[s.nodeId] === undefined) {
      session.answers[s.nodeId] = { value: s.valeur };
    }
  }
}

export async function listSessions() {
  const db = await openDatabase();
  const all = await db.getAll('sessions');
  return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function saveSession(session) {
  const db = await openDatabase();
  session.updatedAt = new Date().toISOString();
  await db.put('sessions', session);
}

export async function deleteSession(id) {
  const db = await openDatabase();

  // Récupérer les métadonnées photos AVANT la transaction (pour le nettoyage OPFS).
  const photosToClean = await db.getAllFromIndex('photos', 'by_session', id);

  // Suppression en base (session + photos)
  const tx = db.transaction(['sessions', 'photos'], 'readwrite');
  await tx.objectStore('sessions').delete(id);
  const photoIndex = tx.objectStore('photos').index('by_session');
  let cursor = await photoIndex.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;

  // Nettoyage OPFS après la transaction (les erreurs OPFS sont ignorées)
  for (const photo of photosToClean) {
    if (photo._opfs && photo.filename) {
      await _deleteFromOpfs(photo.filename);
    }
  }
}

// ─── Answer / constat helpers ─────────────────────────────────────────────────

/**
 * Record an answer for a node and upsert constats from auto-recording.
 *
 * @param {string} sessionId
 * @param {string} nodeId
 * @param {object} answer   { type, selected?, value?, accessible? }
 * @param {Array}  records  [{cst, reco}] from navigator.collectRecords
 */
export async function recordAnswer(sessionId, nodeId, answer, records = []) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  session.answers[nodeId] = answer;

  // Remove any existing constats from this node (re-answer scenario)
  session.constats = session.constats.filter(c => c.nodeId !== nodeId);

  for (const { cst, reco } of records) {
    if (!cst) continue;
    session.constats.push({
      nodeId,
      classement:      cst.classement,
      label_constat:   cst.label,
      balise_constat:  cst.section,
      label_reco:      reco?.label || null,
      balise_reco:     reco?.section || null,
      note_libre:      '',
      sourceConstatId: _findKey(cst),
      sourceRecoId:    reco ? _findKey(reco) : null,
    });
  }

  await saveSession(session);
}

function _findKey(node) {
  // tree.json nodes don't embed their own key; we tag them during load.
  return node._id || null;
}

/**
 * Record a saisie_valeur.
 *
 * IMPORTANT : écrit à la fois dans session.saisies (utilisé par l'export
 * DOCX) et dans session.answers (utilisé par navigator.buildVisibleTree /
 * sectionProgress pour afficher la valeur et calculer la progression).
 * Les deux doivent toujours rester synchronisés — c'est l'oubli de cette
 * seconde écriture qui causait les champs "remis à zéro" après un
 * changement d'onglet ou une reprise de session.
 */
export async function recordSaisie(sessionId, nodeId, valeur, balise) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  session.answers[nodeId] = { value: valeur };
  session.saisies = session.saisies.filter(s => s.nodeId !== nodeId);
  session.saisies.push({ nodeId, valeur, balise });
  await saveSession(session);
}

/**
 * Efface une saisie_valeur (champ vidé par l'utilisateur) — retire à la
 * fois l'entrée de answers et de saisies, pour ne pas laisser une valeur
 * vide "fantôme" qui compterait comme répondue dans sectionProgress ou
 * apparaîtrait dans le DOCX.
 */
export async function deleteSaisie(sessionId, nodeId) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  delete session.answers[nodeId];
  session.saisies = session.saisies.filter(s => s.nodeId !== nodeId);
  await saveSession(session);
}

/**
 * Update the free-text annotation on a constat.
 */
export async function setAnnotation(sessionId, nodeId, note) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  const cst = session.constats.find(c => c.nodeId === nodeId);
  if (cst) cst.note_libre = note;
  await saveSession(session);
}

/**
 * Efface les réponses (answers), constats et saisies rattachés aux nodeId
 * donnés. Utilisé par le nettoyage en cascade : décocher un critère qui a
 * des réponses plus profondes, ou remplacer la sélection active d'un
 * groupe radio, doit effacer tout ce qui était enregistré sous la branche
 * abandonnée — sinon ces données restent invisibles à l'écran mais actives
 * dans le calcul du verdict et dans l'export DOCX.
 */
export async function clearDescendantAnswers(sessionId, nodeIds) {
  if (!nodeIds || !nodeIds.length) return;
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  const idSet = new Set(nodeIds);
  for (const id of idSet) delete session.answers[id];
  session.constats = session.constats.filter(c => !idSet.has(c.nodeId));
  session.saisies = session.saisies.filter(s => !idSet.has(s.nodeId));
  await saveSession(session);
}

/**
 * Update the wizard position (currentSection + queue).
 */
export async function saveWizardPosition(sessionId, currentSection, queue) {
  const session = await getSession(sessionId);
  if (!session) return;
  session.currentSection = currentSection;
  session.queue = queue;
  await saveSession(session);
}

// ─── Photo CRUD ───────────────────────────────────────────────────────────────

/**
 * Enregistre une photo.
 *
 * Stratégie :
 *  1. Tente d'écrire le binaire dans l'OPFS (plus efficace, hors quota cache).
 *  2. Si l'OPFS échoue, stocke la dataUrl en base64 dans IndexedDB (ancien comportement).
 *
 * IndexedDB conserve toujours les métadonnées. La présence de `_opfs: true`
 * indique que les données réelles sont dans l'OPFS, pas en IndexedDB.
 *
 * @param {object} photo  { sessionId, nodeId, balise, filename, mimeType, dataUrl }
 * @returns {Promise<number>} auto-incremented photo id
 */
export async function addPhoto(photo) {
  const db = await openDatabase();

  // Tentative OPFS
  let useOpfs = false;
  const dir = await _getOpfsDir();
  if (dir) {
    try {
      await _writeToOpfs(photo.filename, photo.dataUrl);
      useOpfs = true;
    } catch (e) {
      console.warn('[ANC] Écriture OPFS échouée, fallback IndexedDB :', e);
    }
  }

  // Enregistrement IndexedDB (métadonnées + éventuellement dataUrl en fallback)
  const record = {
    sessionId:  photo.sessionId,
    nodeId:     photo.nodeId,
    balise:     photo.balise,
    filename:   photo.filename,
    mimeType:   photo.mimeType,
    capturedAt: new Date().toISOString(),
  };

  if (useOpfs) {
    record._opfs = true; // données dans l'OPFS — pas de dataUrl en IndexedDB
  } else {
    record.dataUrl = photo.dataUrl; // fallback : base64 en IndexedDB
  }

  try {
    return await db.add('photos', record);
  } catch (e) {
    // Si l'IndexedDB échoue après un succès OPFS, on nettoie le fichier OPFS.
    if (useOpfs) await _deleteFromOpfs(photo.filename).catch(() => {});
    throw e;
  }
}

/**
 * Retourne toutes les photos d'une session, avec leur dataUrl (lue depuis
 * l'OPFS si _opfs === true, sinon directement depuis IndexedDB).
 * Compatible avec les anciens enregistrements (dataUrl en IndexedDB).
 */
export async function getPhotosForSession(sessionId) {
  const db = await openDatabase();
  const metas = await db.getAllFromIndex('photos', 'by_session', sessionId);
  return _hydratePhotos(metas);
}

export async function getPhotosForNode(sessionId, nodeId) {
  const db = await openDatabase();
  const metas = await db.getAllFromIndex('photos', 'by_node', [sessionId, nodeId]);
  return _hydratePhotos(metas);
}

/**
 * Hydrate une liste de métadonnées photo avec leur dataUrl.
 * Les enregistrements OPFS (_opfs: true) ont leur fichier lu depuis le système.
 * Les enregistrements anciens (dataUrl dans IndexedDB) sont retournés tels quels.
 */
async function _hydratePhotos(metas) {
  const result = [];
  for (const meta of metas) {
    if (meta._opfs) {
      const dataUrl = await _readFromOpfs(meta.filename);
      if (dataUrl) {
        result.push({ ...meta, dataUrl });
      } else {
        // Fichier OPFS introuvable (ex : après vidage des données du site)
        console.warn(`[ANC] Photo OPFS introuvable : ${meta.filename}`);
        // On inclut quand même la métadonnée, sans dataUrl — le zip ignorera
        // les entrées sans dataUrl grâce au filtre dans zipBuilder.js.
        result.push(meta);
      }
    } else {
      result.push(meta); // ancien format, dataUrl déjà dans l'objet
    }
  }
  return result;
}

export async function deletePhoto(photoId) {
  const db = await openDatabase();
  const photo = await db.get('photos', photoId);
  if (photo?._opfs && photo.filename) {
    await _deleteFromOpfs(photo.filename);
  }
  return db.delete('photos', photoId);
}
