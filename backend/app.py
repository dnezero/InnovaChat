import os
import sqlite3
# Non più necessario jwt, datetime, timezone, functools per l'autenticazione
# from datetime import datetime, timedelta, timezone
# from functools import wraps

from flask import Flask, request, jsonify, g
from flask_cors import CORS # Per gestire le richieste da domini diversi
import google.generativeai as genai
from datetime import datetime, timezone # Solo per timestamp e gestione sessioni

# Carica le variabili d'ambiente dal file .env
from dotenv import load_dotenv
load_dotenv()

# --- Configurazione Flask ---
app = Flask(__name__)

# Configurazione CORS
# In produzione, dovresti specificare l'URL esatto del tuo frontend su Render.
# Ad esempio: CORS(app, resources={r"/api/*": {"origins": "https://il-tuo-frontend.onrender.com"}})
# Per ora, permettiamo qualsiasi origine per facilità di sviluppo, ma in produzione non è sicuro.
# AGGIORNA questa riga con l'URL ESATTO del tuo frontend su Render
# Esempio: CORS(app, resources={r"/api/*": {"origins": "https://innova-chat-frontend.onrender.com"}})
CORS(app, resources={r"/api/*": {"origins": "https://InnovaChatFrontEnd.onrender.com/"}})

# Se vuoi continuare a testare anche localmente, puoi mettere un elenco:
# CORS(app, resources={r"/api/*": {"origins": ["TUO_URL_FRONTEND_DI_RENDER", "http://127.0.0.1:8000"]}})

# La chiave API di Gemini. Assicurati che sia configurata nelle variabili d'ambiente di Render.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("Error: GEMINI_API_KEY not found in .env file. Ensure the file exists and contains the key.")

genai.configure(api_key=GEMINI_API_KEY)

# Inizializza il modello Gemini
try:
    gemini_model = genai.GenerativeModel('gemini-2.0-flash')
    print("Gemini model initialized: gemini-2.0-flash")
except Exception as e:
    print(f"Error initializing gemini-2.0-flash model: {e}")
    raise ValueError(f"Critical Error: Unable to initialize Gemini model with specified name ('gemini-2.0-flash'). Check model name and API Key. Details: {e}")


# --- Configurazione Database SQLite ---
# Nota: SQLite su Render nel livello gratuito è effimero. I dati andranno persi
# ad ogni deployment o dopo un periodo di inattività. Per dati persistenti,
# considera un database come PostgreSQL offerto da Render.
DATABASE = 'chat_app.db'

def get_db():
    """Restituisce una connessione al database SQLite."""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row # Per accedere alle colonne per nome
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Inizializza il database creando le tabelle necessarie."""
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        # La tabella 'users' non è più necessaria
        # La tabella 'chat_sessions' ora non ha un riferimento a user_id
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                sender TEXT NOT NULL, -- 'user' o 'bot'
                content TEXT NOT NULL,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES chat_sessions (id)
            )
        ''')
        db.commit()

# Inizializza il database all'avvio dell'applicazione
with app.app_context():
    init_db()

# --- Route API ---

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message')
    session_id = data.get('sessionId') # null per una nuova sessione

    if not user_message:
        return jsonify({"message": "Il contenuto del messaggio non può essere vuoto."}), 400

    db = get_db()
    cursor = db.cursor()
    new_session_created = False

    if session_id:
        # Verifica se la sessione esiste (per la persistenza all'interno della stessa "sessione" del browser)
        session_exists = cursor.execute("SELECT 1 FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
        if not session_exists:
            # Se la sessione non esiste (es. DB resettato), crea una nuova sessione
            print(f"WARN: Session ID {session_id} not found in DB, creating new session.")
            cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", ("Nuova Chat " + datetime.now().strftime("%Y-%m-%d %H:%M"),))
            db.commit()
            session_id = cursor.lastrowid
            new_session_created = True
    else:
        # Crea una nuova sessione di chat
        cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", ("Nuova Chat " + datetime.now().strftime("%Y-%m-%d %H:%M"),))
        db.commit()
        session_id = cursor.lastrowid
        new_session_created = True

    # Salva il messaggio dell'utente
    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'user', user_message))
    db.commit()
    user_message_id = cursor.lastrowid

    # Ottieni la cronologia della chat per il contesto (tutti i messaggi nella sessione corrente)
    history = cursor.execute("SELECT sender, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,)).fetchall()
    
    # Prepara la cronologia della chat per Gemini
    gemini_history = []
    for msg in history:
        gemini_history.append({'role': 'user' if msg['sender'] == 'user' else 'model', 'parts': [msg['content']]})

    # Genera la risposta del bot usando Gemini
    try:
        chat_session = gemini_model.start_chat(history=gemini_history)
        response = chat_session.send_message(user_message)
        bot_response_content = response.text
    except Exception as e:
        print(f"Errore nella chiamata all'API Gemini: {e}")
        db.rollback() # Annulla il messaggio dell'utente se la risposta del bot fallisce
        return jsonify({"message": "Errore nella generazione della risposta del bot. Riprova."}), 500

    # Salva il messaggio del bot
    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'bot', bot_response_content))
    # Aggiorna il timestamp 'updated_at' della sessione
    cursor.execute("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (session_id,))
    db.commit()
    bot_message_id = cursor.lastrowid

    response_data = {
        "botMessage": {
            "id": bot_message_id,
            "sender": "bot",
            "content": bot_response_content,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    }
    if new_session_created:
        response_data['sessionId'] = session_id
    
    return jsonify(response_data), 200

# Punto di ingresso principale per l'app Flask quando eseguita con Gunicorn su Render
# Rimuovi app.run(debug=True) per la produzione
if __name__ == '__main__':
    # Questo blocco viene solitamente rimosso o modificato per i deployment di produzione
    # dove un server WSGI come Gunicorn gestisce l'esecuzione dell'app.
    # Per il testing locale diretto:
    app.run(debug=True, port=5000)
