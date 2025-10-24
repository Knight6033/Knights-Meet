const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Socket.IO server setup
const io = socketIo(server);

// Store room data (participants, passwords, chat history)
// Key: Meeting ID (Room Name) | Value: { password: '...', users: { socketId: { id:..., name:..., video:true, audio:true } }, chatHistory: [] }
const rooms = {};

// Serve static files (like your index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Root route to serve the main meeting page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Socket.IO Connection and Signaling Logic ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- 1. Join Meeting Logic ---
    socket.on('join-room', ({ roomID, password, userName }) => {
        
        // 1. Check if room exists and validate password
        if (rooms[roomID] && rooms[roomID].password !== password) {
            socket.emit('password-error', 'Incorrect meeting password.');
            return;
        }

        // 2. Create room if it doesn't exist
        if (!rooms[roomID]) {
            rooms[roomID] = {
                password: password,
                users: {},
                chatHistory: []
            };
            console.log(`Room created: ${roomID}`);
        }
        
        // 3. Join the Socket.IO room and track the user
        socket.join(roomID);
        
        const newUser = {
            id: socket.id,
            name: userName || `Guest-${socket.id.substring(0, 4)}`,
            video: true, // Default state: video on
            audio: true  // Default state: audio on
        };
        rooms[roomID].users[socket.id] = newUser;
        socket.roomID = roomID; // Attach roomID to socket for easy lookup

        // 4. Notify user and other participants
        socket.emit('joined-successfully', { roomID: roomID, name: newUser.name, chatHistory: rooms[roomID].chatHistory });
        
        // Broadcast the new participant to everyone else in the room
        socket.to(roomID).emit('user-joined', newUser);
        
        // Send updated participant list to everyone
        io.to(roomID).emit('participants-update', Object.values(rooms[roomID].users));

        console.log(`${newUser.name} joined room ${roomID}`);


        // --- 2. WebRTC Signaling (Relaying Offer, Answer, ICE Candidates) ---
        socket.on('signal', (data) => {
            // Relays the signaling data (Offer/Answer/Candidate) to the specified target user
            io.to(data.targetID).emit('signal', {
                ...data,
                senderID: socket.id // Ensure the recipient knows who sent it
            });
        });


        // --- 3. Chat and Toggle Control ---
        socket.on('chat-message', (message) => {
            const user = rooms[roomID].users[socket.id];
            const messageData = { 
                sender: user.name, 
                text: message, 
                timestamp: new Date().toLocaleTimeString() 
            };
            rooms[roomID].chatHistory.push(messageData); // Store history
            io.to(roomID).emit('chat-message', messageData); // Broadcast to all
        });

        socket.on('toggle-media', ({ type, state }) => {
            const user = rooms[roomID].users[socket.id];
            user[type] = state; // Update user state (e.g., audio: false)
            
            // Broadcast the state change to all other users
            socket.to(roomID).emit('media-toggled', { 
                id: socket.id, 
                type: type, 
                state: state 
            });
            
            // Send updated participant list to reflect new state
            io.to(roomID).emit('participants-update', Object.values(rooms[roomID].users));
        });
    });


    // --- 4. Disconnect Logic ---
    socket.on('disconnect', () => {
        const roomID = socket.roomID;
        if (roomID && rooms[roomID]) {
            const userName = rooms[roomID].users[socket.id] ? rooms[roomID].users[socket.id].name : 'A user';
            
            // Remove user from the room
            delete rooms[roomID].users[socket.id];
            
            // Notify others
            socket.to(roomID).emit('user-left', socket.id);
            
            // Update participant list
            io.to(roomID).emit('participants-update', Object.values(rooms[roomID].users));

            console.log(`${userName} left room ${roomID}. Users remaining: ${Object.keys(rooms[roomID].users).length}`);

            // If the room is empty, delete it
            if (Object.keys(rooms[roomID].users).length === 0) {
                delete rooms[roomID];
                console.log(`Room ${roomID} is now empty and deleted.`);
            }
        }
        console.log(`User disconnected: ${socket.id}`);
    });

});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Knights Meet server running on http://localhost:${PORT}`);
    console.log(`Make sure to run 'npm install express socket.io' first!`);
});

// To run this:
// 1. Create a project folder (e.g., knights-meet)
// 2. Save this code as server.js
// 3. Run 'npm init -y'
// 4. Run 'npm install express socket.io'
// 5. Create a 'public' directory
// 6. Save the HTML/JS code (next section) as 'public/index.html'
// 7. Run 'node server.js'
