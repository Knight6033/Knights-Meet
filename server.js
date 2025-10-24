const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Store room data
const rooms = {};

// --- MODIFIED: Serve static files (including index.html) from the root directory ---
app.use(express.static(__dirname));

// Root route to serve the main meeting page (index.html is now in the same folder)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
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
            video: true, 
            audio: true  
        };
        rooms[roomID].users[socket.id] = newUser;
        socket.roomID = roomID; 

        // 4. Notify user and other participants
        socket.emit('joined-successfully', { roomID: roomID, name: newUser.name, chatHistory: rooms[roomID].chatHistory });
        socket.to(roomID).emit('user-joined', newUser);
        io.to(roomID).emit('participants-update', Object.values(rooms[roomID].users));

        console.log(`${newUser.name} joined room ${roomID}`);


        // --- 2. WebRTC Signaling ---
        socket.on('signal', (data) => {
            io.to(data.targetID).emit('signal', {
                ...data,
                senderID: socket.id 
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
            rooms[roomID].chatHistory.push(messageData); 
            io.to(roomID).emit('chat-message', messageData); 
        });

        socket.on('toggle-media', ({ type, state }) => {
            const user = rooms[roomID].users[socket.id];
            user[type] = state; 
            
            socket.to(roomID).emit('media-toggled', { 
                id: socket.id, 
                type: type, 
                state: state 
            });
            
            io.to(roomID).emit('participants-update', Object.values(rooms[roomID].users));
        });
    });


    // --- 4. Disconnect Logic ---
    socket.on('disconnect', () => {
        const roomID = socket.roomID;
        if (roomID && rooms[roomID]) {
            const userName = rooms[roomID].users[socket.id] ? rooms[roomID].users[socket.id].name : 'A user';
            
            delete rooms[roomID].users[socket.id];
            
            socket.to(roomID).emit('user-left', socket.id);
            io.to(roomID).emit('participants-update', Object.values(rooms[roomID].users));

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
});
