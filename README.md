# MGRH Grand Ouest — Gestion Adhérents & Événements

Application web de gestion des adhérents et événements pour l'association **Mouvement Génération RH Grand Ouest**.

Hébergée sur GitHub Pages avec persistance des données via Supabase (PostgreSQL).

---

## Architecture

```
mgrh/
├── index.html              ← Page de connexion (SHA-256)
├── app.html                ← Application principale
├── css/
│   └── style.css           ← Styles
├── js/
│   ├── auth.js             ← Authentification (hash SHA-256 + session)
│   ├── app.js              ← Logique métier (adhérents, événements, drag & drop)
│   └── supabase-config.js  ← Configuration Supabase + couche données
├── assets/
│   └── logo.jpg            ← Logo MGRH
└── data/
    └── mgrh-data.json      ← Données initiales (seed automatique au 1er lancement)
```

---

## Mise en place

### 1. Créer le projet Supabase

1. Aller sur [supabase.com](https://supabase.com) → **New Project**
2. Choisir un nom (ex : `mgrh-grandouest`), un mot de passe DB, et la région `EU West`
3. Une fois créé, aller dans **Settings → API** et noter :
   - **Project URL** (ex : `https://abcdefg.supabase.co`)
   - **anon public key** (commence par `eyJ...`)

### 2. Créer la table

Dans Supabase → **SQL Editor** → **New query**, coller et exécuter :

```sql
CREATE TABLE app_data (
  id TEXT PRIMARY KEY DEFAULT 'mgrh-main',
  members JSONB DEFAULT '[]'::jsonb,
  events JSONB DEFAULT '[]'::jsonb,
  last_modified TIMESTAMPTZ DEFAULT now(),
  last_modified_by TEXT DEFAULT 'system'
);

INSERT INTO app_data (id) VALUES ('mgrh-main');

ALTER PUBLICATION supabase_realtime ADD TABLE app_data;

ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON app_data FOR ALL USING (true) WITH CHECK (true);
```

### 3. Configurer le projet

Ouvrir `js/supabase-config.js` et remplacer les 2 valeurs :

```javascript
const SUPABASE_URL = 'https://abcdefg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIs...';
```

### 4. Déployer sur GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit - MGRH app"
git branch -M main
git remote add origin https://github.com/VOTRE_USER/mgrh.git
git push -u origin main
```

Sur GitHub : **Settings → Pages** → branch `main` / root → Save.

URL : `https://VOTRE_USER.github.io/mgrh/`

---

## Identifiants par défaut

| Champ        | Valeur     |
|-------------|------------|
| Identifiant | `admin`    |
| Mot de passe | `mgrh2026` |

### Changer les identifiants

Console navigateur (F12) :
```javascript
async function h(v) {
  const d = new TextEncoder().encode(v);
  const b = await crypto.subtle.digest('SHA-256', d);
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('');
}
h('nouveau_user').then(console.log);
h('nouveau_pass').then(console.log);
```
Remplacer dans `js/auth.js` → `AUTH_CONFIG`.

---

## Stack technique

- **Frontend** : HTML/CSS/JS vanilla (zéro framework)
- **Auth** : SHA-256 côté client (verrou de courtoisie)
- **BDD** : Supabase PostgreSQL (free tier)
- **Hébergement** : GitHub Pages (gratuit)
- **Sync** : Supabase Realtime (WebSocket)
