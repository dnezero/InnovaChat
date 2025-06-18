document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. LocalStorage chat sessions and sidebar toggle enabled.");

    // Define your backend URLs for local development and deployment.
    // The script will automatically select the correct URL based on the frontend's hostname.
    const LOCAL_BACKEND_URL = 'http://127.0.0.1:5000';
    // IMPORTANT: REPLACE 'https://innovachatbackend.onrender.com' with YOUR ACTUAL Render backend URL!
    const RENDER_BACKEND_URL = 'https://innovachat.onrender.com'; 

    // Determine the base URL dynamically based on the current hostname.
    const BACKEND_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? LOCAL_BACKEND_URL
        : RENDER_BACKEND_URL;

    console.log(`Using backend URL: ${BACKEND_BASE_URL}`);

    // --- HTML Element References ---
    const sidebar = document.getElementById('sidebar');
    const toggleSidebarOpenButton = document.getElementById('toggle-sidebar-button-open');
    const toggleSidebarCloseButton = document.getElementById('toggle-sidebar-button-close');
    const newChatButton = document.getElementById('new-chat-button');
    const chatList = document.getElementById('chat-list');
    const messagesDisplay = document.getElementById('messages-display');
    const userMessageInput = document.getElementById('user-message-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const chatHeaderTitle = document.getElementById('chat-header-title');
    const typingIndicator = document.querySelector('.typing-indicator');

    // --- Global State Variables ---
    // Array to store chat sessions managed in localStorage
    let chatSessions = [];
    // The UUID of the currently active chat in the frontend (local ID)
    let currentLocalChatId = null; 


    // --- Utility Functions ---

    /**
     * Generates a simple UUID (Universally Unique Identifier) for local chat sessions.
     * This is crucial for uniquely identifying chats in localStorage.
     */
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Formats a date and time into a readable string (e.g., "DD/MM/YYYY HH:MM").
     * @param {string} isoTimestamp - ISO 8601 timestamp (e.g., "2025-06-09T01:30:00.000Z").
     * @returns {string} Formatted date and time.
     */
    function formatTimestamp(isoTimestamp) {
        if (!isoTimestamp) return '';
        const date = new Date(isoTimestamp);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    /**
     * Adds a message bubble to the chat display.
     * Handles Markdown rendering, code block highlighting, and the copy button.
     * @param {string} sender - 'user' or 'bot'.
     * @param {string} content - The raw content of the message (Markdown for bot).
     * @param {string} timestamp - ISO timestamp string.
     */
    function addMessageToDisplay(sender, content, timestamp) {
        if (!messagesDisplay) {
            console.error("messagesDisplay element not found.");
            return;
        }

        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble', sender);

        const messageContent = document.createElement('div'); // Use 'div' to contain parsed Markdown HTML
        if (sender === 'bot') {
            // Convert Markdown content to HTML using marked.js
            messageContent.innerHTML = marked.parse(content);

            // --- Post-processing for code blocks (Highlight.js and Copy button) ---
            const codeBlocks = messageContent.querySelectorAll('pre code');
            codeBlocks.forEach(block => {
                // Determine language from Marked.js's 'language-xxx' class, or default to 'Plain Text'
                const languageClass = Array.from(block.classList).find(cls => cls.startsWith('language-'));
                let language = languageClass ? languageClass.replace('language-', '') : 'Plain Text';
                
                // Capitalize language name for display (e.g., 'python' -> 'Python')
                if (language !== 'Plain Text') {
                    language = language.charAt(0).toUpperCase() + language.slice(1);
                }

                // Create the header div for the code block (language name + copy button)
                const codeHeader = document.createElement('div');
                codeHeader.classList.add('code-header');
                codeHeader.innerHTML = `<span class="code-language">${language}</span>`;

                // Add the "Copy" text button
                const copyButton = document.createElement('button');
                copyButton.classList.add('copy-code-button');
                copyButton.textContent = 'Copy'; // Set button text to "Copy"

                // Add copy functionality to the button
                copyButton.addEventListener('click', () => {
                    const codeToCopy = block.textContent; // Get the raw text content of the code block
                    
                    // Create a temporary textarea to copy text to clipboard
                    const tempTextArea = document.createElement('textarea');
                    tempTextArea.value = codeToCopy;
                    document.body.appendChild(tempTextArea);
                    tempTextArea.select(); // Select the text in the textarea
                    
                    try {
                        // Execute copy command for broader compatibility in iframes
                        document.execCommand('copy');
                        copyButton.textContent = 'Copied!'; // Change button text to "Copied!"
                        setTimeout(() => {
                            copyButton.textContent = 'Copy'; // Revert button text back to "Copy" after 2 seconds
                        }, 2000);
                    } catch (err) {
                        console.error('Failed to copy text: ', err);
                        // Optionally, display a message to the user that copy failed
                    } finally {
                         document.body.removeChild(tempTextArea); // Always remove the temporary textarea
                    }
                });
                codeHeader.appendChild(copyButton); // Add the copy button to the header

                // Insert the new code header before the <pre> tag (which contains the <code> block)
                block.parentNode.insertBefore(codeHeader, block);

                // Apply syntax highlighting to the code block using Highlight.js
                hljs.highlightElement(block);
            });
            // --- End post-processing for code blocks ---

        } else {
            // For user messages, convert newlines to <br> tags for basic formatting
            messageContent.innerHTML = content.replace(/\n/g, '<br>');
        }
        messageBubble.appendChild(messageContent); // Add message content to the bubble

        // Add timestamp to the message bubble
        const messageTimestamp = document.createElement('span');
        messageTimestamp.classList.add('message-timestamp');
        messageTimestamp.textContent = formatTimestamp(timestamp);
        messageBubble.appendChild(messageTimestamp);

        messagesDisplay.appendChild(messageBubble); // Add the complete message bubble to the display area
        messagesDisplay.scrollTop = messagesDisplay.scrollHeight; // Scroll to the latest message
    }


    // --- LocalStorage Chat Management ---

    /**
     * Loads chat sessions from localStorage.
     * @returns {Array} An array of chat session objects.
     */
    function loadChatSessionsFromLocalStorage() {
        const storedChats = localStorage.getItem('innovaChatSessions');
        return storedChats ? JSON.parse(storedChats) : [];
    }

    /**
     * Saves the current chatSessions array to localStorage.
     */
    function saveChatSessionsToLocalStorage() {
        localStorage.setItem('innovaChatSessions', JSON.stringify(chatSessions));
    }

    /**
     * Finds a local chat object by its local UUID.
     * @param {string} localChatId - The UUID of the local chat.
     * @returns {object|undefined} The chat object or undefined if not found.
     */
    function findLocalChatById(localChatId) {
        return chatSessions.find(chat => chat.localId === localChatId);
    }

    /**
     * Gets the backend session ID for a given local chat ID.
     * @param {string} localChatId - The UUID of the local chat.
     * @returns {number|null} The backend session ID or null if not yet assigned/found.
     */
    function getBackendSessionIdForLocalChat(localChatId) {
        const chat = findLocalChatById(localChatId);
        return chat ? chat.backendId : null;
    }

    /**
     * Adds a new chat session to the local storage array.
     * @param {string} localId - The UUID for the local chat.
     * @param {string} title - The title of the chat.
     * @param {number|null} backendId - The backend session ID, if known.
     * @param {Array} messages - Initial messages for the chat.
     */
    function addLocalChat(localId, title, backendId = null, messages = []) {
        chatSessions.push({
            localId: localId,
            backendId: backendId,
            title: title,
            messages: messages,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        saveChatSessionsToLocalStorage();
    }

    /**
     * Updates an existing local chat session.
     * @param {string} localId - The UUID of the local chat to update.
     * @param {object} updates - An object containing properties to update (e.g., { title: 'New Title', messages: [...] }).
     */
    function updateLocalChat(localId, updates) {
        const chatIndex = chatSessions.findIndex(chat => chat.localId === localId);
        if (chatIndex > -1) {
            chatSessions[chatIndex] = { ...chatSessions[chatIndex], ...updates, updatedAt: new Date().toISOString() };
            saveChatSessionsToLocalStorage();
        }
    }

    /**
     * Deletes a chat session from local storage and from the backend.
     * @param {string} localChatId - The UUID of the local chat to delete.
     */
    async function deleteChat(localChatId) {
        const chatToDelete = findLocalChatById(localChatId);
        if (!chatToDelete) {
            console.warn("Attempted to delete non-existent local chat:", localChatId);
            return;
        }

        const confirmDelete = confirm(`Are you sure you want to delete "${chatToDelete.title}"?`);
        if (!confirmDelete) return;

        // If it has a backend ID, try to delete from backend first
        if (chatToDelete.backendId) {
            try {
                // apiRequest will handle errors, no auth needed
                await apiRequest(`/api/chats/${chatToDelete.backendId}`, 'DELETE', null); 
                console.log(`Backend session ${chatToDelete.backendId} deleted.`);
            } catch (error) {
                console.error("Error deleting backend session:", error);
                alert("Failed to delete chat from server. It will only be removed locally.");
            }
        }

        // Remove from local array
        chatSessions = chatSessions.filter(chat => chat.localId !== localChatId);
        saveChatSessionsToLocalStorage();

        // If the deleted chat was the currently active one, start a new chat
        if (currentLocalChatId === localChatId) {
            startNewChat();
        } else {
            // Otherwise, just re-render the list to reflect deletion
            renderChatList();
        }
    }

    // --- UI Rendering ---

    /**
     * Renders the list of chat sessions in the sidebar.
     * Highlights the currently active chat.
     */
    function renderChatList() {
        chatList.innerHTML = ''; // Clear current list

        // Sort chat sessions by updatedAt, most recent first
        chatSessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

        chatSessions.forEach(chat => {
            const listItem = document.createElement('li');
            listItem.classList.add('chat-list-item');
            listItem.dataset.localChatId = chat.localId; // Use localId for UI reference

            // Create container for title and date
            const textContainer = document.createElement('div');
            textContainer.classList.add('chat-item-text'); // Optional: for styling text vs button

            const chatTitleElement = document.createElement('h4');
            chatTitleElement.textContent = chat.title || 'Untitled Chat';

            const chatDateElement = document.createElement('p');
            chatDateElement.textContent = formatTimestamp(chat.updatedAt).split(' ')[0]; // Show only date

            textContainer.appendChild(chatTitleElement);
            textContainer.appendChild(chatDateElement);
            listItem.appendChild(textContainer);

            // Add delete button
            const deleteButton = document.createElement('button');
            deleteButton.classList.add('delete-chat-button');
            deleteButton.innerHTML = '<i class="fas fa-trash-alt"></i>'; // FontAwesome trash icon
            deleteButton.title = `Delete "${chat.title}"`;
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent selecting chat when clicking delete
                deleteChat(chat.localId);
            });
            listItem.appendChild(deleteButton); // Add delete button

            listItem.addEventListener('click', () => selectChat(chat.localId)); // On click, select this chat

            chatList.appendChild(listItem);
        });

        // Highlight the currently active chat in the UI
        if (currentLocalChatId) {
            const activeItem = document.querySelector(`.chat-list-item[data-local-chat-id="${currentLocalChatId}"]`);
            if (activeItem) {
                activeItem.classList.add('active');
                // Ensure the active item is visible if the list is scrollable
                activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    /**
     * Displays messages for the given local chat ID in the messages display area.
     * @param {string} localChatId - The UUID of the local chat.
     */
    function displayMessages(localChatId) {
        messagesDisplay.innerHTML = ''; // Clear current messages
        const chat = findLocalChatById(localChatId);

        if (chat && chat.messages.length > 0) {
            chat.messages.forEach(msg => {
                addMessageToDisplay(msg.sender, msg.content, msg.timestamp);
            });
        } else {
            // Welcome message for a new or empty chat
            addMessageToDisplay('bot', 'Hello! I am InnovaChat. How can I help you?', new Date().toISOString());
        }
        // Always ensure typing indicator is at the bottom after messages
        messagesDisplay.appendChild(typingIndicator); 
        messagesDisplay.scrollTop = messagesDisplay.scrollHeight; // Scroll to bottom
    }

    // --- Sidebar Toggle Logic ---
    function toggleSidebar() {
        sidebar.classList.toggle('active');
    }

    // --- Core Chat Logic ---

    /**
     * Selects a chat session, updates the header, and displays its messages.
     * @param {string} localChatId - The UUID of the local chat to select.
     */
    function selectChat(localChatId) {
        console.log("Selecting chat:", localChatId);
        // Remove 'active' class from all existing chat list items
        document.querySelectorAll('.chat-list-item').forEach(item => {
            item.classList.remove('active');
        });

        // Add 'active' class to the newly selected item
        const selectedItem = document.querySelector(`.chat-list-item[data-local-chat-id="${localChatId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('active');
        }

        currentLocalChatId = localChatId;
        const chat = findLocalChatById(localChatId);
        chatHeaderTitle.textContent = chat ? chat.title : 'New Chat'; // Update header title
        displayMessages(localChatId); // Display messages for the selected chat

        // On mobile, hide sidebar after selecting a chat
        if (window.innerWidth <= 768) {
            sidebar.classList.remove('active');
        }
    }

    /**
     * Initializes a new chat session.
     */
    function startNewChat() {
        const newLocalId = generateUUID();
        // Add a placeholder chat to local storage immediately
        addLocalChat(newLocalId, 'New Chat', null, []); // Title will be updated by AI later
        renderChatList(); // Update sidebar immediately
        selectChat(newLocalId); // Select the new chat
        userMessageInput.focus(); // Focus input for new message
    }

    /**
     * Sends a user message to the backend and handles the bot's response.
     * Updates the current chat session in localStorage.
     */
    async function sendMessage() {
        const messageContent = userMessageInput.value.trim();
        if (!messageContent) {
            return; // Do not send empty messages
        }

        // Get the current chat object or create a new one if this is the very first message
        let currentChat = findLocalChatById(currentLocalChatId);
        if (!currentChat) {
            // This case should ideally be handled by selectChat/startNewChat, but as a fallback
            console.warn("No active chat selected, starting new one before sending message.");
            const newLocalId = generateUUID();
            addLocalChat(newLocalId, 'New Chat', null, []);
            currentChat = findLocalChatById(newLocalId);
            currentLocalChatId = newLocalId;
            renderChatList(); // Re-render to show new chat in sidebar
            selectChat(newLocalId); // Select it
        }

        // Add user message to the local chat object first
        const userMessage = { sender: 'user', content: messageContent, timestamp: new Date().toISOString() };
        currentChat.messages.push(userMessage);
        updateLocalChat(currentLocalChatId, { messages: currentChat.messages }); // Save to localStorage

        // Display user message immediately (already added to local chat and saved)
        addMessageToDisplay('user', messageContent, userMessage.timestamp);
        userMessageInput.value = ''; // Clear input field
        
        // Disable input and show loading indicators
        sendButton.disabled = true;
        userMessageInput.disabled = true;
        stopButton.style.display = 'inline-block'; // Show stop button
        typingIndicator.style.display = 'block'; // Show typing indicator

        try {
            const backendSessionId = getBackendSessionIdForLocalChat(currentLocalChatId);
            const requestData = {
                message: messageContent,
                sessionId: backendSessionId // Send backend ID, which is null if new
            };

            // No authentication token is needed as per the simplified backend
            const response = await apiRequest('/api/chat', 'POST', requestData);
            
            // If the backend returned a new session ID, update the local chat object
            if (response.sessionId && backendSessionId === null) {
                currentChat.backendId = response.sessionId; // Link local chat to backend ID
                // If AI-generated title is returned, update it
                if (response.sessionTitle) {
                    currentChat.title = response.sessionTitle;
                }
                updateLocalChat(currentLocalChatId, { backendId: currentChat.backendId, title: currentChat.title });
                renderChatList(); // Re-render sidebar to update the new chat's title/active status
            }

            // Add bot's response to the local chat object
            const botMessage = { sender: 'bot', content: response.botMessage.content, timestamp: response.botMessage.timestamp };
            currentChat.messages.push(botMessage);
            updateLocalChat(currentLocalChatId, { messages: currentChat.messages }); // Save to localStorage

            // Display the bot's response
            addMessageToDisplay('bot', botMessage.content, botMessage.timestamp);

        } catch (error) {
            console.error("Error sending message:", error);
            // Display an error message directly in the chat interface
            addMessageToDisplay('bot', `Error: ${error.message || 'Could not get response. Please try again.'}`, new Date().toISOString());
        } finally {
            // Re-enable input and hide loading indicators
            sendButton.disabled = false;
            userMessageInput.disabled = false;
            stopButton.style.display = 'none';
            typingIndicator.style.display = 'none';
            userMessageInput.focus(); // Return focus to the input field
        }
    }

    /**
     * Sends a request to the backend API.
     * @param {string} endpoint - The specific API endpoint (e.g., '/api/chat').
     * @param {string} method - The HTTP method ('GET', 'POST', etc.).
     * @param {object} data - Data to send in the request body (only for POST/PUT).
     * @returns {Promise<object>} The JSON response from the API.
     */
    async function apiRequest(endpoint, method = 'GET', data = null) {
        if (typeof BACKEND_BASE_URL === 'undefined' || !BACKEND_BASE_URL) {
            console.error("Error: BACKEND_BASE_URL is not defined or is empty in script.js.");
            throw new Error("Frontend configuration error: Backend URL missing.");
        }

        const url = `${BACKEND_BASE_URL}${endpoint}`; // Construct the full URL

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

        try {
            console.log(`[API Request] Sending: ${method} ${url}`, data || '');
            const response = await fetch(url, options);
            const responseData = await response.json();
            console.log(`[API Response] ${url}: Status ${response.status}`, responseData);

            if (!response.ok) {
                throw new Error(responseData.message || `Server error: ${response.status}`);
            }
            return responseData;
        } catch (error) {
            console.error(`[API Error] Request to ${url} failed:`, error);
            throw error; 
        }
    }

    // --- Event Handling ---

    // Sidebar toggle buttons
    if (toggleSidebarOpenButton) {
        toggleSidebarOpenButton.addEventListener('click', toggleSidebar);
    }
    if (toggleSidebarCloseButton) {
        toggleSidebarCloseButton.addEventListener('click', toggleSidebar);
    }

    // New Chat Button
    if (newChatButton) {
        newChatButton.addEventListener('click', startNewChat);
    }

    // Send message with "Send" button
    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }

    // Send message with Enter key (and Shift+Enter for new line)
    if (userMessageInput) {
        userMessageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Prevent new line
                sendMessage();
            }
        });
    }

    // Handle "Stop" button (UI only)
    if (stopButton) { 
        stopButton.addEventListener('click', () => {
            stopButton.style.display = 'none';
            if (typingIndicator) {
                typingIndicator.style.display = 'none';
            }
            sendButton.disabled = false;
            userMessageInput.disabled = false;
            userMessageInput.focus();
        });
    }

    // Initial load logic:
    // Load existing chat sessions on page load
    chatSessions = loadChatSessionsFromLocalStorage();

    if (chatSessions.length > 0) {
        // If there are existing chats, select the most recent one
        selectChat(chatSessions[0].localId);
    } else {
        // If no chats exist, start a new one (will create a placeholder local chat)
        startNewChat();
    }
    
    // Initial render of the chat list
    renderChatList();
});
