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
            id: `${idx+1}-A`,
            color: set.color,
            data: set.A,
            owner: null,
            userName: null
        });
        tickets.push({
            id: `${idx+1}-B`,
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
        const readyUsers = room.users.filter(u => u.isReady);
        const allReady = room.users.length > 0 && room.users.length === readyUsers.length;
        const atLeastOneUserReady = readyUsers.length > 0;

        io.to(roomId).emit('update_ready_status', {
            allReady,
            atLeastOneUserReady,
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
            // if (rooms[roomId].drawnNumbers?.length > 0) {
            //     return socket.emit('join_error', 'Phòng này đã bắt đầu chơi.');
            // }
        }

        const room = rooms[roomId];
        room.users.push({
            id: socket.id,
            name: userName,
            isReady: false
        });
        socket.roomId = roomId;
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
            socket.emit('error_msg', 'Không thể chọn vé lúc này.');
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
            // const players = room.users.filter(u => u.id !== room.dealer);
            // const allReady = players.length > 0 ? players.every(u => u.isReady) : true;

            // if (!allReady) return socket.emit('error_msg', 'Chưa đủ người sẵn sàng.');

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

    socket.on('claim_win', ({roomId, userName}) => {
        const room = rooms[roomId];
        if (room) {
            io.to(roomId).emit('win', userName);
        }
    });

    function reset(roomId) {
        const room = rooms[roomId];
        room.drawnNumbers = [];
        room.users.forEach(u => u.isReady = false);

        io.to(roomId).emit('game_reset', room);
        io.in(roomId).emit("room_state", room);
        checkReadyStatus(roomId);
    }

    socket.on('reset_game', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            reset(roomId);
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
    const room = rooms[roomId];
        if (room) {
        const idx = room.users.findIndex((u) => u.id === socket.id);
        const user = room.users[idx];
      if (idx !== -1) {
            room.users.splice(idx, 1);
                room.tickets.forEach(t => {
                    if (t.owner === socket.id) {
                        t.owner = null;
                        t.userName = null;
                    }
                });

                if (room.users.length === 0) {
                    delete rooms[roomId];
                } else {
                    if (room.dealer === socket.id) {
                          const readyUser = room.users.find((user) => user.isReady);
                          if (readyUser) {
                            room.dealer = readyUser.id;
                            io.in(roomId).emit("room_state", room);
                            checkReadyStatus(roomId);
                          } else {
                            room.dealer = room.users[0].id;
                            reset(roomId);
                          }
                    } else {
                        io.in(roomId).emit("room_state", room);
                        checkReadyStatus(roomId);
                    }
                }
        }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// https://docs.google.com/document/d/14K2eOwn2aaBFeK-br9Uj1-uZyWefST6fORV78sWldkQ/edit?tab=t.0
