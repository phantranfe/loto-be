const express = require('express');
const http = require('http');
const {
    Server
} = require('socket.io');
const {
    TICKET_SETS
} = require('./constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const rooms = {};

const initTickets = () => {
    let tickets = [];
    TICKET_SETS.forEach((set, idx) => {
        tickets.push({
            id: `${idx}-A`,
            color: set.color,
            data: set.A,
            owner: null,
            userName: null
        });
        tickets.push({
            id: `${idx}-B`,
            color: set.color,
            data: set.B,
            owner: null,
            userName: null
        });
    });
    return tickets;
};

const checkReadyStatus = (roomId) => {
    const room = rooms[roomId];
    if (room) {
        const allReady = room.users.length > 0 ? room.users.every(u => u.isReady) : true;

        io.to(roomId).emit('update_ready_status', {
            allReady: allReady,
            users: room.users
        });
    }
};

io.on('connection', (socket) => {

    socket.on('join_room', ({
        roomId,
        userName,
        password
    }) => {
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
                return socket.emit('join_error', 'Mật khẩu phòng không chính xác.');
            }
            const nameExists = rooms[roomId].users.some(u =>
                u.name.trim().toLowerCase() === userName.trim().toLowerCase()
            );
            if (nameExists) {
                return socket.emit('join_error', 'Tên này đã có người sử dụng.');
            }
            if (rooms[roomId].drawnNumbers?.length > 0) {
                return socket.emit('join_error', 'Phòng này đã bắt đầu chơi.');
            }
        }

        const room = rooms[roomId];
        room.users.push({
            id: socket.id,
            name: userName,
            isReady: false
        });
        socket.join(roomId);

        io.in(roomId).emit('room_state', room);
        checkReadyStatus(roomId);
    });

    socket.on('pick_ticket', ({
        roomId,
        ticketId,
        userName
    }) => {
        const room = rooms[roomId];
        if (room && room.drawnNumbers.length === 0) {
            const ticket = room.tickets.find(t => t.id === ticketId);
            if (ticket && !ticket.owner) {
                ticket.owner = socket.id;
                ticket.userName = userName;
                io.in(roomId).emit('update_tickets', room.tickets);
            }
        } else {
            socket.emit('error_msg', 'Không thể chọn vé lúc này!');
        }
    });

    socket.on('unpick_ticket', ({
        roomId,
        ticketId
    }) => {
        const room = rooms[roomId];
        if (room && room.drawnNumbers.length === 0) {
            const ticket = room.tickets.find(t => t.id === ticketId);
            if (ticket && ticket.owner === socket.id) {
                ticket.owner = null;
                ticket.userName = null;
                io.in(roomId).emit('update_tickets', room.tickets);
            }
        }
    });

    socket.on('draw_number', ({
        roomId,
        number
    }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer && room.drawnNumbers.length < 90) {
            const players = room.users.filter(u => u.id !== room.dealer);
            const allReady = players.length > 0 ? players.every(u => u.isReady) : true;

            if (!allReady) return socket.emit('error_msg', 'Chưa đủ người sẵn sàng!');

            room.drawnNumbers.push(number);
            io.in(roomId).emit('new_number', {
                number: number,
                history: room.drawnNumbers
            });
        }
    });

    socket.on('change_dealer', ({
        roomId,
        targetUserId
    }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.dealer = targetUserId;
            checkReadyStatus(roomId);
            io.in(roomId).emit('room_state', room);
        }
    });

    socket.on('ready', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            const user = room.users.find(u => u.id === socket.id);
            if (user) {
                user.isReady = true;
                checkReadyStatus(roomId);
            }
        }
    });

    socket.on('reset_game', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.drawnNumbers = [];
            room.users.forEach(u => u.isReady = false);

            io.to(roomId).emit('game_reset', {
                tickets: room.tickets,
                users: room.users
            });
            checkReadyStatus(roomId);
        }
    });

    socket.on('disconnect', () => {
        for (const rid in rooms) {
            const r = rooms[rid];
            const idx = r.users.findIndex(u => u.id === socket.id);
            if (idx !== -1) {
                r.users.splice(idx, 1);
                r.tickets.forEach(t => {
                    if (t.owner === socket.id) {
                        t.owner = null;
                        t.userName = null;
                    }
                });

                if (r.users.length === 0) {
                    delete rooms[rid];
                } else {
                    if (r.dealer === socket.id) r.dealer = r.users[0].id;
                    io.in(rid).emit('room_state', r);
                    checkReadyStatus(rid);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
