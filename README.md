# Varga Ride

Prima versione della PWA pubblica per enduro, sterrato, moto su strada e circuiti motocross.

## Funzioni già incluse

- mappa mobile con modalità stradale e topografica;
- generatore di percorsi motociclistici con profilo strada/adventure;
- navigazione interna turn-by-turn con voce, GPS, fuori-percorso e ricalcolo;
- registrazione GPS libera con statistiche e cronologia;
- community dimostrativa, preferiti, pubblicazione predisposta;
- profilo rider e salvataggio locale;
- shell PWA offline e installazione su telefono;
- funzione Netlify che protegge e inoltra le richieste a Valhalla.

## Avvio locale

```bash
npm install
npm run serve
```

Aprire `http://localhost:4173`. Il browser richiede un contesto sicuro per il GPS; `localhost` è consentito.

## Pubblicazione Netlify

Collegare la cartella a un repository GitHub e importarla in Netlify. La configurazione usa Node.js 22 e pubblica la directory principale. La variabile opzionale `VALHALLA_URL` permette di indicare un server Valhalla dedicato.

## Passaggi necessari prima della pubblicazione pubblica

1. Collegare Firebase Authentication, Firestore e Storage per account e community reali.
2. Attivare moderazione, segnalazione contenuti e regole Firestore.
3. Usare un servizio Valhalla dedicato con quote e monitoraggio; il server pubblico è adatto solo allo sviluppo.
4. Integrare il servizio GPS nativo in background nei wrapper Android/iOS.
5. Aggiungere termini, privacy, consenso alla posizione e flusso per cancellare l’account.

La disponibilità di una traccia nei dati OpenStreetMap non garantisce il diritto di transito. L’app deve mostrare sempre gli accessi conosciuti, la data di verifica e le segnalazioni locali.
