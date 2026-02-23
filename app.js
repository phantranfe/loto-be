const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { TICKET_SETS } = require('./constants'); // Đảm bảo file constants.js tồn tại

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

const initTickets = () => {
    let tickets = [];
    TICKET_SETS.forEach((set, idx) => {
        tickets.push({ id: `${idx}-A`, color: set.color, data: set.A, owner: null, userName: null });
        tickets.push({ id: `${idx}-B`, color: set.color, data: set.B, owner: null, userName: null });
    });
    return tickets;
};

io.on('connection', (socket) => {
    socket.on('join_room', ({ roomId, userName, password }) => {
        if (rooms[roomId] && rooms[roomId].password !== password) {
            return socket.emit('join_error', "Sai mật khẩu phòng!");
        }

        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                admin: socket.id,
                dealer: socket.id,
                password: password,
                drawnNumbers: [],
                tickets: initTickets(),
                users: []
            };
        }
        rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
        rooms[roomId].users.push({ id: socket.id, name: userName });
        io.in(roomId).emit('room_state', rooms[roomId]);
    });

    socket.on('pick_ticket', ({ roomId, ticketId, userName }) => {
        const room = rooms[roomId];
        if (!room) return;
        const ticket = room.tickets.find(t => t.id === ticketId);
        if (ticket && !ticket.owner) {
            ticket.owner = socket.id;
            ticket.userName = userName;
            io.in(roomId).emit('update_tickets', room.tickets);
        }
    });

    socket.on('draw_number', (roomId) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.dealer) return;
        const available = Array.from({length: 90}, (_, i) => i + 1).filter(n => !room.drawnNumbers.includes(n));
        if (available.length > 0) {
            const result = available[Math.floor(Math.random() * available.length)];
            room.drawnNumbers.push(result);
            io.in(roomId).emit('new_number', { number: result, history: room.drawnNumbers });
        }
    });

    socket.on('reset_game', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.drawnNumbers = [];
            io.in(roomId).emit('game_reset', room);
        }
    });

    socket.on('claim_win', ({ roomId, userName }) => {
        io.in(roomId).emit('announce_winner', { userName });
    });

    socket.on('disconnecting', () => {
        socket.rooms.forEach(roomId => {
            const room = rooms[roomId];
            if (room) {
                room.users = room.users.filter(u => u.id !== socket.id);
                if (room.users.length === 0) { delete rooms[roomId]; } 
                else {
                    if (room.admin === socket.id) room.admin = room.users[0].id;
                    if (room.dealer === socket.id) room.dealer = room.admin;
                    io.in(roomId).emit('room_state', room);
                }
            }
        });
    });

    // Thêm sự kiện này vào bên trong io.on('connection')
    socket.on('change_dealer', ({ roomId, targetUserId }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.dealer = targetUserId;
            io.in(roomId).emit('room_state', room);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
