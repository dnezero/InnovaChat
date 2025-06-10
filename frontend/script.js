document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. Account system removed.");

    // URL of your Flask backend server
    // Ensure your Flask backend is running and accessible at this URL
    const BACKEND_BASE_URL = 'https://innovachat.onrender.com'; 

    // HTML element references - Chat interface
    const messagesDisplay = document.getElementById('messages-display');
    const userMessageInput = document.getElementById('user-message-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const chatHeaderTitle = document.querySelector('.chat-header-title');
    const typingIndicator = document.querySelector('.typing-indicator');
    const chatList = document.getElementById('chat-list');
    const newChatButton = document.getElementById('new-chat-button');

    // Global variable for a single, non-persisted chat session
    // Since there's no account system, chat sessions are not managed on the client-side
    // Each page load is a new "session" for the backend.
    let currentSessionId = null; // Will be set by the backend on the first message

    // --- Local Storage Chat Management ---
    let chats = [];
    let activeChatId = null;

    // Load chats from localStorage
    function loadChats() {
        const saved = localStorage.getItem('innovachat_chats');
        chats = saved ? JSON.parse(saved) : [];
    }

    // Save chats to localStorage
    function saveChats() {
        localStorage.setItem('innovachat_chats', JSON.stringify(chats));
    }

    // Generate a unique ID
    function generateId() {
        return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }

    // Render chat list in sidebar
    function renderChatList() {
        chatList.innerHTML = '';
        chats.forEach(chat => {
            const li = document.createElement('li');
            li.className = 'chat-list-item' + (chat.id === activeChatId ? ' active' : '');
            li.textContent = chat.title || 'New Chat';
            li.onclick = () => switchChat(chat.id);
            chatList.appendChild(li);
        });
    }

    // Switch to a chat by ID
    function switchChat(chatId) {
        activeChatId = chatId;
        renderChatList();
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            messagesDisplay.innerHTML = '';
            chatHeaderTitle.textContent = chat.title || 'InnovaChat';
            chat.messages.forEach(msg =>
                addMessageToDisplay(msg.sender, msg.content, msg.timestamp, msg.id)
            );
        }
    }

    // Create a new chat
    function createNewChat() {
        const id = generateId();
        const newChat = {
            id,
            title: 'New Chat',
            messages: []
        };
        chats.unshift(newChat);
        activeChatId = id;
        saveChats();
        renderChatList();
        switchChat(id);
        // Add welcome message
        addBotMessage('Hello! I am InnovaChat. How can I help you?');
    }

    // Add a message to the current chat and display
    function addMessage(sender, content, timestamp, id) {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;
        const msg = { sender, content, timestamp, id: id || generateId() };
        chat.messages.push(msg);
        saveChats();
        addMessageToDisplay(sender, content, timestamp, msg.id);
    }

    // Add a bot message and trigger title generation if needed
    function addBotMessage(content, timestamp, id) {
        addMessage('bot', content, timestamp || new Date().toISOString(), id);
        const chat = chats.find(c => c.id === activeChatId);
        // If this is the first bot message after a user message, generate a title
        if (chat && chat.title === 'New Chat' && chat.messages.length >= 2) {
            generateChatTitle(chat);
        }
    }

    // Generate a short title using the AI (based on the first user message)
    async function generateChatTitle(chat) {
        const firstUserMsg = chat.messages.find(m => m.sender === 'user');
        if (!firstUserMsg) return;
        try {
            // Ask backend for a short title suggestion
            const response = await apiRequest('/api/title', 'POST', {
                message: firstUserMsg.content
            });
            chat.title = response.title || 'Chat';
            saveChats();
            renderChatList();
            if (chat.id === activeChatId) chatHeaderTitle.textContent = chat.title;
        } catch (e) {
            // fallback: use first 5 words of user message
            chat.title = firstUserMsg.content.split(' ').slice(0, 5).join(' ') + '...';
            saveChats();
            renderChatList();
        }
    }

    // --- Utility Functions ---

    /**
     * Formats a date and time into a readable string (e.g., "DD/MM/YYYY HH:MM").
     * @param {string} isoTimestamp - ISO 8601 timestamp (e.g., "2025-06-09T01:30:00.000Z").
     * @returns {string} Formatted date and time.
     */
    function formatTimestamp(isoTimestamp) {
        if (!isoTimestamp) return '';
        const date = new Date(isoTimestamp);
        // Format date as DD/MM/YYYY
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
        const year = date.getFullYear();
        // Format time as HH:MM
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    /**
     * Adds a message to the chat display.
     * @param {string} sender - 'user' or 'bot'.
     * @param {string} content - The content of the message.
     * @param {string} timestamp - The ISO timestamp of the message.
     * @param {number} messageId - The message ID (optional, from backend).
     */
    function addMessageToDisplay(sender, content, timestamp, messageId = null) {
        if (!messagesDisplay) {
            console.error("messagesDisplay element not found.");
            return;
        }
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', sender);
        if (messageId) {
            messageBubble.dataset.messageId = messageId;
        }

        const messageContent = document.createElement('div'); // Using 'div' for Markdown content
        if (sender === 'bot') {
            // Use marked.js to convert Markdown to HTML for bot messages
            messageContent.innerHTML = marked.parse(content);

            // --- Post-processing for code blocks (Highlight.js and Copy button) ---
            const codeBlocks = messageContent.querySelectorAll('pre code');
            codeBlocks.forEach(block => {
                // Determine language (Marked.js adds 'language-xxx' class to <code>)
                const languageClass = Array.from(block.classList).find(cls => cls.startsWith('language-'));
                let language = languageClass ? languageClass.replace('language-', '') : 'Plain Text';
                
                // Capitalize language for display
                if (language !== 'Plain Text') {
                    language = language.charAt(0).toUpperCase() + language.slice(1);
                }

                // Create the header for the code block
                const codeHeader = document.createElement('div');
                codeHeader.classList.add('code-header');
                codeHeader.innerHTML = `<span class="code-language">${language}</span>`;

                // Add copy button (using GitHub's SVG icons for simplicity)
                const copyButton = document.createElement('button');
                copyButton.classList.add('copy-code-button');
                copyButton.innerHTML = `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-copy">
                    <path d="M0 6.75C0 6.122 0.522 5.617 1.157 5.76L1.5 5.82V2.5A1.5 1.5 0 0 1 3 1h8.5A1.5 1.5 0 0 1 13 2.5v10A1.5 1.5 0 0 1 11.5 14H3.5a1.5 1.5 0 0 1-1.5-1.5V10l-1.5-.18a.5.5 0 0 1-.5-.47V6.75ZM2.5 7v5.75c0 .138.112.25.25.25h8.5c.138 0 .25-.112.25-.25V2.5a.25.25 0 0 0-.25-.25H3a.25.25 0 0 0-.25.25v4.5ZM1.5 8.75a.75.75 0 0 0 .75.75h1.75a.75.75 0 0 0 0-1.5H2.25a.75.75 0 0 0-.75.75ZM6 3.25h-.5a.75.75 0 0 0-.75.75v1.5a.75.75 0 0 0 .75.75H6a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75Z"></path>
                </svg>`;

                // Copy functionality
                copyButton.addEventListener('click', () => {
                    const codeToCopy = block.textContent;
                    const tempTextArea = document.createElement('textarea');
                    tempTextArea.value = codeToCopy;
                    document.body.appendChild(tempTextArea);
                    tempTextArea.select();
                    try {
                        document.execCommand('copy'); // Using document.execCommand for iFrame compatibility
                        // Change icon to checkmark
                        copyButton.innerHTML = `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-check">
                            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
                        </svg>`;
                        setTimeout(() => {
                            // Revert to copy icon after 2 seconds
                            copyButton.innerHTML = `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-copy">
                                <path d="M0 6.75C0 6.122 0.522 5.617 1.157 5.76L1.5 5.82V2.5A1.5 1.5 0 0 1 3 1h8.5A1.5 1.5 0 0 1 13 2.5v10A1.5 1.5 0 0 1 11.5 14H3.5a1.5 1.5 0 0 1-1.5-1.5V10l-1.5-.18a.5.5 0 0 1-.5-.47V6.75ZM2.5 7v5.75c0 .138.112.25.25.25h8.5c.138 0 .25-.112.25-.25V2.5a.25.25 0 0 0-.25-.25H3a.25.25 0 0 0-.25.25v4.5ZM1.5 8.75a.75.75 0 0 0 .75.75h1.75a.75.75 0 0 0 0-1.5H2.25a.75.75 0 0 0-.75.75ZM6 3.25h-.5a.75.75 0 0 0-.75.75v1.5a.75.75 0 0 0 .75.75H6a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75Z"></path>
                            </svg>`;
                        }, 2000);
                    } catch (err) {
                        console.error('Failed to copy text: ', err);
                    } finally {
                         document.body.removeChild(tempTextArea);
                    }
                });
                codeHeader.appendChild(copyButton);

                // Insert header before the <pre> tag
                block.parentNode.insertBefore(codeHeader, block);

                // Apply syntax highlighting
                hljs.highlightElement(block);
            });
            // --- End post-processing for code blocks ---

        } else {
            // For user messages, simple text with newlines converted to <br>
            messageContent.innerHTML = content.replace(/\n/g, '<br>');
        }
        messageBubble.appendChild(messageContent);

        const messageTimestamp = document.createElement('span');
        messageTimestamp.classList.add('message-timestamp');
        messageTimestamp.textContent = formatTimestamp(timestamp);
        messageBubble.appendChild(messageTimestamp);

        messagesDisplay.appendChild(messageBubble);
        messagesDisplay.scrollTop = messagesDisplay.scrollHeight; // Scroll to the latest message
    }

    /**
     * Initializes the chat display with a welcome message for a new session.
     */
    function initializeNewChatDisplay() {
        messagesDisplay.innerHTML = ''; // Clear existing messages
        chatHeaderTitle.textContent = 'InnovaChat'; // Reset header title
        typingIndicator.style.display = 'none'; // Ensure indicator is hidden
        addMessageToDisplay('bot', 'Hello! I am InnovaChat. How can I help you?', new Date().toISOString());
        currentSessionId = null; // Ensure no old session ID is carried over
    }

    // --- Override sendMessage to use chat system ---
    /**
     * Sends a message to the Gemini model and updates the chat.
     */
    async function sendMessage() {
        const messageContent = userMessageInput.value.trim();
        if (!messageContent) return;
        addMessage('user', messageContent, new Date().toISOString());
        userMessageInput.value = '';
        sendButton.disabled = true;
        userMessageInput.disabled = true;
        stopButton.style.display = 'inline-block';
        typingIndicator.style.display = 'block';

        try {
            const response = await apiRequest('/api/chat', 'POST', {
                message: messageContent,
                sessionId: null // Not used with local chat
            });
            addBotMessage(response.botMessage.content, response.botMessage.timestamp, response.botMessage.id);
        } catch (error) {
            addBotMessage(`Error: ${error.message || 'Could not get response. Please try again.'}`);
        } finally {
            sendButton.disabled = false;
            userMessageInput.disabled = false;
            stopButton.style.display = 'none';
            typingIndicator.style.display = 'none';
            userMessageInput.focus();
        }
    }

    /**
     * Sends a request to the backend API.
     * Removed authentication headers as there's no account system.
     * @param {string} endpoint - The specific API endpoint (e.g., '/api/chat').
     * @param {string} method - The HTTP method ('GET', 'POST', etc.).
     * @param {object} data - Data to send in the request body (only for POST/PUT).
     * @returns {Promise<object>} The JSON response from the API.
     */
    async function apiRequest(endpoint, method = 'GET', data = null) {
        if (typeof BACKEND_BASE_URL === 'undefined') {
            throw new Error('Backend URL is not defined.');
        }

        const url = `${BACKEND_BASE_URL}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
        };

        const options = {
            method: method,
            headers: headers,
        };

        if (data) {
            options.body = JSON.stringify(data);
        }

        const response = await fetch(url, options);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'API request failed');
        }
        return await response.json();
    }

    // --- Initialization ---

    // Load chats and set up UI on page load
    loadChats();
    if (chats.length === 0) {
        createNewChat();
    } else {
        // Set active chat to the most recent
        activeChatId = chats[0].id;
        renderChatList();
        switchChat(activeChatId);
    }

    // --- Event Listeners ---

    // New Chat button
    if (newChatButton) {
        newChatButton.addEventListener('click', () => {
            createNewChat();
        });
    }

    // Send button
    if (sendButton) {
        sendButton.addEventListener('click', () => {
            sendMessage();
        });
    }

    // Enter key in input
    if (userMessageInput) {
        userMessageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Optionally, handle stopButton if you implement streaming/cancel

    // Add any other functions or event listeners here if needed
});
