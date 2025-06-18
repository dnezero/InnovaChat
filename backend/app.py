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
# IMPORTANT: REPLACE 'https://innovachatfrontend.onrender.com' with YOUR ACTUAL Render frontend URL!
CORS(app, resources={r"/api/*": {"origins": ["http://127.0.0.1:8000", "https://innovachatfrontend.onrender.com"]}})

# --- Google Gemini API Configuration ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    # In a production environment like Render, GEMINI_API_KEY should be set directly
    # as an environment variable in Render's dashboard, not from .env.
    # This error will only trigger if it's missing during local dev or in Render config.
    raise ValueError("Error: GEMINI_API_KEY not found. Ensure it's set in .env (local) or Render environment variables (deployment).")

genai.configure(api_key=GEMINI_API_KEY)

# Initialize Gemini model
try:
    gemini_model = genai.GenerativeModel('gemini-2.0-flash')
    print("Gemini model initialized: gemini-2.0-flash")
except Exception as e:
    print(f"Error initializing gemini-2.0-flash model: {e}")
    # Raise a critical error if model initialization fails
    raise ValueError(f"Critical Error: Unable to initialize Gemini model. Check model name and API Key. Details: {e}")


# --- SQLite Database Configuration ---
# Note: SQLite on Render's free tier is ephemeral. Data will be lost on
# each deployment or after periods of inactivity. For persistent data,
# consider a managed database service like PostgreSQL offered by Render.
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
        # The 'users' table and 'user_id' in chat_sessions are removed
        # as there is no account system.
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
    Does not require authentication.
    """
    data = request.get_json()
    user_message = data.get('message')
    session_id = data.get('sessionId') # Will be null for the first message of a new page load

    if not user_message:
        return jsonify({"message": "Message content cannot be empty."}), 400

    db = get_db()
    cursor = db.cursor()
    new_session_created = False

    if session_id:
        # Check if the session exists (important if the DB was reset on Render)
        session_exists = cursor.execute("SELECT 1 FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
        if not session_exists:
            # If session doesn't exist (e.g., DB reset), create a new one
            print(f"WARN: Session ID {session_id} not found in DB, creating new session.")
            cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", ("New Chat " + datetime.now().strftime("%Y-%m-%d %H:%M"),))
            db.commit()
            session_id = cursor.lastrowid
            new_session_created = True
    else:
        # Create a brand new chat session if no ID was provided
        cursor.execute("INSERT INTO chat_sessions (title) VALUES (?)", ("New Chat " + datetime.now().strftime("%Y-%m-%d %H:%M"),))
        db.commit()
        session_id = cursor.lastrowid
        new_session_created = True

    # Save the user's message
    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'user', user_message))
    db.commit()
    user_message_id = cursor.lastrowid # Get the ID of the newly inserted user message

    # Fetch chat history for context (all messages in the current session)
    history = cursor.execute("SELECT sender, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC", (session_id,)).fetchall()
    
    # Prepare chat history for Gemini in the expected format:
    # [{'role': 'user', 'parts': ['User query']}, {'role': 'model', 'parts': ['Model response']}, ...]
    gemini_history = []
    for msg in history:
        # Map our 'sender' (user/bot) to Gemini's 'role' (user/model)
        role = 'user' if msg['sender'] == 'user' else 'model'
        gemini_history.append({'role': role, 'parts': [msg['content']]})

    # Generate bot response using Gemini
    try:
        # Start a chat session with the model and provide the prepared history
        chat_session = gemini_model.start_chat(history=gemini_history)
        response = chat_session.send_message(user_message) # Send the latest user message
        bot_response_content = response.text
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        db.rollback() # Rollback the user message if bot response fails (optional but good for consistency)
        return jsonify({"message": "Error generating bot response. Please try again."}), 500

    # Save the bot's message
    cursor.execute("INSERT INTO messages (session_id, sender, content) VALUES (?, ?, ?)", (session_id, 'bot', bot_response_content))
    # Update the session's 'updated_at' timestamp
    cursor.execute("UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (session_id,))
    db.commit()
    bot_message_id = cursor.lastrowid # Get the ID of the newly inserted bot message

    response_data = {
        "botMessage": {
            "id": bot_message_id,
            "sender": "bot",
            "content": bot_response_content,
            "timestamp": datetime.now(timezone.utc).isoformat() # Use UTC for consistency
        }
    }
    # Only include sessionId in the response if a new session was actually created
    if new_session_created:
        response_data['sessionId'] = session_id
    
    return jsonify(response_data), 200

# Main entry point for Flask app
if __name__ == '__main__':
    # This block is for local development only.
    # When deploying to Render, a WSGI server like Gunicorn will manage app execution.
    app.run(debug=True, port=5000)
