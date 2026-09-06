import { useState, useEffect } from 'react';
import { listSessions, deleteSession } from '../data/db.js';
import SeverityBadge from '../components/SeverityBadge.jsx';
import { computeVerdict } from '../engine/verdict.js';

export default function HomeScreen({ nav }) {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);

  const refresh = async () => {
    setLoading(true);
    const list = await listSessions();
    setSessions(list);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Supprimer cette session ? Cette action est irréversible.')) return;
    await deleteSession(id);
    refresh();
  };

  return (
    <div className="screen">
      {/* Top bar */}
      <div className="topbar">
        <span className="topbar-title">🔍 Contrôles ANC</span>
        <button className="btn btn-accent" onClick={() => nav.goAdmin()}
                style={{ minHeight: 40, padding: '0 14px', fontSize: '.9rem' }}>
          + Nouveau
        </button>
      </div>

      <div className="content">
        {loading && <div className="spinner" style={{ marginTop: 40 }} />}

        {!loading && sessions.length === 0 && (
          <div className="card card-body text-center" style={{ marginTop: 40 }}>
            <p style={{ fontSize: '2rem', marginBottom: 8 }}>📋</p>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>Aucune session</p>
            <p className="text-muted">Appuyez sur « + Nouveau » pour démarrer un contrôle.</p>
          </div>
        )}

        {!loading && sessions.map(s => (
          <SessionRow
            key={s.id}
            session={s}
            onOpen={()     => nav.goWizard(s.id)}
            onRevise={()   => nav.goRevision(s.id)}
            onExport={()   => nav.goExport(s.id)}
            onEditInfo={() => nav.goAdmin(s.id)}
            onDelete={(e)  => handleDelete(s.id, e)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionRow({ session, onOpen, onRevise, onExport, onEditInfo, onDelete }) {
  const { admin, status, constats = [], updatedAt } = session;
  const verdict = computeVerdict(constats);
  const dateStr = new Date(updatedAt).toLocaleDateString('fr-FR',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const statusLabel = { active: 'En cours', incomplete: 'Incomplet', exported: 'Exporté' };
  const statusCls   = { active: 'badge-active', incomplete: 'badge-incomplete', exported: 'badge-exported' };

  return (
    <div className="card">
      {/* Severity indicator strip */}
      {verdict.maxClassement && (
        <div style={{ height: 6, background: _severityColor(verdict.maxClassement) }} />
      )}

      <div className="card-body">
        {/* Header row */}
        <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', flex: 1 }}>
            {admin.id_dossier}
          </span>
          <span className={`section-badge ${statusCls[status] || 'badge-incomplete'}`}>
            {statusLabel[status] || status}
          </span>
        </div>

        <p style={{ fontSize: '.9rem', color: 'var(--c-text-muted)', marginBottom: 4 }}>
          {admin.adresse}
        </p>
        <p style={{ fontSize: '.85rem', color: 'var(--c-text-muted)' }}>
          {admin.nom_proprietaire} — {dateStr}
        </p>

        {verdict.maxClassement && (
          <SeverityBadge classement={verdict.maxClassement} style={{ marginTop: 8 }} />
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {status !== 'exported' && (
            <button className="btn btn-primary" style={{ flex: 1, minHeight: 48 }} onClick={onOpen}>
              ▶ Reprendre
            </button>
          )}
          <button className="btn btn-ghost" style={{ flex: 1, minHeight: 48 }} onClick={onEditInfo}>
            ✏️ Infos
          </button>
          <button className="btn btn-ghost" style={{ flex: 1, minHeight: 48 }} onClick={onRevise}>
            📋 Réviser
          </button>
          <button className="btn btn-accent" style={{ flex: 1, minHeight: 48 }} onClick={onExport}>
            ↑ Exporter
          </button>
          <button className="btn btn-danger" style={{ minHeight: 48, padding: '0 14px' }} onClick={onDelete}>
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

function _severityColor(classement) {
  const map = {
    "Simple remarque":                     "#dae8fc",
    "Recommandation de travaux":           "#d5e8d4",
    "Défaut d'entretien ou d'usure":       "#fff2cc",
    "Sous-dimensionnement significatif":   "#ffe6cc",
    "Défaut de structure ou de fermeture": "#fa6800",
    "Dysfonctionnement majeur":            "#f8cecc",
    "Assainissement incomplet":            "#e1d5e7",
    "Absence d'installation":              "#76608a",
    "Défaut de sécurité sanitaire":        "#e51400",
    "Danger pour la sécurité des personnes": "#cc0000",
  };
  return map[classement] || 'var(--c-border)';
}
