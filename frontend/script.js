document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. Account system removed.");

    // Define your backend URLs for local development and deployment.
    // The script will automatically select the correct URL based on the frontend's hostname.
    const LOCAL_BACKEND_URL = 'http://127.0.0.1:5000';
    // IMPORTANT: REPLACE 'https://innovachat.onrender.com' with YOUR ACTUAL Render backend URL!
    const RENDER_BACKEND_URL = 'https://innovachat.onrender.com';

    // Determine the base URL dynamically based on the current hostname.
    const BACKEND_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? LOCAL_BACKEND_URL
        : RENDER_BACKEND_URL;

    console.log(`Using backend URL: ${BACKEND_BASE_URL}`);

    // HTML element references for the chat interface
    const messagesDisplay = document.getElementById('messages-display');
    const userMessageInput = document.getElementById('user-message-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button');
    const chatHeaderTitle = document.querySelector('.chat-header-title');
    const typingIndicator = document.querySelector('.typing-indicator');

    // Global variable for a single, non-persisted chat session.
    // Each page load is considered a new "session" for the backend in this simplified setup.
    let currentSessionId = null; // Will be set by the backend on the first message


    // --- Utility Functions ---

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

    /**
     * Initializes the chat display with a welcome message for a new session.
     * This is called on every page load since there's no account system.
     */
    function initializeNewChatDisplay() {
        messagesDisplay.innerHTML = ''; // Clear any existing messages
        chatHeaderTitle.textContent = 'InnovaChat'; // Ensure header title is reset
        typingIndicator.style.display = 'none'; // Ensure typing indicator is hidden
        addMessageToDisplay('bot', 'Hello! I am InnovaChat. How can I help you?', new Date().toISOString());
        currentSessionId = null; // Ensure no old session ID is carried over from previous page loads
    }

    /**
     * Sends a user message to the backend and handles the bot's response.
     */
    async function sendMessage() {
        const messageContent = userMessageInput.value.trim();
        if (!messageContent) {
            return; // Do not send empty messages
        }

        // Display user message immediately
        addMessageToDisplay('user', messageContent, new Date().toISOString());
        userMessageInput.value = ''; // Clear input field
        
        // Disable input and show loading indicators
        sendButton.disabled = true;
        userMessageInput.disabled = true;
        stopButton.style.display = 'inline-block'; // Show stop button
        typingIndicator.style.display = 'block'; // Show typing indicator

        try {
            const requestData = {
                message: messageContent,
                sessionId: currentSessionId // Will be null for the first message of a new page load
            };

            // Send message to the backend API. No authentication token is needed.
            const response = await apiRequest('/api/chat', 'POST', requestData);
            
            // If the backend returned a new session ID (for the first message sent), save it
            if (response.sessionId && currentSessionId === null) {
                currentSessionId = response.sessionId;
                console.log(`New session created by backend with ID: ${currentSessionId}`);
            }

            // Display the bot's response
            addMessageToDisplay('bot', response.botMessage.content, response.botMessage.timestamp, response.botMessage.id);

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
     * No authentication headers are included as there's no account system.
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
                // Generic server error handling for non-2xx responses
                throw new Error(responseData.message || `Server error: ${response.status}`);
            }
            return responseData;
        } catch (error) {
            console.error(`[API Error] Request to ${url} failed:`, error);
            // Re-throw the error so the calling function (sendMessage) can catch and display it
            throw error; 
        }
    }

    // --- Event Handling ---

    // Event listener for the "Send" button click
    sendButton.addEventListener('click', () => {
        console.log("Send button clicked.");
        sendMessage();
    });

    // Event listener for keyboard input in the message textarea
    // Sends message on Enter key press (unless Shift is also held for a new line)
    userMessageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevent default Enter behavior (new line)
            console.log("Enter key pressed, sending message.");
            sendMessage();
        }
    });

    // Event listener for the "Stop" button
    // In this simplified version, it only affects the UI (hides typing indicator, re-enables input)
    // Actual API interruption would require backend support (e.g., WebSocket cancellation)
    if (stopButton) { 
        stopButton.addEventListener('click', () => {
            console.log("Stop button clicked (UI only).");
            stopButton.style.display = 'none';
            if (typingIndicator) {
                typingIndicator.style.display = 'none';
            }
            sendButton.disabled = false;
            userMessageInput.disabled = false;
            userMessageInput.focus();
        });
    }

    // Initialize the chat display when the page loads
    initializeNewChatDisplay();
});
