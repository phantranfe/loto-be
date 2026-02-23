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

// Hàm khởi tạo vé để dùng chung
const initTickets = () => {
    let tickets = [];
    TICKET_SETS.forEach((set, idx) => {
        tickets.push({ id: `${idx}-A`, color: set.color, data: set.A, owner: null, userName: null });
        tickets.push({ id: `${idx}-B`, color: set.color, data: set.B, owner: null, userName: null });
    });
    return tickets;
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. THAM GIA PHÒNG
    socket.on('join_room', ({ roomId, userName, password }) => {
        if (!rooms[roomId]) {
            rooms[roomId] = {
                id: roomId,
                password: password,
                dealer: socket.id, 
                users: [],
                drawnNumbers: [],
                // FIX LỖI: Gọi hàm initTickets() thay vì dùng biến initialTickets chưa định nghĩa
                tickets: initTickets(), 
                gameStarted: false
            };
        } else {
            if (rooms[roomId].password !== password) {
                return socket.emit('join_error', 'Sai mật khẩu phòng!');
            }
        }

        const room = rooms[roomId];
        
        // Tránh trùng lặp user nếu reconnect
        const existingUser = room.users.find(u => u.id === socket.id);
        if (!existingUser) {
            room.users.push({ id: socket.id, name: userName });
        }
        
        socket.join(roomId);
        io.in(roomId).emit('room_state', room);
    });

    // 2. CHỌN VÉ (KHÓA VÉ)
    socket.on('pick_ticket', ({ roomId, ticketId, userName }) => {
        const room = rooms[roomId];
        if (room) {
            const ticket = room.tickets.find(t => t.id === ticketId);
            // Thêm check ticket tồn tại tránh crash
            if (ticket && !ticket.owner) {
                ticket.owner = socket.id;
                ticket.userName = userName;
                io.in(roomId).emit('update_tickets', room.tickets);
            }
        }
    });

    // 3. BỎ CHỌN VÉ (MỞ KHÓA)
    socket.on('unpick_ticket', ({ roomId, ticketId }) => {
        const room = rooms[roomId];
        if (room) {
            const ticket = room.tickets.find(t => t.id === ticketId);
            if (ticket && ticket.owner === socket.id) {
                ticket.owner = null;
                ticket.userName = null;
                io.in(roomId).emit('update_tickets', room.tickets);
            }
        }
    });

    // 4. QUAY SỐ (CHỈ DEALER)
    socket.on('draw_number', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            if (room.drawnNumbers.length >= 90) return;

            let num;
            do {
                num = Math.floor(Math.random() * 90) + 1;
            } while (room.drawnNumbers.includes(num));

            room.drawnNumbers.push(num);
            io.in(roomId).emit('new_number', {
                number: num,
                history: room.drawnNumbers
            });
        }
    });

    // 5. CHỈ ĐỊNH DEALER MỚI (GIAO CÁI)
    socket.on('change_dealer', ({ roomId, targetUserId }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.dealer = targetUserId;
            io.in(roomId).emit('room_state', room);
        }
    });

    // 6. RESET TRÒ CHƠI
    socket.on('reset_game', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.drawnNumbers = [];
            // Reset luôn trạng thái gameStarted nếu cần
            room.gameStarted = false; 
            io.in(roomId).emit('game_reset', room);
        }
    });

    // 7. BÁO KINH (THẮNG)
    socket.on('claim_win', ({ roomId, userName }) => {
        io.in(roomId).emit('winner_announced', `${userName} đã báo KINH!`);
    });

    // 8. NGẮT KẾT NỐI
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const userIndex = room.users.findIndex(u => u.id === socket.id);
            
            if (userIndex !== -1) {
                room.users.splice(userIndex, 1);
                
                // Giải phóng vé khi thoát
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
                        room.dealer = room.users[0].id;
                    }
                    io.in(roomId).emit('room_state', room);
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
