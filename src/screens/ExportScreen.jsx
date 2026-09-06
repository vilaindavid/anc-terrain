import { useState, useEffect } from 'react';
import { getSession, saveSession, getPhotosForSession } from '../data/db.js';
import { repairOrphanedData } from '../engine/navigator.js';
import { computeVerdict }   from '../engine/verdict.js';
import { buildExportZip, downloadBlob } from '../export/zipBuilder.js';
import { SEVERITY_COLOR, compareSeverity } from '../engine/severity.js';

export default function ExportScreen({ tree, sessionId, nav }) {
  const [session,    setSession]    = useState(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [progress,   setProgress]   = useState(0);
  const [status,     setStatus]     = useState('idle'); // idle | generating | done | error
  const [errorMsg,   setErrorMsg]   = useState('');

  useEffect(() => {
    (async () => {
      const s = await getSession(sessionId);
      if (s) {
        const { session: repaired, removedCount } = repairOrphanedData(s, tree);
        if (removedCount > 0) {
          await saveSession(repaired);
          setSession(repaired);
        } else {
          setSession(s);
        }
      }
      const photos = await getPhotosForSession(sessionId);
      setPhotoCount(photos.length);
    })();
  }, [sessionId, tree]);

  if (!session) return <div className="screen"><div className="spinner" style={{ margin: 'auto', marginTop: 60 }} /></div>;

  const { admin, constats = [] } = session;
  const verdict = computeVerdict(constats);

  const handleExport = async () => {
    setStatus('generating');
    setProgress(0);
    setErrorMsg('');
    try {
      const { blob, docxName } = await buildExportZip(session, pct => setProgress(pct));
      const zipName = docxName.replace('.docx', '.zip');
      await downloadBlob(blob, zipName);

      // Mark session as exported
      const updated = { ...session, status: 'exported' };
      await saveSession(updated);
      setSession(updated);
      setStatus('done');
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="screen">
      <div className="topbar">
        <button className="topbar-back" onClick={() => nav.goRevision(sessionId)}>←</button>
        <span className="topbar-title">Export — {admin.id_dossier}</span>
      </div>

      <div className="content">
        {/* Session summary card */}
        <div className="card card-body">
          <p className="card-label">Dossier</p>
          <p style={{ fontWeight: 700, fontSize: '1.05rem' }}>{admin.id_dossier}</p>
          <p className="text-muted">{admin.adresse}</p>
          <p className="text-muted">{admin.nom_proprietaire} — visite du {admin.date_visite}</p>

          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8,
                         background: verdict.conforme ? '#D1FAE5' : '#FEE2E2',
                         color: verdict.conforme ? '#065F46' : '#C0392B', fontWeight: 600 }}>
            {verdict.conforme ? '✅ Installation conforme' : '❌ Non conforme'}
            {verdict.maxClassement && (
              <span style={{ fontWeight: 400, fontSize: '.85rem', marginLeft: 8 }}>
                — {verdict.maxClassement}
              </span>
            )}
          </div>
        </div>

        {/* Constats summary */}
        <div className="card card-body">
          <p className="card-label">{constats.length} constat{constats.length !== 1 ? 's' : ''} enregistré{constats.length !== 1 ? 's' : ''}</p>
          {_topConstats(constats, 3).map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 4,
                              background: SEVERITY_COLOR[c.classement] || '#ccc' }} />
              <p style={{ fontSize: '.85rem', lineHeight: 1.4 }}>{c.label_constat}</p>
            </div>
          ))}
          {constats.length > 3 && (
            <p className="text-muted" style={{ fontSize: '.82rem', marginTop: 8 }}>
              + {constats.length - 3} autre{constats.length - 3 > 1 ? 's' : ''}…
            </p>
          )}
        </div>

        {/* Bundle contents preview */}
        <div className="card card-body">
          <p className="card-label">Contenu du bundle ZIP</p>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            <BundleItem icon="📄" label={`${admin.id_dossier}_Rapport_…docx`} sub="Rapport Word rempli (à finaliser sur PC)" />
            <BundleItem icon="🖼" label={`photos/ (${photoCount} photo${photoCount !== 1 ? 's' : ''})`} sub="Nommées {dossier}_{balise}_{nn}.jpg" />
            <BundleItem icon="✉️" label="mail_proprietaire.txt" sub="Corps de mail pré-rédigé" />
          </ul>
        </div>

        {/* Generate button */}
        {status === 'idle' && (
          <button className="btn btn-primary btn-full" style={{ minHeight: 56, fontSize: '1.05rem' }} onClick={handleExport}>
            ↑ Générer et télécharger le ZIP
          </button>
        )}

        {status === 'generating' && (
          <div className="card card-body" style={{ textAlign: 'center' }}>
            <p style={{ fontWeight: 600, marginBottom: 12 }}>Génération en cours… {progress}%</p>
            <div style={{ height: 8, background: 'var(--c-border)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'var(--c-accent)',
                             borderRadius: 4, transition: 'width .3s' }} />
            </div>
          </div>
        )}

        {status === 'done' && (
          <div className="card card-body" style={{ background: '#D1FAE5', textAlign: 'center' }}>
            <p style={{ fontSize: '2rem', marginBottom: 8 }}>✅</p>
            <p style={{ fontWeight: 700 }}>ZIP téléchargé avec succès</p>
            <p className="text-muted" style={{ marginTop: 4, fontSize: '.85rem' }}>
              Session marquée comme exportée. Ouvrez le dossier sur votre PC pour finaliser le rapport.
            </p>
            <button className="btn btn-ghost btn-full" style={{ marginTop: 16 }} onClick={nav.goHome}>
              ← Retour à l'accueil
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="card card-body" style={{ background: '#FEE2E2' }}>
            <p style={{ fontWeight: 700, color: 'var(--c-danger)', marginBottom: 6 }}>Erreur lors de l'export</p>
            <p className="text-muted" style={{ fontSize: '.85rem' }}>{errorMsg}</p>
            <button className="btn btn-danger btn-full" style={{ marginTop: 12 }} onClick={handleExport}>
              Réessayer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function BundleItem({ icon, label, sub }) {
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{icon}</span>
      <div>
        <p style={{ fontSize: '.88rem', fontWeight: 600 }}>{label}</p>
        <p className="text-muted" style={{ fontSize: '.78rem' }}>{sub}</p>
      </div>
    </li>
  );
}

function _topConstats(constats, n) {
  return [...constats]
    .sort((a, b) => compareSeverity(a.classement, b.classement))
    .slice(0, n);
}
