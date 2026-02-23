const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { TICKET_SETS } = require('./constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// Quản lý trạng thái các phòng trong RAM
const rooms = {};

// Hàm tạo 16 vé sạch cho phòng mới
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
    socket.on('join_room', ({ roomId, userName }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                admin: socket.id, // Người tạo là Admin
                dealer: socket.id, // Mặc định Admin làm Cái luôn
                drawnNumbers: [],
                tickets: initTickets(),
                users: []
            };
        }

        rooms[roomId].users.push({ id: socket.id, name: userName });
        
        // Đồng bộ dữ liệu phòng cho tất cả user trong phòng đó
        io.to(roomId).emit('sync_room', rooms[roomId]);
    });

    // 2. CHỌN VÉ (SERVER KHÓA VÉ)
    socket.on('pick_ticket', ({ roomId, ticketId, userName }) => {
        const room = rooms[roomId];
        if (!room) return;

        const ticket = room.tickets.find(t => t.id === ticketId);
        // Kiểm tra nếu vé chưa có chủ
        if (ticket && !ticket.owner) {
            ticket.owner = socket.id;
            ticket.userName = userName;
            io.to(roomId).emit('update_tickets', room.tickets);
        }
    });

    // 3. QUAY SỐ (CHỈ CÁI ĐƯỢC QUYỀN)
    socket.on('draw_number', (roomId) => {
        const room = rooms[roomId];
        if (!room || socket.id !== room.dealer) return;

        // Tạo mảng số chưa quay từ 1-90
        const available = Array.from({length: 90}, (_, i) => i + 1)
                               .filter(n => !room.drawnNumbers.includes(n));

        if (available.length > 0) {
            const result = available[Math.floor(Math.random() * available.length)];
            room.drawnNumbers.push(result);
            io.to(roomId).emit('new_number', {
                number: result,
                history: room.drawnNumbers
            });
        }
    });

    // 4. CHỈ ĐỊNH "CÁI" (CHỈ ADMIN ĐƯỢC QUYỀN)
    socket.on('set_dealer', ({ roomId, targetUserId }) => {
        const room = rooms[roomId];
        if (room && socket.id === room.admin) {
            room.dealer = targetUserId;
            io.to(roomId).emit('update_dealer', targetUserId);
        }
    });

    // 5. BÁO THẮNG (KẾT THÚC)
    socket.on('claim_win', ({ roomId, userName, ticketId }) => {
        io.to(roomId).emit('announce_winner', { userName, ticketId });
    });

    // 6. XỬ LÝ KHI THOÁT (TỰ ĐỘNG CHUYỂN QUYỀN)
    socket.on('disconnecting', () => {
        socket.rooms.forEach(roomId => {
            const room = rooms[roomId];
            if (room) {
                // Xóa user khỏi danh sách
                room.users = room.users.filter(u => u.id !== socket.id);
                // Giải phóng vé nếu user đang giữ
                room.tickets.forEach(t => { if(t.owner === socket.id) { t.owner = null; t.userName = null; }});

                if (room.users.length === 0) {
                    delete rooms[roomId]; // Xóa phòng nếu không còn ai
                } else {
                    // Nếu Admin thoát, người tiếp theo lên làm Admin
                    if (room.admin === socket.id) {
                        room.admin = room.users[0].id;
                    }
                    // Nếu Cái thoát, Admin cầm Cái
                    if (room.dealer === socket.id) {
                        room.dealer = room.admin;
                    }
                    io.to(roomId).emit('sync_room', room);
                }
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server Loto BE chạy tại cổng ${PORT}`));
