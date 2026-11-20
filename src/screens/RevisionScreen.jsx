/**
 * RevisionScreen — vue d'ensemble / édition de tous les constats enregistrés.
 *
 * Sections listées verticalement (dérivées de l'arbre, plus de liste figée).
 * Chaque section se déplie pour montrer ses constats avec bandeau de sévérité.
 * Taper un constat ouvre l'éditeur inline (annotation + retour au wizard).
 */

import { useState, useEffect } from 'react';
import { getSession, saveSession, setAnnotation as saveAnnotation } from '../data/db.js';
import { getSections, repairOrphanedData } from '../engine/navigator.js';
import { compareSeverity, SEVERITY_COLOR, severityTextColor } from '../engine/severity.js';
import { computeVerdict } from '../engine/verdict.js';
import SeverityBadge from '../components/SeverityBadge.jsx';

export default function RevisionScreen({ tree, sessionId, nav }) {
  const [session, setSession]     = useState(null);
  // Nombre de réponses/constats/saisies qui pointent vers des nœuds absents
  // de l'arbre courant — voir note dans load() ci-dessous.
  const [orphanedCount, setOrphanedCount] = useState(0);
  const [expanded, setExpanded]   = useState(new Set());
  const [editing, setEditing]     = useState(null); // nodeId being edited
  const [noteVal, setNoteVal]     = useState('');

  const load = async () => {
    const s = await getSession(sessionId);
    if (!s) { setSession(s); return; }
    // Vue d'affichage uniquement : une mise à jour de l'arbre (suppression
    // de branches, etc.) ne doit JAMAIS effacer silencieusement et
    // irréversiblement des données de terrain déjà saisies. On calcule la
    // version filtrée pour l'écran, mais on ne la sauvegarde plus ici — la
    // purge reste une action explicite (bandeau d'avertissement + bouton).
    const { session: repaired, removedCount } = repairOrphanedData(s, tree);
    setSession(repaired);
    setOrphanedCount(removedCount);
  };

  const handlePurgeOrphaned = async () => {
    if (!window.confirm(
      `Supprimer définitivement les ${orphanedCount} réponse(s)/constat(s)/saisie(s) liés à des critères absents ou décochés ?\n\nCette action est irréversible.`
    )) return;
    const fresh = await getSession(sessionId);
    if (!fresh) return;
    const { session: cleaned } = repairOrphanedData(fresh, tree);
    await saveSession(cleaned);
    setOrphanedCount(0);
    setSession(cleaned);
  };

  useEffect(() => { load(); }, [sessionId]);

  const sections = getSections(tree);

  // Déplier la première section par défaut une fois les sections connues.
  useEffect(() => {
    if (sections.length && expanded.size === 0) {
      setExpanded(new Set([sections[0].id]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  if (!session) return <div className="screen"><div className="spinner" style={{ margin: 'auto', marginTop: 60 }} /></div>;

  const { admin, constats = [], saisies = [] } = session;
  const verdict = computeVerdict(constats, admin);

  // Grouper les constats par section
  const bySection = {};
  for (const cst of constats) {
    const secId = _findSectionId(cst.nodeId, tree);
    if (!bySection[secId]) bySection[secId] = [];
    bySection[secId].push(cst);
  }
  for (const arr of Object.values(bySection)) {
    arr.sort((a, b) => compareSeverity(a.classement, b.classement) || a.nodeId.localeCompare(b.nodeId));
  }

  const toggleSection = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startEdit = (cst) => {
    setEditing(cst.nodeId);
    setNoteVal(cst.note_libre || '');
  };

  const saveNote = async () => {
    if (editing) await saveAnnotation(sessionId, editing, noteVal);
    setEditing(null);
    load();
  };

  return (
    <div className="screen">
      <div className="topbar">
        <button className="topbar-back" onClick={nav.goHome}>←</button>
        <span className="topbar-title">Révision — {admin.id_dossier}</span>
        <button
          onClick={() => nav.goAdmin(sessionId)}
          style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff',
                   borderRadius: 6, padding: '4px 10px', fontSize: '.82rem', cursor: 'pointer' }}
        >
          Modifier le dossier
        </button>
        <button
          onClick={() => nav.goWizard(sessionId)}
          style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff',
                   borderRadius: 6, padding: '4px 10px', fontSize: '.82rem', cursor: 'pointer' }}
        >
          Wizard
        </button>
      </div>

      {orphanedCount > 0 && (
        <div style={{ background: '#FEF3C7', color: '#92400E', padding: '10px 16px',
                       fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>
            ⚠️ {orphanedCount} élément{orphanedCount > 1 ? 's' : ''} (réponse{orphanedCount > 1 ? 's' : ''}/constat{orphanedCount > 1 ? 's' : ''}/saisie{orphanedCount > 1 ? 's' : ''})
            {orphanedCount > 1 ? ' sont liés' : ' est lié'} à des critères absents ou décochés. Conservé{orphanedCount > 1 ? 's' : ''} tel quel dans le dossier, mais non visible{orphanedCount > 1 ? 's' : ''} ici.
          </span>
          <button
            style={{ background: '#fff', color: '#92400E', border: 'none', borderRadius: 6,
                      minHeight: 32, padding: '0 10px', fontSize: '.78rem', cursor: 'pointer', fontWeight: 600 }}
            onClick={handlePurgeOrphaned}
          >
            🗑 Purger définitivement
          </button>
        </div>
      )}

      {/* Verdict summary */}
      <div style={{ background: verdict.conforme ? '#1E8449' : '#C0392B', color: '#fff',
                     padding: '12px 16px', fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: '1rem' }}>
          {verdict.conforme ? '✅ Conforme' : '❌ Non conforme'}
        </span>
        {verdict.maxClassement && (
          <span style={{ opacity: .85, fontSize: '.85rem' }}>— {verdict.maxClassement}</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            className="btn"
            onClick={() => nav.goExport(sessionId)}
            style={{ background: '#fff', color: '#1a1a1a', minHeight: 36, padding: '0 14px', fontSize: '.82rem' }}
          >
            ↑ Exporter
          </button>
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {sections.map(sec => {
          const secId    = sec.id;
          const csts      = bySection[secId] || [];
          const isOpen    = expanded.has(secId);
          const maxCls    = csts[0]?.classement || null;
          const bgColor   = maxCls ? SEVERITY_COLOR[maxCls] : 'var(--c-border)';
          const textColor = maxCls ? severityTextColor(maxCls) : 'var(--c-text)';

          return (
            <div key={secId} className="card" style={{ margin: '8px 12px', overflow: 'hidden' }}>
              {/* Section header */}
              <div
                className="section-row"
                onClick={() => toggleSection(secId)}
                style={{ background: isOpen ? '#F0F4F8' : 'var(--c-surface)' }}
              >
                <span style={{ width: 8, height: 36, borderRadius: 4, background: bgColor, flexShrink: 0 }} />
                <span className="section-name">{sec.label}</span>
                <span className="section-badge" style={{ background: bgColor, color: textColor }}>
                  {csts.length} constat{csts.length !== 1 ? 's' : ''}
                </span>
                <span style={{ color: 'var(--c-text-muted)', fontSize: '.9rem' }}>
                  {isOpen ? '▲' : '▼'}
                </span>
              </div>

              {/* Constats list */}
              {isOpen && csts.length === 0 && (
                <p className="text-muted" style={{ padding: '12px 16px', fontSize: '.85rem' }}>
                  Aucun constat pour cette section.
                </p>
              )}

              {isOpen && csts.map(cst => (
                <div key={cst.nodeId} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
                    <div style={{
                      width: 6, flexShrink: 0, alignSelf: 'stretch',
                      background: SEVERITY_COLOR[cst.classement] || 'var(--c-border)',
                    }} />
                    <div style={{ flex: 1, padding: '12px 12px 12px 10px' }}>
                      <SeverityBadge classement={cst.classement} style={{ marginBottom: 6 }} />
                      <p style={{ fontSize: '.88rem', lineHeight: 1.5, marginBottom: 4 }}>
                        {cst.label_constat}
                      </p>
                      {cst.label_reco && (
                        <p style={{ fontSize: '.8rem', color: 'var(--c-text-muted)', lineHeight: 1.4,
                                     borderLeft: '3px solid var(--c-border)', paddingLeft: 8, marginBottom: 4 }}>
                          ↳ {cst.label_reco}
                        </p>
                      )}
                      {cst.note_libre && (
                        <p style={{ fontSize: '.82rem', fontStyle: 'italic', color: 'var(--c-accent)', marginBottom: 4 }}>
                          📝 {cst.note_libre}
                        </p>
                      )}

                      {editing === cst.nodeId ? (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <textarea
                            value={noteVal}
                            onChange={e => setNoteVal(e.target.value)}
                            placeholder="Annotation libre…"
                            style={{ width: '100%', minHeight: 60, border: '2px solid var(--c-accent)',
                                      borderRadius: 6, padding: 8, fontFamily: 'inherit', fontSize: '.88rem', resize: 'vertical' }}
                          />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-primary" style={{ flex: 1, minHeight: 40, fontSize: '.88rem' }} onClick={saveNote}>
                              Enregistrer
                            </button>
                            <button className="btn btn-ghost" style={{ flex: 1, minHeight: 40, fontSize: '.88rem' }} onClick={() => setEditing(null)}>
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          <button
                            style={{ background: 'none', border: '1px solid var(--c-border)', borderRadius: 6,
                                      padding: '4px 10px', fontSize: '.78rem', cursor: 'pointer', color: 'var(--c-text-muted)' }}
                            onClick={() => startEdit(cst)}
                          >
                            ✏️ Annoter
                          </button>
                          <button
                            style={{ background: 'none', border: '1px solid var(--c-border)', borderRadius: 6,
                                      padding: '4px 10px', fontSize: '.78rem', cursor: 'pointer', color: 'var(--c-text-muted)' }}
                            onClick={() => nav.goWizard(sessionId)}
                          >
                            ↺ Modifier
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Saisies for this section */}
              {isOpen && saisies.filter(s => _findSectionId(s.nodeId, tree) === secId).map(sv => (
                <div key={sv.nodeId} style={{ borderTop: '1px solid var(--c-border)', padding: '10px 16px',
                                              display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: '.8rem', color: 'var(--c-text-muted)' }}>📐 {sv.balise}</span>
                  <span style={{ fontWeight: 600 }}>{sv.valeur}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function _findSectionId(nodeId, tree) {
  if (!nodeId || !tree) return 'unknown';
  let cur = tree[nodeId];
  while (cur) {
    if (cur.type === 'categorie') return cur._id;
    cur = cur.parentId ? tree[cur.parentId] : null;
  }
  return 'unknown';
}
