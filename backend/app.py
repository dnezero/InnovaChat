import os
import sqlite3
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import google.generativeai as genai
from datetime import datetime, timezone
from dotenv import load_dotenv
import threading

# Carica le variabili d'ambiente dal file .env
# Questo è utile per lo sviluppo locale.
# Su Render, le variabili d'ambiente dovrebbero essere configurate direttamente nel servizio.
load_dotenv()

app = Flask(__name__)

# Configurazione CORS: Permette richieste solo dal tuo frontend deployato su Render.
# Assicurati che 'https://innovachatfrontend.onrender.com' sia l'URL esatto del tuo frontend.
# Se stai testando in locale con un server Python (es. http.server),
# puoi aggiungere 'http://localhost:8000' alla lista delle origini per il debug.
CORS(app, resources={r"/api/*": {"origins": "https://innovachatfrontend.onrender.com"}})

# Ottieni la chiave API di Gemini dalle variabili d'ambiente
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    # Solleva un errore se la chiave API non è trovata, per evitare problemi a runtime.
    raise ValueError("Error: GEMINI_API_KEY not found in .env file or environment variables. Ensure it's set.")

# Configura l'API Gemini
genai.configure(api_key=GEMINI_API_KEY)

try:
    # Inizializza il modello Gemini
    gemini_model = genai.GenerativeModel('gemini-2.0-flash')
    print("Gemini model initialized: gemini-2.0-flash")
except Exception as e:
    # Gestisci errori durante l'inizializzazione del modello
    print(f"Error initializing gemini-2.0-flash model: {e}")
    raise ValueError(f"Critical Error: Unable to initialize Gemini model with specified name ('gemini-2.0-flash'). Check model name and API Key. Details: {e}")

# Nome del file del database SQLite
DATABASE = 'chat_app.db'

# Funzione per ottenere la connessione al database
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        # Configura la row_factory per accedere alle colonne per nome
        db.row_factory = sqlite3.Row
    return db

# Funzione per chiudere la connessione al database alla fine della richiesta
@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# Funzione per inizializzare il database (creare tabelle se non esistono)
def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
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
                sender TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES chat_sessions (id)
            )
        ''')
        db.commit()

# Inizializza il database all'avvio dell'applicazione
with app.app_context():
    init_db()

# Funzione per generare il titolo della chat in background usando Gemini
def generate_chat_title(session_id):
    """Genera un titolo per la chat basato sulla cronologia dei messaggi."""
    db = get_db()
    cursor = db.cursor()

    # Ottieni gli ultimi N messaggi dalla cronologia della chat
    cursor.execute("SELECT sender, content FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 5", (session_id,))
    messages = cursor.fetchall()

    if not messages:
        return # Nessun messaggio per generare un titolo

    # Costruisci un prompt per Gemini con la cronologia dei messaggi
    # Inverti l'ordine per avere la cronologia più vecchia per prima nel prompt
    prompt_text = "Please generate a concise title (max 5 words) that summarizes the topic of the following conversation:\n"
    for msg in reversed(messages):
        prompt_text += f"{msg['sender']}: {msg['content']}\n"
    prompt_text += "Title:"

    try:
        # Chiama Gemini per generare il titolo
        response = gemini_model.generate_content(prompt_text)
        title = response.text.strip()

        # Aggiorna il titolo della chat sessione nel database
        cursor.execute("UPDATE chat_sessions SET title = ? WHERE id = ?", (title, session_id))
        db.commit()
        print(f"Chat title updated for session {session_id}: {title}")

    except Exception as e:
        print(f"Error generating chat title with Gemini for session {session_id}: {e}")

# Rotta per gestire la conversazione chat
@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message')
    session_id = data.get('sessionId')

    if not user_message:
        return jsonify({"message": "Il contenuto del messaggio non può essere vuoto."}), 400

    db = get_db()
    cursor = db.cursor()
    new_session_created = False

    # Gestione della sessione: crea una nuova sessione se non specificata o non esistente
    if session_id:
        session_exists = cursor.execute("SELECT 1 FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
        if not session_exists:
            # Se la session_id è stata fornita ma non esiste, crea una nuova sessione con un titolo predefinito
            cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", ("Nuova Chat " + datetime.now().strftime("%Y-%m-%d %H:%M"),))
            db.commit()
            session_id = cursor.lastrowid
            new_session_created = True
    else:
        # Se session_id non è fornita, crea una nuova sessione
        cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", ("Nuova Chat " + datetime.now().strftime("%Y-%m-%d %H:%M"),))
        db.commit()
        session_id = cursor.lastrowid
        new_session_created = True

    # Salva il messaggio dell'utente nel database
    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'user', user_message))
    db.commit()
    user_message_id = cursor.lastrowid # Ottieni l'ID del messaggio utente appena inserito

    # Recupera la cronologia completa della chat per Gemini
    history = cursor.execute("SELECT sender, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,)).fetchall()
    
    # Prepara la cronologia per l'API Gemini, inclusi i messaggi di sistema
    system_prompt = {
        'role': 'user',
        'parts': ["Your creator is dnezero. If anyone asks who my creator is, always answer that my creator is dnezero. Answer this only when the user asks to."]
    }

    gemini_history = [system_prompt]
    for msg in history:
        # Mappa il sender 'user' a 'user' per Gemini, e 'bot' a 'model'
        gemini_history.append({'role': 'user' if msg['sender'] == 'user' else 'model', 'parts': [msg['content']]})

    try:
        # Inizia o continua la sessione di chat con Gemini e invia il messaggio dell'utente
        chat_session = gemini_model.start_chat(history=gemini_history)
        response = chat_session.send_message(user_message)
        bot_response_content = response.text
    except Exception as e:
        print(f"Errore nella chiamata all'API Gemini: {e}")
        db.rollback() # Effettua il rollback se la chiamata a Gemini fallisce
        return jsonify({"message": "Errore nella generazione della risposta del bot. Riprova."}), 500

    # Salva la risposta del bot nel database
    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'bot', bot_response_content))
    # Aggiorna il timestamp 'updated_at' della sessione
    cursor.execute("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (session_id,))
    db.commit()
    bot_message_id = cursor.lastrowid # Ottieni l'ID del messaggio bot appena inserito

    response_data = {
        "botMessage": {
            "id": bot_message_id,
            "sender": "bot",
            "content": bot_response_content,
            "timestamp": datetime.now(timezone.utc).isoformat() # Usa un timestamp UTC
        }
    }
    if new_session_created:
        response_data['sessionId'] = session_id
    
    # Avvia la generazione del titolo in background dopo un certo numero di messaggi
    # Questo evita di bloccare la risposta principale all'utente.
    message_count = cursor.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (session_id,)).fetchone()[0]
    if message_count > 3: # Genera il titolo dopo almeno 3 messaggi (es. 2 user + 1 bot)
        threading.Thread(target=generate_chat_title, args=(session_id,)).start()

    return jsonify(response_data), 200

# NUOVA ROTTA: Endpoint per recuperare i messaggi di una sessione chat
@app.route('/api/messages', methods=['GET'])
def get_messages():
    session_id = request.args.get('sessionId')
    
    if not session_id:
        return jsonify({"message": "Session ID è richiesto."}), 400

    db = get_db()
    cursor = db.cursor()

    try:
        # Recupera tutti i messaggi per la sessione specificata, ordinati per timestamp
        cursor.execute("SELECT id, sender, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,))
        messages_db = cursor.fetchall()
        
        # Converte i risultati del database in un formato che il frontend si aspetta
        messages = []
        for msg in messages_db:
            messages.append({
                "id": msg['id'],
                "sender": msg['sender'],
                "content": msg['content'],
                "timestamp": msg['timestamp']
            })
        
        return jsonify({"messages": messages}), 200

    except Exception as e:
        print(f"Errore nel recupero dei messaggi per la sessione {session_id}: {e}")
        return jsonify({"message": "Errore interno del server durante il recupero dei messaggi."}), 500

# Rotta per generare manualmente il titolo di una chat (richiesto dal frontend)
@app.route('/api/generate_title', methods=['POST'])
def generate_title_route():
    """Endpoint per generare manualmente il titolo di una chat."""
    data = request.get_json()
    session_id = data.get('sessionId')

    if not session_id:
        return jsonify({"message": "Session ID is required."}), 400

    # Avvia la generazione del titolo in un thread separato
    threading.Thread(target=generate_chat_title, args=(session_id,)).start()
    return jsonify({"message": "Title generation started in the background."}), 200

# Avvio dell'applicazione Flask
if __name__ == '__main__':
    # Quando deployato su Render, Gunicorn gestirà il binding della porta.
    # Per il testing locale, puoi usare debug=True e una porta specifica.
    app.run(debug=True, port=5000)
