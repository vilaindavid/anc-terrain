import { useState, useEffect, useCallback } from 'react';
import {
  getSession, recordAnswer, recordSaisie, deleteSaisie, setAnnotation,
  saveWizardPosition, saveSession, clearDescendantAnswers,
} from '../data/db.js';
import {
  getSections, buildVisibleTree, collectRecords, exclusionGroupMembers,
  sectionProgress, collectDescendantAnswerIds, repairOrphanedData,
} from '../engine/navigator.js';
import QuestionCard from '../components/QuestionCard.jsx';

export default function WizardScreen({ tree, sessionId, nav }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState(null);
  // Nombre de réponses/constats/saisies qui pointent vers des nœuds absents
  // de l'arbre courant (ex. branches retirées lors d'une mise à jour de
  // tree.json). Affiché comme avertissement — jamais purgé automatiquement.
  const [orphanedCount, setOrphanedCount] = useState(0);

  const sections = getSections(tree);

  useEffect(() => {
    (async () => {
      const s = await getSession(sessionId);
      if (!s) return;
      // Calcule une vue "réparée" (sans réponses/constats/saisies devenus
      // invisibles suite à une mise à jour de l'arbre) UNIQUEMENT pour
      // l'affichage courant. On ne l'enregistre JAMAIS automatiquement :
      // une évolution de tree.json (suppression de branches, etc.) ne doit
      // jamais effacer silencieusement et irréversiblement des données déjà
      // saisies sur le terrain. La purge reste une action explicite de
      // l'inspecteur (bandeau d'avertissement ci-dessous).
      const { session: repaired, removedCount } = repairOrphanedData(s, tree);
      setSession(repaired);
      setOrphanedCount(removedCount);
      setActiveSection(s.currentSection && tree[s.currentSection] ? s.currentSection : sections[0]?.id);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, tree]);

  const handlePurgeOrphaned = useCallback(async () => {
    if (!window.confirm(
      `Supprimer définitivement les ${orphanedCount} réponse(s)/constat(s)/saisie(s) qui portent sur des critères absents de l'arbre actuel ?\n\nCette action est irréversible.`
    )) return;
    const fresh = await getSession(sessionId);
    if (!fresh) return;
    const { session: cleaned } = repairOrphanedData(fresh, tree);
    await saveSession(cleaned);
    setSession(cleaned);
    setOrphanedCount(0);
  }, [sessionId, tree, orphanedCount]);

  const refresh = useCallback(async () => {
    setSession(await getSession(sessionId));
  }, [sessionId]);

  const switchSection = useCallback(async (sectionId) => {
    setActiveSection(sectionId);
    // `queue` n'existe plus dans le nouveau moteur ; on garde l'appel pour
    // ne pas toucher db.js maintenant, mais il ne sert plus qu'à mémoriser
    // l'onglet courant (currentSection). À nettoyer plus tard côté db.js.
    await saveWizardPosition(sessionId, sectionId, []);
  }, [sessionId]);

  const handleToggle = useCallback(async (nodeId, checked) => {
    if (!session) return;
    const node = tree[nodeId];
    if (!node) return;

    // Décochage direct : si des réponses plus profondes existent sous ce
    // critère, elles resteraient sinon invisibles à l'écran mais actives
    // dans le verdict et l'export DOCX. On demande confirmation puis on
    // nettoie tout (answers + constats + saisies).
    if (!checked) {
      const descendantIds = collectDescendantAnswerIds(nodeId, tree, session.answers);
      if (descendantIds.length > 0) {
        const ok = window.confirm(
          `Décocher « ${node.label} » effacera ${descendantIds.length} réponse${descendantIds.length > 1 ? 's' : ''} enregistrée${descendantIds.length > 1 ? 's' : ''} plus bas dans cette branche.\n\nContinuer ?`
        );
        if (!ok) return; // annulé : on ne touche à rien
        await clearDescendantAnswers(sessionId, descendantIds);
      }
    }

    // Si on coche un membre d'un groupe radio, décocher silencieusement les
    // autres membres actuellement cochés — remplacement intentionnel, pas
    // de confirmation — et nettoyer leurs descendants de la même façon.
    const siblings = checked && node.exclusionGroup
      ? exclusionGroupMembers(nodeId, tree).filter(id => id !== nodeId && session.answers[id]?.checked)
      : [];

    for (const sibId of siblings) {
      const sibDescendants = collectDescendantAnswerIds(sibId, tree, session.answers);
      if (sibDescendants.length > 0) await clearDescendantAnswers(sessionId, sibDescendants);
      await recordAnswer(sessionId, sibId, { checked: false }, []);
    }

    const records = checked ? collectRecords(node, tree) : [];
    await recordAnswer(sessionId, nodeId, { checked }, records);
    await refresh();
  }, [session, sessionId, tree, refresh]);

  const handleNumeric = useCallback(async (nodeId, value) => {
    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (trimmed === '' || trimmed === null || trimmed === undefined) {
      await deleteSaisie(sessionId, nodeId);
    } else {
      await recordSaisie(sessionId, nodeId, trimmed, tree[nodeId]?.section);
    }
    await refresh();
  }, [sessionId, tree, refresh]);

  const handleAnnotate = useCallback(async (nodeId, note) => {
    await setAnnotation(sessionId, nodeId, note);
    await refresh();
  }, [sessionId, refresh]);

  if (loading || !session || !activeSection) return <Loading />;

  const visibleTree = buildVisibleTree(activeSection, tree, session.answers);
  const { done, total, pct } = sectionProgress(activeSection, tree, session.answers);

  return (
    <div className="screen">
      <div className="topbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
        <div className="flex items-center gap-8">
          <button className="topbar-back" onClick={nav.goHome}>←</button>
          <span className="topbar-title" style={{ fontSize: '.9rem', flex: 1 }}>
            {session.admin.id_dossier}
          </span>
          <button
            onClick={() => nav.goRevision(sessionId)}
            style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff',
                     borderRadius: 6, padding: '4px 10px', fontSize: '.82rem', cursor: 'pointer' }}
          >
            Vue d'ensemble
          </button>
        </div>
        <div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <p style={{ color: 'rgba(255,255,255,.7)', fontSize: '.75rem', textAlign: 'right', marginTop: 2 }}>
            {done} / {total}
          </p>
        </div>
      </div>

      {orphanedCount > 0 && (
        <div style={{ background: '#FEF3C7', color: '#92400E', padding: '10px 16px',
                       fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>
            ⚠️ {orphanedCount} élément{orphanedCount > 1 ? 's' : ''} (réponse{orphanedCount > 1 ? 's' : ''}/constat{orphanedCount > 1 ? 's' : ''}/saisie{orphanedCount > 1 ? 's' : ''})
            {orphanedCount > 1 ? ' portent' : ' porte'} sur des critères absents de l'arbre actuel. Conservé{orphanedCount > 1 ? 's' : ''} tel quel dans le dossier, mais non visible{orphanedCount > 1 ? 's' : ''} ici.
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

      {/* Onglets de section — toujours navigables, aucune séquence imposée */}
      <div style={{ display: 'flex', overflowX: 'auto', background: 'var(--c-surface)',
                    borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
        {sections.map(sec => (
          <button
            key={sec.id}
            onClick={() => switchSection(sec.id)}
            style={{
              padding: '8px 14px', whiteSpace: 'nowrap', border: 'none', background: 'none',
              fontSize: '.82rem', fontWeight: 600, cursor: 'pointer',
              color: sec.id === activeSection ? 'var(--c-accent)' : 'var(--c-text-muted)',
              borderBottom: sec.id === activeSection ? '2px solid var(--c-accent)' : '2px solid transparent',
            }}
          >
            {sec.label}
          </button>
        ))}
      </div>

      <div className="content" style={{ overflowY: 'auto' }}>
        <QuestionCard
          nodes={visibleTree}
          session={session}
          sessionId={sessionId}
          onToggle={handleToggle}
          onNumeric={handleNumeric}
          onAnnotate={handleAnnotate}
        />
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="screen" style={{ justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  );
}
