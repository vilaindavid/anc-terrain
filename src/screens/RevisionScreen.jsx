/**
 * RevisionScreen — vue d'ensemble / édition de tous les constats enregistrés.
 *
 * Sections listées verticalement (dérivées de l'arbre, plus de liste figée).
 * Chaque section se déplie pour montrer ses constats avec bandeau de sévérité.
 * Taper un constat ouvre l'éditeur inline (annotation + retour au wizard).
 *
 * Une carte "Informations du dossier" en haut de l'écran permet d'accéder
 * à l'AdminScreen en mode édition pour corriger le nom, l'adresse, la date
 * de visite, etc. sans avoir à recréer une session.
 */

import { useState, useEffect } from 'react';
import { getSession, saveSession, setAnnotation as saveAnnotation, deleteSession } from '../data/db.js';
import { getSections, repairOrphanedData } from '../engine/navigator.js';
import { compareSeverity, SEVERITY_COLOR, severityTextColor } from '../engine/severity.js';
import { computeVerdict } from '../engine/verdict.js';
import SeverityBadge from '../components/SeverityBadge.jsx';

export default function RevisionScreen({ tree, sessionId, nav }) {
  const [session, setSession]     = useState(null);
  const [expanded, setExpanded]   = useState(new Set());
  const [editing, setEditing]     = useState(null); // nodeId being edited
  const [noteVal, setNoteVal]     = useState('');

  const load = async () => {
    const s = await getSession(sessionId);
    if (!s) { setSession(s); return; }
    const { session: repaired, removedCount } = repairOrphanedData(s, tree);
    if (removedCount > 0) {
      await saveSession(repaired);
      setSession(repaired);
    } else {
      setSession(s);
    }
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
  const verdict = computeVerdict(constats);

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

  const dateVisiteStr = admin.date_visite
    ? new Date(admin.date_visite).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  return (
    <div className="screen">
      <div className="topbar">
        <button className="topbar-back" onClick={nav.goHome}>←</button>
        <span className="topbar-title">Révision — {admin.id_dossier}</span>
        <button
          onClick={() => nav.goWizard(sessionId)}
          style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff',
                   borderRadius: 6, padding: '4px 10px', fontSize: '.82rem', cursor: 'pointer' }}
        >
          Wizard
        </button>
      </div>

      {/* Verdict summary */}
      <div style={{ background: verdict.conforme ? '#1E8449' : '#C0392B', color: '#fff',
                     padding: '12px 16px', fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: '1rem' }}>
          {verdict.conforme ? '✅ Conforme' : '❌ Non conforme'}
        </span>
        {verdict.maxClassement && (
          <span style={{ opacity: .85, fontSize: '.85rem' }}>— {verdict.maxClassement}</span>
        )}
        <button
          className="btn"
          onClick={() => nav.goExport(sessionId)}
          style={{ marginLeft: 'auto', background: '#fff', color: '#1a1a1a',
                   minHeight: 36, padding: '0 14px', fontSize: '.82rem' }}
        >
          ↑ Exporter
        </button>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Informations du dossier — accessibles et modifiables à tout moment */}
        <div className="card" style={{ margin: '10px 12px' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="card-label">Informations du dossier</p>
              <p style={{ fontWeight: 700, marginTop: 2 }}>{admin.nom_proprietaire}</p>
              <p className="text-muted" style={{ fontSize: '.85rem' }}>{admin.adresse}</p>
              <p className="text-muted" style={{ fontSize: '.85rem' }}>Visite du {dateVisiteStr}</p>
            </div>
            <button
              className="btn btn-ghost"
              style={{ minHeight: 44, padding: '0 14px', fontSize: '.82rem', flexShrink: 0 }}
              onClick={() => nav.goAdmin(sessionId)}
            >
              ✏️ Modifier
            </button>
          </div>
        </div>

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
