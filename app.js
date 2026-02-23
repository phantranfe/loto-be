const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { TICKET_SETS } = require('./constants'); 

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
    // 1. THAM GIA PHÒNG + CHECK UNIQUE + PASS
    socket.on('join_room', ({ roomId, userName, password }) => {
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                password: password,
                dealer: socket.id,
                users: [],
                drawnNumbers: [],
                tickets: initTickets()
            };
        } else {
            if (rooms[roomId].password !== password) {
                return socket.emit('join_error', 'Mật khẩu phòng không chính xác!');
            }
            const nameExists = rooms[roomId].users.some(u => u.name.trim().toLowerCase() === userName.trim().toLowerCase());
            if (nameExists) {
                return socket.emit('join_error', 'Tên này đã có người sử dụng trong phòng!');
            }
        }

        const room = rooms[roomId];
        room.users.push({ id: socket.id, name: userName });
        socket.join(roomId);
        io.in(roomId).emit('room_state', room);
    });

    // 2. CHỌN VÉ + CHẶN KHI ĐÃ QUAY SỐ
    socket.on('pick_ticket', ({ roomId, ticketId, userName }) => {
        const room = rooms[roomId];
        if (room) {
            if (room.drawnNumbers.length > 0) {
                return socket.emit('error_msg', 'Số đã quay, không thể chọn thêm tờ mới!');
            }
            const ticket = room.tickets.find(t => t.id === ticketId);
            if (ticket && !ticket.owner) {
                ticket.owner = socket.id;
                ticket.userName = userName;
                io.in(roomId).emit('update_tickets', room.tickets);
            }
        }
    });

    // 3. BỎ CHỌN VÉ + CHẶN KHI ĐÃ QUAY SỐ
    socket.on('unpick_ticket', ({ roomId, ticketId }) => {
        const room = rooms[roomId];
        if (room) {
            if (room.drawnNumbers.length > 0) {
                return socket.emit('error_msg', 'Không thể bỏ tờ khi ván đấu đã bắt đầu!');
            }
            const ticket = room.tickets.find(t => t.id === ticketId);
            if (ticket && ticket.owner === socket.id) {
                ticket.owner = null;
                ticket.userName = null;
                io.in(roomId).emit('update_tickets', room.tickets);
            }
        }
    });

    // 4. QUAY SỐ (CHỈ DEALER)
    socket.on('draw_number', ({ roomId, number }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer && room.drawnNumbers.length < 90) {
            room.drawnNumbers.push(number);
            io.in(roomId).emit('new_number', { number: number, history: room.drawnNumbers });
        }
    });

    // 5. GIAO CÁI
    socket.on('change_dealer', ({ roomId, targetUserId }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.dealer = targetUserId;
            io.in(roomId).emit('room_state', room);
        }
    });

    // 6. RESET
    socket.on('reset_game', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.drawnNumbers = [];
            io.in(roomId).emit('game_reset', room);
        }
    });

    socket.on('disconnect', () => {
        for (const rid in rooms) {
            const r = rooms[rid];
            const idx = r.users.findIndex(u => u.id === socket.id);
            if (idx !== -1) {
                r.users.splice(idx, 1);
                r.tickets.forEach(t => { if(t.owner === socket.id){ t.owner = null; t.userName = null; }});
                if (r.users.length === 0) delete rooms[rid];
                else {
                    if (r.dealer === socket.id) r.dealer = r.users[0].id;
                    io.in(rid).emit('room_state', r);
                }
            }
        }
    });
});

server.listen(3000, () => console.log('Server running on port 3000'));
