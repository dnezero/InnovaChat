document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed. Account system removed.");

    const BACKEND_BASE_URL = 'https://innovachat.onrender.com'; 

    const messagesDisplay = document.getElementById('messages-display');
    const userMessageInput = document.getElementById('user-message-input');
    const sendButton = document.getElementById('send-button');
    // const stopButton = document.getElementById('stop-button'); // Commented out, not found in HTML
    const chatHeaderTitle = document.querySelector('.chat-header-title');
    // const typingIndicator = document.querySelector('.typing-indicator'); // Commented out, not found in HTML
    // const chatList = document.getElementById('chat-list'); // This ID is not directly used for the ul, but chat-list-container for the parent div.
    const newChatButton = document.getElementById('new-chat-button');

    // Global variables
    let chats = [];
    let activeChatId = null;
    let sessionIds = {}; // Store session IDs for each chat

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
                // Using addMessageToDisplay to handle rendering and Markdown/syntax highlighting
                addMessageToDisplay(message.sender, message.content, message.timestamp, message.id);
            });
        } else {
            console.error('Messages is not an array or is undefined:', messages);
        }
        
        // Scroll to bottom
        messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
    }

    // Function to load and display a specific chat
    async function loadChat(chatId) {
        try {
            const chat = chats.find(c => c.id === chatId);
            if (!chat) {
                console.error('Chat not found:', chatId);
                return;
            }

            activeChatId = chatId;
            chatHeaderTitle.textContent = chat.title || 'InnovaChat';

            // Retrieve messages from the backend
            const response = await apiRequest(`/api/messages?sessionId=${chatId}`, 'GET');
            const messages = response.messages;

            // Render the messages
            renderMessages(messages);

            // Update active state in sidebar
            document.querySelectorAll('.chat-list-item').forEach(item => {
                item.classList.remove('active');
                if (item.dataset.chatId === chatId) {
                    item.classList.add('active');
                }
            });
        } catch (error) {
            console.error('Error loading chat:', error);
            messagesDisplay.innerHTML = `<div class="error-message">Error loading chat. Please try again.</div>`;
        }
    }

    function loadChats() {
        const saved = localStorage.getItem('innovachat_chats');
        chats = saved ? JSON.parse(saved) : [];
    }

    function saveChats() {
        localStorage.setItem('innovachat_chats', JSON.stringify(chats));
    }

    function generateId() {
        return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    }

    // Function to render the chat list
    function renderChatList(chatsArray) {
        if (!Array.isArray(chatsArray)) {
            console.error('La variabile "chats" non è un array o è undefined:', chatsArray);
            return;
        }

        // Update global chats array
        chats = chatsArray;

        const chatListContainer = document.getElementById('chat-list-container');
        if (!chatListContainer) {
            console.error('Elemento con ID "chat-list-container" non trovato.');
            return;
        }

        chatListContainer.innerHTML = '';

        const today = [];
        const yesterday = [];
        const lastWeek = [];
        const last30Days = [];
        const older = [];

        // Sort chats by latest message timestamp
        chatsArray.sort((a, b) => {
            const lastMsgA = a.messages && a.messages.length > 0 ? new Date(a.messages[a.messages.length - 1].timestamp) : new Date(0);
            const lastMsgB = b.messages && b.messages.length > 0 ? new Date(b.messages[b.messages.length - 1].timestamp) : new Date(0);
            return lastMsgB.getTime() - lastMsgA.getTime(); // Newest first
        });

        chatsArray.forEach(chat => {
            const lastMessage = chat.messages && chat.messages.length > 0 
                ? chat.messages[chat.messages.length - 1] 
                : null;
            const timestamp = lastMessage?.timestamp || new Date().toISOString();

            const chatDate = new Date(timestamp);
            const now = new Date();
            // Reset hours, minutes, seconds, milliseconds to compare dates only
            const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

            const chatDateOnly = new Date(chatDate.getFullYear(), chatDate.getMonth(), chatDate.getDate());

            if (chatDateOnly.getTime() === todayDate.getTime()) today.push(chat);
            else if (chatDateOnly.getTime() === yesterdayDate.getTime()) yesterday.push(chat);
            else {
                const diff = now.getTime() - chatDate.getTime();
                const diffDays = Math.floor(diff / (1000 * 3600 * 24)); // Use floor for days difference

                if (diffDays <= 7) lastWeek.push(chat);
                else if (diffDays <= 30) last30Days.push(chat);
                else older.push(chat);
            }
        });

        function createChatSection(title, sectionChats) {
            if (sectionChats.length > 0) {
                const section = document.createElement('div');
                section.className = 'chat-section';
                
                const header = document.createElement('h3');
                header.textContent = title;
                section.appendChild(header);
                
                const ul = document.createElement('ul');
                ul.className = 'chat-list';
                
                sectionChats.forEach(chat => {
                    const li = document.createElement('li');
                    li.className = 'chat-list-item';
                    li.textContent = chat.title;
                    li.dataset.chatId = chat.id;
                    if (chat.id === activeChatId) {
                        li.classList.add('active');
                    }
                    li.onclick = () => loadChat(chat.id);
                    ul.appendChild(li);
                });
                
                section.appendChild(ul);
                chatListContainer.appendChild(section);
            }
        }

        createChatSection('Today', today);
        createChatSection('Yesterday', yesterday);
        createChatSection('Last Week', lastWeek);
        createChatSection('Last 30 Days', last30Days);
        createChatSection('Older', older);
    }

    function switchChat(chatId) {
        activeChatId = chatId;
        renderChatList(chats);
        loadChat(chatId);
    }

    function createNewChat() {
        const id = generateId();
        const newChat = {
            id,
            title: 'New Chat',
            messages: []
        };
        chats.unshift(newChat); // Add to the beginning of the array
        activeChatId = id;
        saveChats();
        renderChatList(chats);
        switchChat(id);
        // addBotMessage('Hello! I am InnovaChat. How can I help you?'); // Initial message handled by loadChat
    }

    function addMessage(sender, content, timestamp, id) {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;
        const msg = { sender, content, timestamp, id: id || generateId() };
        chat.messages.push(msg);
        saveChats();
        // The display update is now handled by addMessageToDisplay directly
    }

    function addBotMessage(content, timestamp, id) {
        addMessage('bot', content, timestamp || new Date().toISOString(), id);
        addMessageToDisplay('bot', content, timestamp || new Date().toISOString(), id);
    }

    // New function to call the backend to generate the title
    async function generateChatTitle(sessionId) {
        try {
            await apiRequest('/api/generate_title', 'POST', { sessionId: sessionId });
            console.log('Title generation requested for session:', sessionId);
            // After title generation, reload chats to update the title
            loadChats();
            renderChatList(chats);
            switchChat(activeChatId); // Refresh the active chat
        } catch (error) {
            console.error('Error requesting title generation:', error);
        }
    }

    function formatTimestamp(isoTimestamp) {
        if (!isoTimestamp) return '';
        const date = new Date(isoTimestamp);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

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

        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');

        if (sender === 'bot') {
            messageContent.innerHTML = marked.parse(content);

            const codeBlocks = messageContent.querySelectorAll('pre code');
            codeBlocks.forEach(block => {
                const languageClass = Array.from(block.classList).find(cls => cls.startsWith('language-'));
                let language = languageClass ? languageClass.replace('language-', '') : 'Plain Text';
                
                if (language !== 'Plain Text') {
                    language = language.charAt(0).toUpperCase() + language.slice(1);
                }

                const codeHeader = document.createElement('div');
                codeHeader.classList.add('code-header');
                codeHeader.innerHTML = `<span class="code-language">${language}</span>`;

                const copyButton = document.createElement('button');
                copyButton.classList.add('copy-code-button');
                copyButton.innerHTML = `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-copy">
                    <path d="M0 6.75C0 6.122 0.522 5.617 1.157 5.76L1.5 5.82V2.5A1.5 1.5 0 0 1 3 1h8.5A1.5 1.5 0 0 1 13 2.5v10A1.5 1.5 0 0 1 11.5 14H3.5a1.5 1.5 0 0 1-1.5-1.5V10l-1.5-.18a.5.5 0 0 1-.5-.47V6.75ZM2.5 7v5.75c0 .138.112.25.25.25h8.5c.138 0 .25-.112.25-.25V2.5a.25.25 0 0 0-.25-.25H3a.25.25 0 0 0-.25.25v4.5ZM1.5 8.75a.75.75 0 0 0 .75.75h1.75a.75.75 0 0 0 0-1.5H2.25a.75.75 0 0 0-.75.75ZM6 3.25h-.5a.75.75 0 0 0-.75.75v1.5a.75.75 0 0 0 .75.75H6a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75Z"></path>
                </svg>`;

                copyButton.addEventListener('click', () => {
                    const codeToCopy = block.textContent;
                    const tempTextArea = document.createElement('textarea');
                    tempTextArea.value = codeToCopy;
                    document.body.appendChild(tempTextArea);
                    tempTextArea.select();
                    try {
                        document.execCommand('copy');
                        copyButton.innerHTML = `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-check">
                            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
                        </svg>`;
                        setTimeout(() => {
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

                block.parentNode.insertBefore(codeHeader, block);

                hljs.highlightElement(block);
            });

        } else { // For user messages, just display plain text
            messageContent.innerHTML = content.replace(/\n/g, '<br>');
        }
        messageBubble.appendChild(messageContent);

        const messageTimestamp = document.createElement('span');
        messageTimestamp.classList.add('message-timestamp');
        messageTimestamp.textContent = formatTimestamp(timestamp);
        messageBubble.appendChild(messageTimestamp);

        messagesDisplay.appendChild(messageBubble);
        messagesDisplay.scrollTop = messagesDisplay.scrollHeight;
    }

    // This function is not used. `createNewChat` handles the initial message.
    // function initializeNewChatDisplay() {
    //     messagesDisplay.innerHTML = '';
    //     chatHeaderTitle.textContent = 'InnovaChat';
    //     typingIndicator.style.display = 'none';
    //     addMessageToDisplay('bot', 'Hello! I am InnovaChat. How can I help you?', new Date().toISOString());
    // }

    async function sendMessage() {
        const messageContent = userMessageInput.value.trim();
        if (!messageContent) return;
    
        const chatId = activeChatId;
        if (!chatId) {
            console.error('No active chat selected.');
            return;
        }
    
        addMessage('user', messageContent, new Date().toISOString()); // Add to data model
        addMessageToDisplay('user', messageContent, new Date().toISOString()); // Display immediately
        userMessageInput.value = '';
        sendButton.disabled = true;
        userMessageInput.disabled = true;
        // stopButton.style.display = 'none'; // Commented out
        // typingIndicator.style.display = 'block'; // Commented out
    
        try {
            // Use the correct endpoint and include chatId
            const response = await apiRequest('/api/chat', 'POST', {
                message: messageContent,
                sessionId: chatId
            });
    
            if (response.botMessage) {
                // addBotMessage now also handles adding to display
                addBotMessage(response.botMessage.content, response.botMessage.timestamp, response.botMessage.id);
            }
    
            // Check message count and generate title after a few messages
            const chat = chats.find(c => c.id === chatId);
            if (chat && chat.messages.length >= 2) { // Changed to >= 2 (user message + bot response)
                generateChatTitle(chatId);
            }
    
        } catch (error) {
            addBotMessage(`Error: ${error.message || 'Could not get response. Please try again.'}`);
        } finally {
            sendButton.disabled = false;
            userMessageInput.disabled = false;
            // stopButton.style.display = 'none'; // Commented out
            // typingIndicator.style.display = 'none'; // Commented out
            userMessageInput.focus();
        }
    }

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

    // Initial load and setup
    loadChats();
    if (chats.length === 0) {
        createNewChat();
    } else {
        activeChatId = chats[0].id; // Set the first chat as active
        renderChatList(chats);
        loadChat(activeChatId); // Load messages for the active chat
    }

    if (newChatButton) {
        newChatButton.addEventListener('click', () => {
            createNewChat();
        });
    }

    if (sendButton) {
        sendButton.addEventListener('click', () => {
            sendMessage();
        });
    }

    if (userMessageInput) {
        userMessageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    const chatListContainer = document.getElementById('chat-list-container');
    if (chatListContainer) {
        // chatListContainer.innerHTML = ''; // This is now handled by renderChatList
        // renderChatList(chats); // This is now handled by the initial load logic
        console.log('Contenuto di chats:', chats);
    } else {
        console.error('chatListContainer element not found.');
    }

    // The DOMContentLoaded listener is already wrapped around the entire script,
    // so this inner one is redundant.
    // document.addEventListener('DOMContentLoaded', () => {
    //     console.log('Initializing chat system...');
    //     // Initial render with empty array
    //     renderChatList(chats);
    // });
});
