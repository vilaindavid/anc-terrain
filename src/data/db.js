/**
 * IndexedDB wrapper using the `idb` library.
 *
 * STORES
 * ──────
 * sessions   { id, admin, answers, constats, saisies, annotations, status, createdAt, updatedAt }
 * photos     { id, sessionId, nodeId, balise, filename, mimeType, dataUrl }
 *
 * The tree itself is NOT stored here — it's loaded from /tree.json at startup
 * and kept in React state (it's read-only, version-controlled via the PWA cache).
 */

import { openDB } from 'idb';

const DB_NAME = 'anc-inspection';
const DB_VERSION = 1;

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
  const tx = db.transaction(['sessions', 'photos'], 'readwrite');
  await tx.objectStore('sessions').delete(id);
  // Delete associated photos
  const photoStore = tx.objectStore('photos');
  const photoIndex = photoStore.index('by_session');
  let cursor = await photoIndex.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
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
 * @param {object} photo  { sessionId, nodeId, balise, filename, mimeType, dataUrl }
 * @returns {number} auto-incremented photo id
 */
export async function addPhoto(photo) {
  const db = await openDatabase();
  return db.add('photos', { ...photo, capturedAt: new Date().toISOString() });
}

export async function getPhotosForSession(sessionId) {
  const db = await openDatabase();
  return db.getAllFromIndex('photos', 'by_session', sessionId);
}

export async function getPhotosForNode(sessionId, nodeId) {
  const db = await openDatabase();
  return db.getAllFromIndex('photos', 'by_node', [sessionId, nodeId]);
}

export async function deletePhoto(photoId) {
  const db = await openDatabase();
  return db.delete('photos', photoId);
}
