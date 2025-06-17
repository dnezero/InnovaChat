document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. Account system removed.");

    const BACKEND_BASE_URL = 'https://innovachat.onrender.com'; 

    const messagesDisplay = document.getElementById('messages-display');
    const userMessageInput = document.getElementById('user-message-input');
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-button'); // Keep if you plan to implement stop functionality
    const chatHeaderTitle = document.querySelector('.chat-header-title');
    const typingIndicator = document.querySelector('.typing-indicator'); // Keep if you plan to implement typing indicator
    const chatList = document.getElementById('chat-list'); // This element might not exist, check your HTML
    const newChatButton = document.getElementById('new-chat-button');

    // Global variables
    let chats = []; // This will store all chat sessions, each with its messages
    let activeChatId = null; // This will store the *backend's integer sessionId*

    // Helper function to generate a unique client-side ID for new chats
    // This is ONLY for client-side representation until a backend ID is assigned
    function generateClientChatId() {
        return `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    // Function to render messages for a chat
    function renderMessages(messages) {
        const messagesDisplay = document.getElementById('messages-display');
        if (!messagesDisplay) {
            console.error('Messages display container not found');
            return;
        }

        messagesDisplay.innerHTML = ''; // Clear existing messages
        
        if (messages && Array.isArray(messages)) {
            messages.forEach(message => {
                const messageDiv = document.createElement('div');
                // Ensure 'role' is either 'user' or 'bot' for CSS classes
                const senderClass = message.sender === 'user' ? 'user' : 'bot';
                messageDiv.className = `message-bubble ${senderClass}`;
                messageDiv.textContent = message.content;
                messagesDisplay.appendChild(messageDiv);
            });
            // Scroll to the latest message
            messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
        }
    }

    // Function to fetch messages from backend
    async function fetchMessages(sessionId) {
        try {
            const response = await fetch(`${BACKEND_BASE_URL}/api/messages?sessionId=${sessionId}`);
            if (!response.ok) {
                // If backend returns a non-200, it's an error
                const errorData = await response.json();
                console.error('Error fetching messages:', errorData.message);
                return [];
            }
            const data = await response.json();
            return data.messages; // Assuming the backend returns { "messages": [...] }
        } catch (error) {
            console.error('Network error while fetching messages:', error);
            return [];
        }
    }

    // Function to save chats to local storage
    function saveChats() {
        localStorage.setItem('innovachat_chats', JSON.stringify(chats));
    }

    // Function to load chats from local storage
    function loadChats() {
        const savedChats = localStorage.getItem('innovachat_chats');
        if (savedChats) {
            chats = JSON.parse(savedChats);
        }
    }

    // Function to create a new chat session
    async function createNewChat() {
        // Create a temporary client-side ID for the new chat initially
        const tempChatId = generateClientChatId();
        const newChat = {
            id: tempChatId, // This will be replaced by the backend ID later
            title: "Nuova Chat", // Temporary title
            messages: []
        };
        chats.unshift(newChat); // Add to the beginning of the list
        
        saveChats();
        renderChatList(chats);
        switchChat(tempChatId); // Switch to the new temporary chat
        userMessageInput.focus();
    }

    // Function to switch between chat sessions
    async function switchChat(chatId) {
        activeChatId = chatId;
        const currentChat = chats.find(chat => chat.id === activeChatId);
        
        if (currentChat) {
            chatHeaderTitle.textContent = currentChat.title;
            // Fetch messages from backend when switching to an existing chat
            // This is crucial to get the messages stored by the backend's integer ID
            const fetchedMsgs = await fetchMessages(currentChat.id);
            currentChat.messages = fetchedMsgs; // Update the chat object with fetched messages
            renderMessages(currentChat.messages);
            saveChats(); // Save updated chat with fetched messages
        } else {
            console.error("Chat not found:", chatId);
            messagesDisplay.innerHTML = '<p>Seleziona una chat o creane una nuova.</p>';
            chatHeaderTitle.textContent = 'InnovaChat';
        }

        // Highlight the active chat in the sidebar
        document.querySelectorAll('.chat-list-item').forEach(item => {
            item.classList.remove('active');
        });
        const activeItem = document.querySelector(`.chat-list-item[data-chat-id="${activeChatId}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }
    }

    // Function to render the list of chat sessions in the sidebar
    function renderChatList(chatSessions) {
        const chatListContainer = document.getElementById('chat-list-container');
        if (!chatListContainer) {
            console.error('chatListContainer element not found.');
            return;
        }

        chatListContainer.innerHTML = ''; // Clear existing list items

        const ul = document.createElement('ul');
        ul.className = 'chat-list'; // Add this class if it's styled in styles.css
        
        chatSessions.forEach(chat => {
            const li = document.createElement('li');
            li.className = 'chat-list-item';
            li.dataset.chatId = chat.id; // Store chat ID
            li.textContent = chat.title || 'Nuova Chat'; // Display title or default

            li.addEventListener('click', () => {
                switchChat(chat.id);
            });
            ul.appendChild(li);
        });
        chatListContainer.appendChild(ul);
    }

    // Function to send a message
    async function sendMessage() {
        const userMessage = userMessageInput.value.trim();
        if (!userMessage) {
            alert('Please enter a message.');
            return;
        }

        // Add user message to the current chat session's messages
        const currentChat = chats.find(chat => chat.id === activeChatId);
        if (!currentChat) {
            console.error("No active chat session found.");
            return;
        }

        currentChat.messages.push({ sender: 'user', content: userMessage, timestamp: new Date().toISOString() });
        renderMessages(currentChat.messages); // Render immediately
        userMessageInput.value = ''; // Clear input

        // Show typing indicator (if you implement it later)
        // if (typingIndicator) typingIndicator.style.display = 'block';

        try {
            // Send the message to the backend
            const response = await callApi(`${BACKEND_BASE_URL}/api/chat`, {
                message: userMessage,
                sessionId: activeChatId // Send the current activeChatId (could be temp or backend ID)
            });

            // If a new session was created on the backend and it returned a new ID
            if (response.sessionId && response.sessionId !== activeChatId) {
                // Update the frontend chat object with the *actual backend-generated ID*
                const oldChatId = activeChatId; // Store the temporary client-side ID
                activeChatId = response.sessionId; // Set activeChatId to the backend's integer ID
                currentChat.id = activeChatId; // Update the chat object's ID

                // This is crucial: we need to update the localStorage and re-render the chat list
                // so that the chat's ID and URL are correct for future fetches.
                renderChatList(chats); // Re-render chat list to update the data-chat-id for the item
                saveChats(); // Save updated chats with the correct backend ID
                console.log(`Chat ID updated from ${oldChatId} to ${activeChatId}`);
            }

            // Add bot's response to the messages
            if (response.botMessage) {
                currentChat.messages.push(response.botMessage);
                renderMessages(currentChat.messages);
            } else {
                console.warn("Bot message not found in response:", response);
            }

            saveChats(); // Save chats after receiving bot's response

            // Automatically request title generation if message count is > 3
            // The backend is already triggering this, but good to have a client-side check too.
            // if (currentChat.messages.length > 3) {
            //     requestTitleGeneration(activeChatId);
            // }

        } catch (error) {
            console.error('Error sending message:', error);
            // Optionally, show an error message to the user
            alert('Failed to send message. Please try again.');
            // Revert adding user message if API call fails
            currentChat.messages.pop();
            renderMessages(currentChat.messages);
        } finally {
            // Hide typing indicator (if you implement it later)
            // if (typingIndicator) typingIndicator.style.display = 'none';
        }
    }

    // Function to call API (POST requests)
    async function callApi(url, data) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `API request failed: ${response.status}`);
        }
        return await response.json();
    }

    // Function to request chat title generation (if needed from frontend)
    // The backend is already handling this automatically after >3 messages.
    // async function requestTitleGeneration(sessionId) {
    //     try {
    //         await callApi(`${BACKEND_BASE_URL}/api/generate_title`, { sessionId: sessionId });
    //         console.log(`Title generation requested for session: ${sessionId}`);
    //         // You might want to re-fetch chats to update the title in the sidebar after some delay
    //         // setTimeout(() => { loadChats(); renderChatList(chats); }, 3000); 
    //     } catch (error) {
    //         console.error('Error requesting title generation:', error);
    //     }
    // }

    // Initial load and setup
    loadChats();
    if (chats.length === 0) {
        createNewChat(); // Create a new chat if none exist
    } else {
        // If chats exist, switch to the most recent one (first in the unshift-ordered array)
        activeChatId = chats[0].id;
        renderChatList(chats);
        switchChat(activeChatId); // Load and render messages for the active chat
    }

    // Event Listeners
    if (newChatButton) {
        newChatButton.addEventListener('click', createNewChat);
    }

    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }

    if (userMessageInput) {
        userMessageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Ensure initial rendering of the chat list is correct
    // This part runs after initial loadChats and potentially createNewChat
    const chatListContainer = document.getElementById('chat-list-container');
    if (chatListContainer) {
        renderChatList(chats); // This ensures the list is always rendered initially
        console.log('Contenuto di chats:', chats);
    } else {
        console.error('chatListContainer element not found.');
    }
});
