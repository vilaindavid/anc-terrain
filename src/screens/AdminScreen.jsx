import { useState, useEffect } from 'react';
import { createSession, getSession, updateSessionAdmin } from '../data/db.js';

const TODAY = new Date().toISOString().split('T')[0];

const EMPTY_FORM = {
  id_dossier:                '',
  adresse:                   '',
  nom_proprietaire:          '',
  nom_occupant:              '',
  copro:                     '',
  telephone:                 '',
  email:                     '',
  date_visite:               TODAY,
  zone_enjeu_sanitaire:      false,
  zone_enjeu_environnemental: false,
};

export default function AdminScreen({ tree, sessionId, nav }) {
  const isEditing = !!sessionId;

  const [form,    setForm]    = useState(EMPTY_FORM);
  const [errors,  setErrors]  = useState({});
  const [saving,  setSaving]  = useState(false);
  // Tant qu'on n'a pas chargé le dossier existant, on n'affiche pas le
  // formulaire vide : c'est justement ça qui causait l'écrasement (l'agent
  // saisissait à nouveau le même n° de dossier dans un formulaire vierge).
  const [loading, setLoading] = useState(isEditing);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      const existing = await getSession(sessionId);
      if (!cancelled) {
        if (existing) {
          const { type_filiere: _obsoleteTypeFiliere, ...admin } = existing.admin;
          setForm({ ...EMPTY_FORM, ...admin });
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: null }));
  };

  const toggle = (field) => setForm(f => ({ ...f, [field]: !f[field] }));

  const validate = () => {
    const e = {};
    if (!form.id_dossier.trim())       e.id_dossier       = 'Requis';
    if (!form.adresse.trim())          e.adresse          = 'Requis';
    if (!form.nom_proprietaire.trim()) e.nom_proprietaire = 'Requis';
    if (!form.date_visite)             e.date_visite      = 'Requis';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleStart = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (isEditing) {
        // Édition d'un dossier existant : on met à jour seulement les
        // infos admin. On ne recrée JAMAIS la session ici — sinon
        // db.put écraserait answers/constats/saisies déjà enregistrés.
        const id = await updateSessionAdmin(sessionId, form);
        nav.goRevision(id);
      } else {
        const id = await createSession(form);
        nav.goWizard(id);
      }
    } catch (err) {
      if (err?.code === 'DUPLICATE_SESSION_ID') {
        setErrors(e => ({ ...e, id_dossier: err.message }));
        setSaving(false);
        return;
      }
      alert('Erreur lors de l\'enregistrement : ' + err.message);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="screen">
        <div className="topbar">
          <button className="topbar-back" onClick={nav.goHome}>←</button>
          <span className="topbar-title">Modifier le dossier</span>
        </div>
        <div className="content">
          <div className="spinner" style={{ marginTop: 40 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="topbar-back" onClick={isEditing ? () => nav.goRevision(sessionId) : nav.goHome}>←</button>
        <span className="topbar-title">{isEditing ? 'Modifier le dossier' : 'Nouveau contrôle'}</span>
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
              />
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
            <Field label="Nom de la copropriété">
              <input
                value={form.copro}
                onChange={e => set('copro', e.target.value)}
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

        {/* Zone à enjeu — influence les délais de travaux pour les cas (c) */}
        <div className="card card-body">
          <p className="card-title">Zone à enjeu</p>
          <p className="text-muted" style={{ fontSize: '.85rem', marginBottom: 12 }}>
            Si la parcelle se situe dans une zone à enjeu, un défaut de type (c)
            (incomplet, sous-dimensionné, dysfonctionnement majeur) entraîne une
            obligation de travaux sous 4 ans au lieu d'une simple obligation
            acquéreur. Les deux cases sont indépendantes.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              className={`option-card rect ${form.zone_enjeu_sanitaire ? 'selected' : ''}`}
              onClick={() => toggle('zone_enjeu_sanitaire')}
            >
              <div className="check" />
              <div>
                <div className="option-label" style={{ fontWeight: 600 }}>
                  Zone à enjeu sanitaire
                </div>
                <div className="text-muted" style={{ fontSize: '.82rem' }}>
                  Puits AEP à moins de 35 m, périmètre de captage, nuisances
                  olfactives avec plainte…
                </div>
              </div>
            </div>
            <div
              className={`option-card rect ${form.zone_enjeu_environnemental ? 'selected' : ''}`}
              onClick={() => toggle('zone_enjeu_environnemental')}
            >
              <div className="check" />
              <div>
                <div className="option-label" style={{ fontWeight: 600 }}>
                  Zone à enjeu environnemental
                </div>
                <div className="text-muted" style={{ fontSize: '.82rem' }}>
                  Zone inondable, zone naturelle protégée (Natura 2000…),
                  zone de baignade…
                </div>
              </div>
            </div>
          </div>
        </div>

        <button
          className="btn btn-primary btn-full"
          onClick={handleStart}
          disabled={saving}
          style={{ minHeight: 56, fontSize: '1.05rem' }}
        >
          {saving
            ? (isEditing ? 'Enregistrement…' : 'Création…')
            : (isEditing ? '💾 Enregistrer les modifications' : '▶ Démarrer le contrôle')}
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
