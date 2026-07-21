# Progetto: Test Google Workspace Login

## Obiettivo
Pagina di test, unico contenuto: "Benvenuto con Google", visibile SOLO se
l'utente fa login con un account **Google Workspace del dominio della
scuola** (es. tuo-dominio.edu — sostituire con quello vero). Chi ha un
account Google normale (Gmail) o Workspace di un altro dominio deve essere
respinto.

Questo è un progetto di prova, per validare il flusso end-to-end prima di
usarlo sulla intranet vera. Va tenuto minimale.

## Come funziona (architettura)
1. **Frontend**: pagina HTML statica con bottone "Accedi con Google"
   (libreria Google Identity Services, via `<script src="https://accounts.google.com/gsi/client">`).
2. Dopo il login, Google restituisce un **ID token (JWT)** al frontend.
3. Il frontend manda quel token a un **backend** (Cloudflare Worker) che:
   - verifica la firma/validità del token con Google
   - legge il campo `hd` (hosted domain) dal token
   - controlla che `hd === "tuo-dominio-scuola.it"` (da sostituire col
     dominio Workspace reale)
   - se combacia → genera un cookie di sessione firmato e lo restituisce
   - se non combacia → risponde con errore/accesso negato
4. La pagina, per il resto della sessione, controlla la presenza del cookie
   valido per decidere se mostrare "Benvenuto con Google" o il bottone di
   login.

**Importante**: il controllo di `hd` va fatto SEMPRE lato server (nella
Cloudflare Worker), MAI solo in JavaScript nel browser — un controllo
solo client-side si bypassa aprendo la console developer.

## Prerequisiti da preparare PRIMA di iniziare a scrivere codice
1. **Google Cloud Console**: creare un progetto e una **OAuth 2.0 Client ID**
   di tipo "Web application"
   → https://console.cloud.google.com/apis/credentials
   - "Authorized JavaScript origins": l'URL dove sarà ospitata la pagina
     (es. `https://<utente>.github.io`)
   - Annotare il **Client ID** generato (serve nel frontend, NON è segreto,
     può stare nel codice HTML)
2. **Cloudflare account** (gratuito) per ospitare la Worker
   → https://dash.cloudflare.com
3. Sapere con certezza il **dominio Workspace esatto** della scuola (quello
   che comparirà nel campo `hd`, potrebbe non coincidere col dominio delle
   email se ci sono alias — verificarlo direttamente su un account di test).

## Struttura del progetto
```
/
├── index.html              (pagina di test con bottone Google + logica fetch verso il Worker)
└── worker/
    └── index.js            (Cloudflare Worker: verifica token + genera cookie sessione)
```

## index.html — cosa deve contenere
- Script Google Identity Services
- Bottone di login Google con `client_id` = quello ottenuto da Google Cloud
  Console
- Callback JS che, ricevuto il token da Google, fa una `fetch` POST verso
  l'endpoint della Cloudflare Worker (es. `https://tuo-worker.workers.dev/verify`)
  passando il token
- In base alla risposta: se OK, mostra "Benvenuto con Google"; se KO, mostra
  messaggio di accesso negato

## worker/index.js — cosa deve contenere
- Riceve il token Google via POST
- Verifica il token usando le chiavi pubbliche di Google (endpoint
  `https://www.googleapis.com/oauth2/v3/certs`) oppure una libreria di
  verifica JWT compatibile con l'ambiente Workers
- Estrae il campo `hd` dal payload decodificato
- Confronta `hd` con il dominio Workspace della scuola (hardcoded per ora,
  visto che è un test)
- Se combacia: risponde con `Set-Cookie` (cookie httpOnly, scadenza da
  decidere — per il test va bene anche solo la sessione del browser, senza
  persistenza lunga)
- Se non combacia: risponde 403

## Cosa NON serve per questo test
- Nessun database
- Nessuna gestione di più utenti/ruoli diversi — è un check binario:
  dominio giusto sì/no
- Nessuna UI curata: va bene HTML grezzo, l'obiettivo è solo validare che il
  meccanismo di verifica dominio funzioni

## Passi di verifica finale (come capire se ha funzionato)
1. Login con un account del dominio Workspace della scuola → deve comparire
   "Benvenuto con Google"
2. Login con un account Gmail personale (non Workspace) → deve essere
   respinto
3. Se possibile, testare anche con un account Workspace di un dominio
   diverso (es. un altro tenant) → deve essere respinto

## Note per Claude Code
- Progetto di **solo test/validazione**, niente da ottimizzare o rendere
  production-ready per ora.
- Non dovrebbe servire un Client Secret per questo flusso (solo Client ID
  pubblico lato frontend) — verificarlo comunque durante l'implementazione
  e, se dovesse servire, non committarlo mai su GitHub.
- Stile minimale, niente framework, HTML e JS vanilla, coerente con le
  preferenze abituali di Federico (codice leggibile, niente astrazioni
  premature).
- Se qualcosa nel flusso di verifica del token richiede librerie non
  disponibili nativamente in Cloudflare Workers, segnalarlo prima di
  procedere con soluzioni alternative complesse.
