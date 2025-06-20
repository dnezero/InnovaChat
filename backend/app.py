import os
import sqlite3
from datetime import datetime, timezone

from flask import Flask, request, jsonify, g
from flask_cors import CORS # For handling cross-origin requests

import google.generativeai as genai

# Load environment variables from .env file (for local development)
from dotenv import load_dotenv
load_dotenv()

# --- Flask Configuration ---
app = Flask(__name__)

# Configure CORS to allow requests from both local and Render frontend URLs.
# >>> IMPORTANT: YOU MUST REPLACE THE PLACEHOLDER BELOW
# >>> with THE EXACT PUBLIC URL OF YOUR RENDER FRONTEND (STATIC SITE)!!!
# >>> GO TO YOUR RENDER DASHBOARD, CLICK ON YOUR FRONTEND SERVICE, AND COPY ITS "PUBLIC URL".
# >>> Example: If your frontend URL on Render is https://my-frontend-app-xyz.onrender.com,
# >>> then the list should be: ["http://172.0.0.1:8000", "https://innovachatfrontend.onrender.com"]
CORS(app, resources={r"/api/*": {"origins": ["http://127.0.0.1:8000", "https://innovachatfrontend.onrender.com"]}})

# --- Google Gemini API Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    # In a production environment like Render, GEMINI_API_KEY should be set directly
    # as an environment variable in Render's dashboard, not from .env.
    # This error will only trigger if it's missing during local dev or in Render config.
    raise ValueError("Error: GEMINI_API_KEY not found. Ensure it's set in .env (local) or Render environment variables (deployment).")

genai.configure(api_key=GEMINI_API_KEY)

# Define the system instruction for the AI
# This tells the AI its name, creator, and when to reveal this info.
SYSTEM_INSTRUCTION = "Sei InnovaChat, un assistente AI utile. Il tuo creatore è dnezero. Dovresti condividere informazioni sul tuo nome o creatore solo quando esplicitamente richiesto dall'utente."

# Initialize Gemini model for chat responses
try:
    gemini_model = genai.GenerativeModel('gemini-2.5-pro-preview-03-25', system_instruction=SYSTEM_INSTRUCTION)
    print("Gemini chat model initialized: gemini-2.5-pro-preview-03-25 with system instruction.")
except Exception as e:
    print(f"Error initializing gemini-2.5-pro-preview-03-25 chat model: {e}")
    raise ValueError(f"Critical Error: Unable to initialize Gemini chat model. Check model name and API Key. Details: {e}")

# Initialize a separate Gemini model for title generation (can be the same or a different one)
# No system instruction needed for the title model as it's not conversational in the same way.
try:
    gemini_title_model = genai.GenerativeModel('gemini-2.0-flash')
    print("Gemini title model initialized: gemini-2.0-flash")
except Exception as e:
    print(f"Error initializing gemini-2.0-flash title model: {e}")
    # This might not be a critical error if title generation is optional
    print(f"Warning: Unable to initialize Gemini title model. Titles might not be generated by AI. Details: {e}")


# --- SQLite Database Configuration ---
DATABASE = 'chat_app.db'

def get_db():
    """Returns a SQLite database connection."""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row # To access columns by name (e.g., row['content'])
    return db

@app.teardown_appcontext
def close_connection(exception):
    """Closes the database connection at the end of the request context."""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initializes the database by creating the necessary tables."""
    # Corrected typo: 'app.app_app_context()' changed to 'app.app_context()'
    with app.app_context(): # Use app_context() to run outside a request
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
                sender TEXT NOT NULL, -- 'user' or 'bot'
                content TEXT NOT NULL,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES chat_sessions (id)
            )
        ''')
        db.commit()

# Initialize the database on application startup
with app.app_context():
    init_db()

# --- API Routes ---

@app.route('/api/chat', methods=['POST'])
def chat():
    """
    Handles chat messages, manages session creation, and interacts with the Gemini API.
    Also generates an AI-suggested title for new chats.
    """
    data = request.get_json()
    user_message = data.get('message')
    session_id = data.get('sessionId') # null for new session
    # The frontend now sends the current local session ID, not user_id

    if not user_message:
        return jsonify({"message": "Message content cannot be empty."}), 400

    db = get_db()
    cursor = db.cursor()
    new_session_created = False
    chat_title = None # To store AI generated title

    if session_id:
        # Check if the session exists
        session_exists = cursor.execute("SELECT 1 FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
        if not session_exists:
            # If session doesn't exist, treat it as a new session (e.g., DB reset on Render)
            print(f"WARN: Session ID {session_id} not found in DB, treating as new session.")
            new_session_created = True # Force new session creation
            session_id = None # Let DB assign new ID
    
    if not session_id: # If it's explicitly a new session or old one not found
        # Generate a title for the new chat using Gemini based on the first message
        try:
            title_prompt = f"Generate a short (3-8 words) and concise title for a chat conversation starting with: '{user_message}'. The title should be in English. Example: 'Project Discussion', 'Recipe Ideas'."
            title_response = gemini_title_model.generate_content(title_prompt)
            chat_title = title_response.text.strip().replace('"', '') # Remove quotes
            # Basic sanitization for title
            if len(chat_title) > 50:
                chat_title = chat_title[:50] + "..."
            print(f"Generated chat title: {chat_title}")
        except Exception as e:
            print(f"Error generating chat title with AI: {e}")
            chat_title = "New Chat " + datetime.now().strftime("%Y-%m-%d %H:%M") # Fallback title

        # Create a new chat session with the generated title
        cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", (chat_title,))
        db.commit()
        session_id = cursor.lastrowid
        new_session_created = True

    # Save the user's message
    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'user', user_message))
    db.commit()

    # Fetch chat history for context (all messages in the current session)
    history = cursor.execute("SELECT sender, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,)).fetchall()
    
    # Prepare chat history for Gemini
    gemini_history = []
    for msg in history:
        role = 'user' if msg['sender'] == 'user' else 'model'
        gemini_history.append({'role': role, 'parts': [msg['content']]})

    # Generate bot response using Gemini
    try:
        # Start chat with the retrieved history. The SYSTEM_INSTRUCTION is already part of the model's setup.
        chat_session = gemini_model.start_chat(history=gemini_history)
        response = chat_session.send_message(user_message)
        bot_response_content = response.text
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        db.rollback() # Rollback the user message if bot response fails
        return jsonify({"message": "Error generating bot response. Please try again."}), 500

    # Save the bot's message
    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'bot', bot_response_content))
    # Update the session's 'updated_at' timestamp
    cursor.execute("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (session_id,))
    db.commit()
    
    response_data = {
        "botMessage": {
            "sender": "bot",
            "content": bot_response_content,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    }
    if new_session_created:
        response_data['sessionId'] = session_id
        response_data['sessionTitle'] = chat_title # Return the AI-generated title for new sessions
    
    return jsonify(response_data), 200

@app.route('/api/chats', methods=['GET'])
def get_chats():
    """
    Retrieves all chat sessions. No authentication required as local storage manages sessions.
    """
    db = get_db()
    cursor = db.cursor()
    sessions = cursor.execute("SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC").fetchall()
    return jsonify([dict(s) for s in sessions]), 200

@app.route('/api/chats/<int:session_id>', methods=['GET'])
def get_chat_messages(session_id):
    """
    Retrieves messages for a specific chat session.
    """
    db = get_db()
    cursor = db.cursor()

    session = cursor.execute("SELECT id, title FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
    if not session:
        return jsonify({"message": "Chat session not found."}), 404

    messages = cursor.execute("SELECT id, sender, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,)).fetchall()
    return jsonify({
        "id": session['id'],
        "title": session['title'],
        "messages": [dict(m) for m in messages]
    }), 200

# Endpoint to delete a chat session and its messages
@app.route('/api/chats/<int:session_id>', methods=['DELETE'])
def delete_chat_session(session_id):
    db = get_db()
    cursor = db.cursor()
    try:
        # Delete messages associated with the session first
        cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        # Then delete the session itself
        cursor.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))
        db.commit()
        return jsonify({"message": "Chat session deleted successfully."}), 200
    except Exception as e:
        db.rollback()
        print(f"Error deleting chat session {session_id}: {e}")
        return jsonify({"message": "Error deleting chat session."}), 500


# Main entry point for Flask app
if __name__ == '__main__':
    app.run(debug=True, port=5000)
