/**
 * QuestionCard — rendu récursif de l'arborescence (v4.2).
 *
 * AMÉLIORATIONS VISUELLES (v4.2)
 * ───────────────────────────────
 * 1. Lignes de hiérarchie
 *    Les enfants d'un critère coché sont enveloppés dans un div avec
 *    borderLeft gris clair : effet "file explorer" qui ancre visuellement
 *    chaque niveau d'imbrication, même à 3–4 niveaux de profondeur.
 *
 * 2. Preview de sévérité
 *    Un point coloré (10 px) s'affiche à droite de chaque critère non coché
 *    dès que navigator.js a calculé un `previewClassement`. L'inspecteur
 *    sait ce qu'il va enregistrer avant de cocher. La même couleur sert de
 *    bordure gauche (3 px) pour renforcer le signal sans surcharger la ligne.
 *    — Nœuds exclus : l'opacity 0.38 estompe naturellement la couleur ;
 *      pas de traitement spécial nécessaire.
 *    — Nœuds cochés : le badge complet (SeverityBadge) remplace le point.
 *
 * 3. Headers sticky (premier niveau uniquement)
 *    Les en-têtes directement sous la section (depth === 0) restent visibles
 *    en haut de la zone de défilement pendant le scroll. Les en-têtes plus
 *    profonds (dans un sous-arbre déplié) restent statiques pour éviter
 *    l'empilement de plusieurs couches sticky.
 *
 * 4. Contraste fond / cartes
 *    Les option-cards sont blanches sur le fond grisé (var(--c-bg)) de la
 *    zone de contenu. Le fond `var(--c-bg)` est utilisé pour les headers
 *    sticky, les nœuds exclus, et les éléments secondaires.
 */

import { useState, useEffect } from 'react';
import SeverityBadge from './SeverityBadge.jsx';
import PhotoCapture  from './PhotoCapture.jsx';
import { SEVERITY_COLOR } from '../engine/severity.js';

// ─── Composant racine ────────────────────────────────────────────────────────

export default function QuestionCard({
  nodes, session, sessionId, depth = 0,
  onToggle, onNumeric, onAnnotate,
}) {
  return (
    <div>
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

// ─── Nœud ────────────────────────────────────────────────────────────────────

function TreeNode({ node, session, sessionId, depth, onToggle, onNumeric, onAnnotate }) {

  // ── Header ────────────────────────────────────────────────────────────────
  if (node.type === 'header') {
    const isTopLevel = depth === 0;
    return (
      <div>
        <p
          style={isTopLevel ? {
            // Sticky : reste visible en haut de la zone scrollable
            position:   'sticky',
            top:        -16,         // compense le padding-top:16px du conteneur
            zIndex:     10,
            background: 'var(--c-bg)',
            // Déborde des marges du conteneur pour couvrir toute la largeur
            margin:     '0 -16px 6px',
            padding:    '8px 16px 6px',
            borderLeft: '3px solid var(--c-primary)',
            boxShadow:  '0 2px 6px rgba(0,0,0,.08)',
            // Typographie
            fontWeight:    700,
            fontSize:      '.78rem',
            textTransform: 'uppercase',
            letterSpacing: '.04em',
            color:         'var(--c-primary)',
          } : {
            // Headers imbriqués : statiques, style discret
            fontWeight:    700,
            fontSize:      '.75rem',
            textTransform: 'uppercase',
            letterSpacing: '.03em',
            color:         'var(--c-text-muted)',
            margin:        '10px 0 3px',
          }}
        >
          {node.label}
        </p>
        <QuestionCard
          nodes={node.children} session={session} sessionId={sessionId}
          depth={depth}          /* les headers ne constituent pas un niveau hiérarchique */
          onToggle={onToggle} onNumeric={onNumeric} onAnnotate={onAnnotate}
        />
      </div>
    );
  }

  // ── Saisie valeur ─────────────────────────────────────────────────────────
  if (node.type === 'saisie_valeur') {
    return <TextValueRow node={node} onNumeric={onNumeric} />;
  }

  // ── Critère ───────────────────────────────────────────────────────────────
  const isRadio    = !!node.exclusionGroup;
  const isExcluded = !!node.excluded;
  const constats   = (session?.constats || []).filter(c => c.nodeId === node.id);

  // Couleur de sévérité pour la bordure gauche et le point preview
  const sevColor = node.previewClassement
    ? (SEVERITY_COLOR[node.previewClassement] || null)
    : null;

  // Styles de la carte selon l'état
  const cardStyle = {
    padding:  '10px 12px',
    minHeight: 44,
    // Bordure gauche colorée : signal de sévérité (absente si nœud exclu)
    ...(sevColor && !isExcluded ? { borderLeft: `3px solid ${sevColor}` } : {}),
    // Nœud exclu : estomper sans bloquer le clic (permet de changer la sélection)
    ...(isExcluded ? { opacity: 0.38, background: 'var(--c-bg)' } : {}),
  };

  return (
    <div style={{ marginBottom: 5 }}>

      {/* ── Carte critère ─────────────────────────────────────────────── */}
      <div
        className={`option-card ${node.checked ? 'selected' : ''}`}
        onClick={() => onToggle(node.id, !node.checked)}
        style={cardStyle}
      >
        {/* Indicateur case / radio */}
        <div className="check" style={{ borderRadius: isRadio ? '50%' : 4, flexShrink: 0 }} />

        {/* Libellé */}
        <span
          className="option-label"
          style={{
            fontSize: '.92rem',
            flex: 1,
            ...(isExcluded ? { color: 'var(--c-text-muted)' } : {}),
          }}
        >
          {node.label}
        </span>

        {/* Point de sévérité preview (visible seulement si non coché et non exclu) */}
        {!node.checked && !isExcluded && sevColor && (
          <span
            title={node.previewClassement}
            style={{
              width:       10,
              height:      10,
              borderRadius: '50%',
              flexShrink:  0,
              alignSelf:   'center',
              background:  sevColor,
              marginLeft:  6,
            }}
          />
        )}
      </div>

      {/* ── Constats enregistrés (nœud coché) ──────────────────────────── */}
      {node.checked && constats.map((cst, i) => (
        <div
          key={cst.nodeId + i}
          className="card"
          style={{ marginTop: 5, marginLeft: 18, borderLeft: '4px solid var(--c-accent)' }}
        >
          <div className="card-body" style={{ padding: '10px 12px' }}>
            <SeverityBadge classement={cst.classement} style={{ marginBottom: 6 }} />
            <p style={{ fontSize: '.85rem', lineHeight: 1.4, marginBottom: 4 }}>
              {cst.label_constat}
            </p>
            {cst.label_reco && (
              <p style={{
                fontSize: '.8rem', color: 'var(--c-text-muted)', lineHeight: 1.4,
                borderLeft: '3px solid var(--c-border)', paddingLeft: 8, marginBottom: 6,
              }}>
                ↳ {cst.label_reco}
              </p>
            )}
            <AnnotationRow cst={cst} sessionId={sessionId} onAnnotate={onAnnotate} />
          </div>
        </div>
      ))}

      {/* ── Sous-arborescence avec ligne de hiérarchie ─────────────────── */}
      {node.checked && node.children.length > 0 && (
        <div
          style={{
            marginLeft:  10,
            paddingLeft: 10,
            borderLeft:  '2px solid var(--c-border)',
            marginTop:   3,
          }}
        >
          <QuestionCard
            nodes={node.children} session={session} sessionId={sessionId}
            depth={depth + 1}
            onToggle={onToggle} onNumeric={onNumeric} onAnnotate={onAnnotate}
          />
        </div>
      )}
    </div>
  );
}

// ─── Saisie texte libre ───────────────────────────────────────────────────────

function TextValueRow({ node, onNumeric }) {
  const [value, setValue] = useState(node.value ?? '');

  useEffect(() => {
    setValue(node.value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.value]);

  const commit = () => {
    if (value !== (node.value ?? '')) onNumeric(node.id, value);
  };

  return (
    <div className="card" style={{ marginBottom: 5 }}>
      <div className="card-body" style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      }}>
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

// ─── Annotation libre ─────────────────────────────────────────────────────────

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
          style={{
            width: '100%', minHeight: 56, padding: 8, resize: 'vertical',
            border: '2px solid var(--c-accent)', borderRadius: 6,
            fontFamily: 'inherit', fontSize: '.85rem',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1, minHeight: 36, fontSize: '.82rem' }}
            onClick={() => { onAnnotate(cst.nodeId, noteVal); setEditing(false); }}
          >
            Enregistrer
          </button>
          <button
            className="btn btn-ghost"
            style={{ flex: 1, minHeight: 36, fontSize: '.82rem' }}
            onClick={() => setEditing(false)}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {cst.note_libre && (
        <p style={{
          fontSize: '.8rem', fontStyle: 'italic',
          color: 'var(--c-accent)', flexBasis: '100%',
        }}>
          📝 {cst.note_libre}
        </p>
      )}
      <button
        style={{
          background: 'none', border: '1px solid var(--c-border)', borderRadius: 6,
          padding: '4px 10px', fontSize: '.75rem', cursor: 'pointer',
          color: 'var(--c-text-muted)',
        }}
        onClick={() => setEditing(true)}
      >
        ✏️ Annoter
      </button>
      <PhotoCapture
        sessionId={sessionId}
        nodeId={cst.nodeId}
        balise={cst.balise_constat}
        onCapture={() => {}}
      />
    </div>
  );
}
