/**
 * App — top-level state machine.
 *
 * SCREENS
 * ───────
 * 'loading'   → initial fetch of tree.json + DB open
 * 'home'      → session list
 * 'admin'     → formulaire d'infos du dossier (création OU édition d'une
 *               session existante, selon qu'un sessionId est fourni)
 * 'wizard'    → guided field inspection
 * 'revision'  → collapsible overview / edit mode
 * 'export'    → export preview + download
 *
 * State passed down as props (no external store library — the app is small
 * enough that prop drilling is acceptable; add Zustand/Jotai if it grows).
 */

import { useState, useEffect, useCallback } from 'react';
import { loadTree } from './data/treeLoader.js';
import { openDatabase } from './data/db.js';
import HomeScreen    from './screens/HomeScreen.jsx';
import AdminScreen   from './screens/AdminScreen.jsx';
import WizardScreen  from './screens/WizardScreen.jsx';
import RevisionScreen from './screens/RevisionScreen.jsx';
import ExportScreen  from './screens/ExportScreen.jsx';

export default function App() {
  const [screen,    setScreen]    = useState('loading');
  const [tree,      setTree]      = useState(null);
  const [error,     setError]     = useState(null);
  // Active session id (string) — screens load session data themselves from DB
  const [sessionId, setSessionId] = useState(null);

  // ── Initialise on mount ──────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        await openDatabase();
        const t = await loadTree();
        setTree(t);
        setScreen('home');
      } catch (err) {
        console.error(err);
        setError(err.message);
      }
    })();
  }, []);

  // ── Navigation helpers ───────────────────────────────────────────────────
  const goHome = useCallback(() => {
    setSessionId(null);
    setScreen('home');
  }, []);

  // id absent → création d'un nouveau dossier ; id fourni → édition des
  // infos d'un dossier existant (AdminScreen adapte son comportement).
  const goAdmin = useCallback((id) => {
    setSessionId(id || null);
    setScreen('admin');
  }, []);

  const goWizard = useCallback((id) => {
    setSessionId(id);
    setScreen('wizard');
  }, []);

  const goRevision = useCallback((id) => {
    setSessionId(id || sessionId);
    setScreen('revision');
  }, [sessionId]);

  const goExport = useCallback((id) => {
    setSessionId(id || sessionId);
    setScreen('export');
  }, [sessionId]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (error) return <ErrorScreen message={error} />;
  if (screen === 'loading') return <LoadingScreen />;

  const nav = { goHome, goAdmin, goWizard, goRevision, goExport };

  switch (screen) {
    case 'home':
      return <HomeScreen tree={tree} nav={nav} />;

    case 'admin':
      return <AdminScreen tree={tree} sessionId={sessionId} nav={nav} />;

    case 'wizard':
      return <WizardScreen tree={tree} sessionId={sessionId} nav={nav} />;

    case 'revision':
      return <RevisionScreen tree={tree} sessionId={sessionId} nav={nav} />;

    case 'export':
      return <ExportScreen tree={tree} sessionId={sessionId} nav={nav} />;

    default:
      return <HomeScreen tree={tree} nav={nav} />;
  }
}

// ── Local helper screens ─────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', gap: 16 }}>
      <div className="spinner" />
      <p className="text-muted text-center">Chargement de l'arbre décisionnel…</p>
    </div>
  );
}

function ErrorScreen({ message }) {
  return (
    <div className="screen" style={{ justifyContent: 'center', padding: 24 }}>
      <div className="card card-body" style={{ background: '#FEE2E2', borderLeft: '4px solid #C0392B' }}>
        <p style={{ fontWeight: 600, color: '#C0392B' }}>Erreur de chargement</p>
        <p className="text-muted mt-8">{message}</p>
        <p className="text-muted mt-8">
          Assurez-vous que <code>tree.json</code> et{' '}
          <code>Trame_rapport_avec_balises.docx</code> sont bien dans{' '}
          <code>/public/</code>.
        </p>
      </div>
    </div>
  );
}
