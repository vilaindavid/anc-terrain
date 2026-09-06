/**
 * QuestionCard — rendu récursif de l'arborescence (v4).
 *
 * Reçoit le tableau produit par navigator.buildVisibleTree et se contente
 * de l'afficher : header = titre + récursion automatique, critere = ligne
 * à cocher (case ou pastille radio selon exclusionGroup) qui déplie ses
 * enfants une fois coché, saisie_valeur = stepper numérique.
 * Les constats/recommandations rattachés à un critère coché sont recherchés
 * dans session.constats (déjà enrichis par db.js : label, note, etc.) et
 * affichés juste en dessous, avec annotation libre + photo.
 */

import { useState, useEffect } from 'react';
import SeverityBadge from './SeverityBadge.jsx';
import PhotoCapture from './PhotoCapture.jsx';

export default function QuestionCard({ nodes, session, sessionId, depth = 0, onToggle, onNumeric, onAnnotate }) {
  return (
    <div style={{ paddingLeft: depth ? 14 : 0 }}>
      {nodes.map(node => (
        <TreeNode
          key={node.id}
          node={node}
          session={session}
          sessionId={sessionId}
          depth={depth}
          onToggle={onToggle}
          onNumeric={onNumeric}
          onAnnotate={onAnnotate}
        />
      ))}
    </div>
  );
}

function TreeNode({ node, session, sessionId, depth, onToggle, onNumeric, onAnnotate }) {
  if (node.type === 'header') {
    return (
      <div style={{ margin: '12px 0 4px' }}>
        <p style={{
          fontWeight: 700, fontSize: '.78rem', textTransform: 'uppercase',
          letterSpacing: '.03em', color: 'var(--c-text-muted)', marginBottom: 4,
        }}>
          {node.label}
        </p>
        <QuestionCard
          nodes={node.children} session={session} sessionId={sessionId} depth={depth}
          onToggle={onToggle} onNumeric={onNumeric} onAnnotate={onAnnotate}
        />
      </div>
    );
  }

  if (node.type === 'saisie_valeur') {
    return <TextValueRow node={node} onNumeric={onNumeric} />;
  }

  // critere
  const isRadio = !!node.exclusionGroup;
  const constats = (session?.constats || []).filter(c => c.nodeId === node.id);

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        className={`option-card ${node.checked ? 'selected' : ''}`}
        onClick={() => onToggle(node.id, !node.checked)}
        style={{ padding: '10px 12px', minHeight: 44 }}
      >
        <div className="check" style={{ borderRadius: isRadio ? '50%' : 4 }} />
        <span className="option-label" style={{ fontSize: '.92rem' }}>{node.label}</span>
      </div>

      {node.checked && constats.map((cst, i) => (
        <div key={cst.nodeId + i} className="card"
             style={{ marginTop: 6, marginLeft: 18, borderLeft: '4px solid var(--c-accent)' }}>
          <div className="card-body" style={{ padding: '10px 12px' }}>
            <SeverityBadge classement={cst.classement} style={{ marginBottom: 6 }} />
            <p style={{ fontSize: '.85rem', lineHeight: 1.4, marginBottom: 4 }}>{cst.label_constat}</p>
            {cst.label_reco && (
              <p style={{ fontSize: '.8rem', color: 'var(--c-text-muted)', lineHeight: 1.4,
                          borderLeft: '3px solid var(--c-border)', paddingLeft: 8, marginBottom: 6 }}>
                ↳ {cst.label_reco}
              </p>
            )}
            <AnnotationRow cst={cst} sessionId={sessionId} onAnnotate={onAnnotate} />
          </div>
        </div>
      ))}

      {node.checked && node.children.length > 0 && (
        <QuestionCard
          nodes={node.children} session={session} sessionId={sessionId} depth={depth + 1}
          onToggle={onToggle} onNumeric={onNumeric} onAnnotate={onAnnotate}
        />
      )}
    </div>
  );
}

function TextValueRow({ node, onNumeric }) {
  // Champ libre : aucune unité ni aucun pas d'incrémentation n'est deviné —
  // l'inspecteur écrit la valeur comme il l'entend (ex : "3000 L",
  // "5 x 2 m", "12"). État local pour une frappe fluide, avec
  // resynchronisation si la valeur change depuis l'extérieur (reprise de
  // session après réparation des données, nettoyage en cascade d'un
  // critère parent, changement de section puis retour).
  const [value, setValue] = useState(node.value ?? '');

  useEffect(() => {
    setValue(node.value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.value]);

  const commit = () => {
    if (value !== (node.value ?? '')) onNumeric(node.id, value);
  };

  return (
    <div className="card" style={{ marginBottom: 6 }}>
      <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
        <span style={{ flex: 1, fontSize: '.88rem' }}>{node.label}</span>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder="valeur…"
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
          style={{
            width: 130, textAlign: 'right', fontSize: '.9rem',
            border: '2px solid var(--c-border)', borderRadius: 8,
            padding: '8px 10px', fontFamily: 'inherit', minHeight: 40,
          }}
        />
      </div>
    </div>
  );
}

function AnnotationRow({ cst, sessionId, onAnnotate }) {
  const [editing, setEditing] = useState(false);
  const [noteVal, setNoteVal] = useState(cst.note_libre || '');

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          value={noteVal}
          onChange={e => setNoteVal(e.target.value)}
          placeholder="Observations complémentaires…"
          style={{ width: '100%', minHeight: 56, border: '2px solid var(--c-accent)', borderRadius: 6,
                   padding: 8, fontFamily: 'inherit', fontSize: '.85rem', resize: 'vertical' }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1, minHeight: 36, fontSize: '.82rem' }}
                  onClick={() => { onAnnotate(cst.nodeId, noteVal); setEditing(false); }}>
            Enregistrer
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, minHeight: 36, fontSize: '.82rem' }}
                  onClick={() => setEditing(false)}>
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {cst.note_libre && (
        <p style={{ fontSize: '.8rem', fontStyle: 'italic', color: 'var(--c-accent)', flexBasis: '100%' }}>
          📝 {cst.note_libre}
        </p>
      )}
      <button
        style={{ background: 'none', border: '1px solid var(--c-border)', borderRadius: 6,
                 padding: '4px 10px', fontSize: '.75rem', cursor: 'pointer', color: 'var(--c-text-muted)' }}
        onClick={() => setEditing(true)}
      >
        ✏️ Annoter
      </button>
      <PhotoCapture sessionId={sessionId} nodeId={cst.nodeId} balise={cst.balise_constat} onCapture={() => {}} />
    </div>
  );
}
