import { useState, useEffect } from 'react';
import { getSession, saveSession, getPhotosForSession } from '../data/db.js';
import { repairOrphanedData } from '../engine/navigator.js';
import { computeVerdict }   from '../engine/verdict.js';
import { buildExportZip, downloadBlob } from '../export/zipBuilder.js';
import { SEVERITY_COLOR, compareSeverity } from '../engine/severity.js';

export default function ExportScreen({ tree, sessionId, nav }) {
  const [session,    setSession]    = useState(null);
  const [photoCount, setPhotoCount] = useState(0);
  // Réponses/constats/saisies orphelins (arbre mis à jour) — voir note
  // ci-dessous : jamais purgés automatiquement.
  const [orphanedCount, setOrphanedCount] = useState(0);
  const [skippedPhotos, setSkippedPhotos] = useState(0);
  const [progress,   setProgress]   = useState(0);
  const [status,     setStatus]     = useState('idle'); // idle | generating | done | error
  const [errorMsg,   setErrorMsg]   = useState('');

  useEffect(() => {
    (async () => {
      const s = await getSession(sessionId);
      if (s) {
        // Vue d'affichage / export uniquement — voir WizardScreen.jsx et
        // RevisionScreen.jsx : on ne sauvegarde plus automatiquement la
        // version "réparée". Une mise à jour de l'arbre (suppression de
        // branches) ne doit jamais effacer silencieusement des données de
        // terrain. La purge reste une action explicite ci-dessous.
        const { session: repaired, removedCount } = repairOrphanedData(s, tree);
        setSession(repaired);
        setOrphanedCount(removedCount);
      }
      const photos = await getPhotosForSession(sessionId);
      setPhotoCount(photos.length);
    })();
  }, [sessionId, tree]);

  const handlePurgeOrphaned = async () => {
    if (!window.confirm(
      `Supprimer définitivement les ${orphanedCount} réponse(s)/constat(s)/saisie(s) qui portent sur des critères absents de l'arbre actuel ?\n\nCette action est irréversible.`
    )) return;
    const fresh = await getSession(sessionId);
    if (!fresh) return;
    const { session: cleaned } = repairOrphanedData(fresh, tree);
    await saveSession(cleaned);
    setSession(cleaned);
    setOrphanedCount(0);
  };

  if (!session) return <div className="screen"><div className="spinner" style={{ margin: 'auto', marginTop: 60 }} /></div>;

  const { admin, constats = [] } = session;
  const verdict = computeVerdict(constats, admin);

  const handleExport = async () => {
    setStatus('generating');
    setProgress(0);
    setErrorMsg('');
    try {
      const { blob, docxName, skippedPhotos: skipped } = await buildExportZip(session, pct => setProgress(pct));
      setSkippedPhotos(skipped || 0);
      const zipName = docxName.replace('.docx', '.zip');
      await downloadBlob(blob, zipName);

      // Mark session as exported
      const updated = { ...session, status: 'exported' };
      await saveSession(updated);
      setSession(updated);
      setStatus('done');
    } catch (err) {
      console.error(err);
      setErrorMsg(formatExportError(err));
      setStatus('error');
    }
  };

  return (
    <div className="screen">
      <div className="topbar">
        <button className="topbar-back" onClick={() => nav.goRevision(sessionId)}>←</button>
        <span className="topbar-title">Export — {admin.id_dossier}</span>
      </div>

      {orphanedCount > 0 && (
        <div style={{ background: '#FEF3C7', color: '#92400E', padding: '10px 16px',
                       fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>
            ⚠️ {orphanedCount} élément{orphanedCount > 1 ? 's' : ''} du dossier {orphanedCount > 1 ? 'portent' : 'porte'} sur des critères absents
            de l'arbre actuel : {orphanedCount > 1 ? 'ils ne seront pas inclus' : 'il ne sera pas inclus'} dans cet export, mais {orphanedCount > 1 ? 'restent conservés' : 'reste conservé'} dans le dossier.
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
            {skippedPhotos > 0 && (
              <p style={{ marginTop: 8, fontSize: '.82rem', color: '#92400E', fontWeight: 600 }}>
                ⚠️ {skippedPhotos} photo{skippedPhotos > 1 ? 's' : ''} n'{skippedPhotos > 1 ? 'ont' : 'a'} pas pu être incluse{skippedPhotos > 1 ? 's' : ''}
                (fichier manquant ou corrompu) — vérifiez sur l'appareil d'origine.
              </p>
            )}
            <button className="btn btn-ghost btn-full" style={{ marginTop: 16 }} onClick={nav.goHome}>
              ← Retour à l'accueil
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="card card-body" style={{ background: '#FEE2E2' }}>
            <p style={{ fontWeight: 700, color: 'var(--c-danger)', marginBottom: 6 }}>Erreur lors de l'export</p>
            <p className="text-muted" style={{ fontSize: '.85rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {errorMsg}
            </p>
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

/**
 * Docxtemplater regroupe les problèmes de modèle sous le message générique
 * "Multi error". Les erreurs individuelles sont conservées dans
 * error.properties.errors : on les restitue afin que la balise en cause soit
 * directement identifiable sur le terrain.
 */
function formatExportError(error) {
  const subErrors = error?.properties?.errors || error?.errors;
  if (!Array.isArray(subErrors) || subErrors.length === 0) {
    return error?.message || 'Une erreur inconnue est survenue lors de l’export.';
  }

  return subErrors.map((subError, index) => {
    const properties = subError?.properties || {};
    const tag = properties.xtag || properties.tag || properties.placeholder;
    const explanation = properties.explanation || subError?.message || 'Erreur de modèle DOCX.';
    const location = Number.isInteger(properties.offset) ? ` (position ${properties.offset})` : '';
    const prefix = tag ? `Balise « ${tag} » : ` : `Erreur ${index + 1} : `;
    return `• ${prefix}${explanation}${location}`;
  }).join('\n');
}
