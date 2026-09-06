import { useState, useEffect } from 'react';
import { createSession, getSession, saveSession } from '../data/db.js';

const TODAY = new Date().toISOString().split('T')[0];

const EMPTY_FORM = {
  id_dossier:       '',
  adresse:          '',
  nom_proprietaire: '',
  nom_occupant:     '',
  telephone:        '',
  email:            '',
  date_visite:      TODAY,
};

// NOTE : le champ "Type de filière" (traditionnelle / agréée / les deux) a
// été retiré de ce formulaire — il était devenu obsolète car le choix réel
// de la filière se fait désormais dans l'arbre lui-même (section
// "4. Traitement"). Les anciennes sessions qui contiendraient encore cette
// valeur dans session.admin.type_filiere ne sont pas modifiées ; ce champ
// est simplement ignoré partout dans l'app.

export default function AdminScreen({ sessionId, nav }) {
  // sessionId fourni  → on édite les infos d'un dossier déjà créé.
  // sessionId absent  → on crée un nouveau dossier (comportement d'origine).
  // Vérification stricte du type : un appel maladroit comme
  // onClick={nav.goAdmin} transmettrait l'événement de clic (un objet,
  // donc "truthy") comme s'il s'agissait d'un id, ce qui déclencherait à
  // tort le mode édition. On ne considère donc valide qu'une chaîne non vide.
  const isEditMode = typeof sessionId === 'string' && sessionId.length > 0;

  const [form,     setForm]     = useState(EMPTY_FORM);
  const [errors,   setErrors]   = useState({});
  const [saving,   setSaving]   = useState(false);
  const [loading,  setLoading]  = useState(isEditMode);
  const [notFound, setNotFound] = useState(false);

  // En mode édition, on charge les infos actuelles du dossier pour
  // pré-remplir le formulaire. Le try/catch évite qu'une erreur (id
  // invalide, base non ouverte, etc.) ne laisse la roue de chargement
  // tourner indéfiniment sans jamais donner de retour à l'utilisateur.
  useEffect(() => {
    if (!isEditMode) return;
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession(sessionId);
        if (cancelled) return;
        if (!session) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const { id_dossier, adresse, nom_proprietaire, nom_occupant, telephone, email, date_visite } = session.admin;
        setForm({
          id_dossier,
          adresse:          adresse || '',
          nom_proprietaire: nom_proprietaire || '',
          nom_occupant:     nom_occupant || '',
          telephone:        telephone || '',
          email:            email || '',
          date_visite:      date_visite || TODAY,
        });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Erreur de chargement de la session pour édition :', err);
        setNotFound(true);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEditMode, sessionId]);

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: null }));
  };

  const validate = () => {
    const e = {};
    if (!form.id_dossier.trim())       e.id_dossier       = 'Requis';
    if (!form.adresse.trim())          e.adresse          = 'Requis';
    if (!form.nom_proprietaire.trim()) e.nom_proprietaire = 'Requis';
    if (!form.date_visite)             e.date_visite      = 'Requis';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goBack = () => (isEditMode ? nav.goRevision(sessionId) : nav.goHome());

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (isEditMode) {
        const session = await getSession(sessionId);
        if (!session) throw new Error('Session introuvable.');
        // Le n° de dossier (id_dossier) sert d'identifiant de session dans
        // la base locale (clé primaire IndexedDB, noms de fichiers export…) :
        // on ne le laisse jamais changer depuis ce formulaire, même s'il
        // reste visible (champ désactivé ci-dessous).
        session.admin = { ...session.admin, ...form, id_dossier: session.admin.id_dossier };
        await saveSession(session);
        nav.goRevision(sessionId);
      } else {
        const id = await createSession(form);
        nav.goWizard(id);
      }
    } catch (err) {
      alert("Erreur lors de l'enregistrement : " + err.message);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="screen">
        <div className="topbar">
          <button className="topbar-back" onClick={nav.goHome}>←</button>
          <span className="topbar-title">Dossier introuvable</span>
        </div>
        <div className="content">
          <div className="card card-body">
            <p>Cette session n'existe plus.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="topbar-back" onClick={goBack}>←</button>
        <span className="topbar-title">{isEditMode ? 'Informations du dossier' : 'Nouveau contrôle'}</span>
      </div>

      <div className="content">
        {/* Dossier */}
        <div className="card card-body">
          <p className="card-title">Identification du dossier</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="N° dossier *" error={errors.id_dossier}>
              <input
                value={form.id_dossier}
                onChange={e => set('id_dossier', e.target.value)}
                placeholder="ex : 2025-0138"
                autoCapitalize="none"
                disabled={isEditMode}
              />
              {isEditMode && (
                <span className="text-muted" style={{ fontSize: '.78rem' }}>
                  Le n° de dossier ne peut pas être modifié après création.
                </span>
              )}
            </Field>
            <Field label="Date de visite *" error={errors.date_visite}>
              <input
                type="date"
                value={form.date_visite}
                onChange={e => set('date_visite', e.target.value)}
              />
            </Field>
          </div>
        </div>

        {/* Propriétaire */}
        <div className="card card-body">
          <p className="card-title">Propriétaire</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Nom, Prénom *" error={errors.nom_proprietaire}>
              <input
                value={form.nom_proprietaire}
                onChange={e => set('nom_proprietaire', e.target.value)}
                placeholder="DUPONT Jean"
              />
            </Field>
            <Field label="Occupant (si différent)">
              <input
                value={form.nom_occupant}
                onChange={e => set('nom_occupant', e.target.value)}
                placeholder="optionnel"
              />
            </Field>
            <Field label="Téléphone">
              <input
                type="tel"
                value={form.telephone}
                onChange={e => set('telephone', e.target.value)}
                placeholder="06 XX XX XX XX"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="jean.dupont@exemple.fr"
                autoCapitalize="none"
              />
            </Field>
            <Field label="Adresse de l'installation *" error={errors.adresse}>
              <input
                value={form.adresse}
                onChange={e => set('adresse', e.target.value)}
                placeholder="12 chemin des Granges, 38250 Autrans"
              />
            </Field>
          </div>
        </div>

        <button
          className="btn btn-primary btn-full"
          onClick={handleSubmit}
          disabled={saving}
          style={{ minHeight: 56, fontSize: '1.05rem' }}
        >
          {saving
            ? 'Enregistrement…'
            : (isEditMode ? '✓ Enregistrer les modifications' : '▶ Démarrer le contrôle')}
        </button>
      </div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error && <span style={{ color: 'var(--c-danger)', fontSize: '.82rem' }}>{error}</span>}
    </div>
  );
}
