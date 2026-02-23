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
    console.log('User connected:', socket.id);

    // 1. THAM GIA PHÒNG
    socket.on('join_room', ({ roomId, userName, password }) => {
        if (!rooms[roomId]) {
            // Tạo phòng mới nếu chưa có
            rooms[roomId] = {
                id: roomId,
                password: password,
                dealer: socket.id, // Người tạo phòng làm Cái đầu tiên
                users: [],
                drawnNumbers: [],
                tickets: JSON.parse(JSON.stringify(initialTickets)), // Clone dữ liệu vé
                gameStarted: false
            };
        } else {
            // Kiểm tra mật khẩu nếu phòng đã tồn tại
            if (rooms[roomId].password !== password) {
                return socket.emit('join_error', 'Sai mật khẩu phòng!');
            }
        }

        const room = rooms[roomId];
        
        // Thêm user vào danh sách
        const user = { id: socket.id, name: userName };
        room.users.push(user);
        
        socket.join(roomId);
        io.in(roomId).emit('room_state', room);
    });

    // 2. CHỌN VÉ (KHÓA VÉ)
    socket.on('pick_ticket', ({ roomId, ticketId, userName }) => {
        const room = rooms[roomId];
        if (room) {
            const ticket = room.tickets.find(t => t.id === ticketId);
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
            let num;
            do {
                num = Math.floor(Math.random() * 90) + 1;
            } while (room.drawnNumbers.includes(num) && room.drawnNumbers.length < 90);

            if (room.drawnNumbers.length < 90) {
                room.drawnNumbers.push(num);
                io.in(roomId).emit('new_number', {
                    number: num,
                    history: room.drawnNumbers
                });
            }
        }
    });

    // 5. CHỈ ĐỊNH DEALER MỚI (GIAO CÁI)
    socket.on('change_dealer', ({ roomId, targetUserId }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.dealer = targetUserId;
            // Thông báo trạng thái mới cho cả phòng
            io.in(roomId).emit('room_state', room);
        }
    });

    // 6. RESET TRÒ CHƠI
    socket.on('reset_game', (roomId) => {
        const room = rooms[roomId];
        if (room && socket.id === room.dealer) {
            room.drawnNumbers = [];
            // Nếu muốn reset cả người sở hữu vé, bỏ comment dòng dưới:
            // room.tickets.forEach(t => { t.owner = null; t.userName = null; });
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
                
                // Giải phóng vé nếu người đó thoát
                room.tickets.forEach(t => {
                    if (t.owner === socket.id) {
                        t.owner = null;
                        t.userName = null;
                    }
                });

                // Nếu Dealer thoát, chỉ định người tiếp theo làm dealer (nếu còn người)
                if (room.dealer === socket.id && room.users.length > 0) {
                    room.dealer = room.users[0].id;
                }

                // Nếu không còn ai, xóa phòng
                if (room.users.length === 0) {
                    delete rooms[roomId];
                } else {
                    io.in(roomId).emit('room_state', room);
                }
            }
        }
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
