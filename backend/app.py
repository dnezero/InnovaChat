import os
import sqlite3
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import google.generativeai as genai
from datetime import datetime, timezone
from dotenv import load_dotenv
import threading

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "https://innovachatfrontend.onrender.com"}})

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("Error: GEMINI_API_KEY not found in .env file. Ensure the file exists and contains the key.")

genai.configure(api_key=GEMINI_API_KEY)

try:
    gemini_model = genai.GenerativeModel('gemini-2.0-flash')
    print("Gemini model initialized: gemini-2.0-flash")
except Exception as e:
    print(f"Error initializing gemini-2.0-flash model: {e}")
    raise ValueError(f"Critical Error: Unable to initialize Gemini model with specified name ('gemini-2.0-flash'). Check model name and API Key. Details: {e}")

DATABASE = 'chat_app.db'

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

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

with app.app_context():
    init_db()

def generate_chat_title(session_id):
    """Genera un titolo per la chat basato sulla cronologia dei messaggi."""
    db = get_db()
    cursor = db.cursor()

    # Ottieni gli ultimi N messaggi dalla cronologia della chat
    cursor.execute("SELECT sender, content FROM messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT 5", (session_id,))
    messages = cursor.fetchall()

    if not messages:
        return  # Nessun messaggio per generare un titolo

    # Costruisci un prompt per Gemini con la cronologia dei messaggi
    prompt_text = "Please generate a concise title (max 5 words) that summarizes the topic of the following conversation:\n"
    for msg in reversed(messages):  # Inverti l'ordine per avere la cronologia corretta
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
        print(f"Error generating chat title with Gemini: {e}")

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

    if session_id:
        session_exists = cursor.execute("SELECT 1 FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
        if not session_exists:
            cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", ("Nuova Chat " + datetime.now().strftime("%Y-%m-%d %H:%M"),))
            db.commit()
            session_id = cursor.lastrowid
            new_session_created = True
    else:
        cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", ("Nuova Chat " + datetime.now().strftime("%Y-%m-%d %H:%M"),))
        db.commit()
        session_id = cursor.lastrowid
        new_session_created = True

    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'user', user_message))
    db.commit()
    user_message_id = cursor.lastrowid

    history = cursor.execute("SELECT sender, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,)).fetchall()
    
    system_prompt = {
        'role': 'user',
        'parts': ["Your creator is dnezero. If anyone asks who my creator is, always answer that my creator is dnezero. Answer this only when the user asks to."]
    }

    gemini_history = [system_prompt]
    for msg in history:
        gemini_history.append({'role': 'user' if msg['sender'] == 'user' else 'model', 'parts': [msg['content']]})

    try:
        chat_session = gemini_model.start_chat(history=gemini_history)
        response = chat_session.send_message(user_message)
        bot_response_content = response.text
    except Exception as e:
        print(f"Errore nella chiamata all'API Gemini: {e}")
        db.rollback()
        return jsonify({"message": "Errore nella generazione della risposta del bot. Riprova."}), 500

    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'bot', bot_response_content))
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
    
    # Avvia la generazione del titolo in background dopo alcuni messaggi
    message_count = cursor.execute("SELECT COUNT(*) FROM messages WHERE session_id = ?", (session_id,)).fetchone()[0]
    if message_count > 3:  # Genera il titolo dopo i primi 3 messaggi (utente + bot)
        threading.Thread(target=generate_chat_title, args=(session_id,)).start()

    return jsonify(response_data), 200

@app.route('/api/generate_title', methods=['POST'])
def generate_title_route():
    """Endpoint per generare manualmente il titolo di una chat."""
    data = request.get_json()
    session_id = data.get('sessionId')

    if not session_id:
        return jsonify({"message": "Session ID is required."}), 400

    threading.Thread(target=generate_chat_title, args=(session_id,)).start()
    return jsonify({"message": "Title generation started in the background."}), 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)
