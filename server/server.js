// server.js - WebSocket server for 3D Tic Tac Toe
const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Game state storage
const rooms = new Map();
const playerConnections = new Map();

// Generate random room code
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Check for win condition (same logic as client)
function checkWin(board, player) {
    const winningCombinations = [];
    
    // 1. Check rows in each layer
    for (let layer = 0; layer < 3; layer++) {
        for (let row = 0; row < 3; row++) {
            winningCombinations.push([[layer, row, 0], [layer, row, 1], [layer, row, 2]]);
        }
    }

    // 2. Check columns in each layer
    for (let layer = 0; layer < 3; layer++) {
        for (let col = 0; col < 3; col++) {
            winningCombinations.push([[layer, 0, col], [layer, 1, col], [layer, 2, col]]);
        }
    }

    // 3. Check diagonals in each layer
    for (let layer = 0; layer < 3; layer++) {
        winningCombinations.push([[layer, 0, 0], [layer, 1, 1], [layer, 2, 2]]);
        winningCombinations.push([[layer, 0, 2], [layer, 1, 1], [layer, 2, 0]]);
    }

    // 4. Check vertical lines through layers
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            winningCombinations.push([[0, row, col], [1, row, col], [2, row, col]]);
        }
    }

    // 5. Check layer-to-layer diagonals
    for (let col = 0; col < 3; col++) {
        winningCombinations.push([[0, 0, col], [1, 1, col], [2, 2, col]]);
        winningCombinations.push([[0, 2, col], [1, 1, col], [2, 0, col]]);
    }

    for (let row = 0; row < 3; row++) {
        winningCombinations.push([[0, row, 0], [1, row, 1], [2, row, 2]]);
        winningCombinations.push([[0, row, 2], [1, row, 1], [2, row, 0]]);
    }

    // 6. Check space diagonals
    winningCombinations.push([[0, 0, 0], [1, 1, 1], [2, 2, 2]]);
    winningCombinations.push([[0, 0, 2], [1, 1, 1], [2, 2, 0]]);
    winningCombinations.push([[0, 2, 0], [1, 1, 1], [2, 0, 2]]);
    winningCombinations.push([[0, 2, 2], [1, 1, 1], [2, 0, 0]]);

    for (const combination of winningCombinations) {
        const values = combination.map(([layer, row, col]) => board[layer][row][col]);
        if (values.every(val => val === player && val !== '')) {
            return { winner: player, winningCells: combination };
        }
    }

    return null;
}

function checkDraw(board) {
    return board.every(layer => 
        layer.every(row => 
            row.every(cell => cell !== '')
        )
    );
}

function broadcastToRoom(roomCode, message, excludePlayer = null) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.forEach(player => {
        if (player !== excludePlayer && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(message));
        }
    });
}

function sendToPlayer(player, message) {
    if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(message));
    }
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, message);
        } catch (error) {
            console.error('Error parsing message:', error);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        handleDisconnect(ws);
    });
});

function handleMessage(ws, message) {
    console.log('Received message:', message);

    switch (message.type) {
        case 'join_room':
            handleJoinRoom(ws, message);
            break;
        case 'make_move':
            handleMakeMove(ws, message);
            break;
        case 'new_game':
            handleNewGame(ws, message);
            break;
        case 'leave_room':
            handleLeaveRoom(ws, message);
            break;
        case 'chat_message':
            handleChatMessage(ws, message);
            break;
        default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
}

function handleJoinRoom(ws, message) {
    let roomCode = message.roomCode;
    let room;

    if (roomCode && rooms.has(roomCode)) {
        // Join existing room
        room = rooms.get(roomCode);
        if (room.players.length >= 2) {
            ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
            return;
        }
    } else {
        // Create new room
        roomCode = generateRoomCode();
        room = {
            code: roomCode,
            players: [],
            board: Array(3).fill().map(() => Array(3).fill().map(() => Array(3).fill(''))),
            currentPlayer: 'X',
            gameStarted: false,
            gameEnded: false
        };
        rooms.set(roomCode, room);
    }

    // Add player to room
    const playerSymbol = room.players.length === 0 ? 'X' : 'O';
    const player = { ws, symbol: playerSymbol, roomCode };
    
    room.players.push(player);
    playerConnections.set(ws, player);

    // Send room joined confirmation
    ws.send(JSON.stringify({
        type: 'room_joined',
        roomCode,
        playerSymbol
    }));

    // Notify other players
    broadcastToRoom(roomCode, {
        type: 'player_joined',
        playerSymbol
    }, player);

    // Start game if room is full
    if (room.players.length === 2) {
        room.gameStarted = true;
        broadcastToRoom(roomCode, {
            type: 'game_start',
            currentPlayer: room.currentPlayer
        });
    }

    console.log(`Player ${playerSymbol} joined room ${roomCode}. Room has ${room.players.length}/2 players.`);
}

function handleMakeMove(ws, message) {
    const player = playerConnections.get(ws);
    if (!player) return;

    const room = rooms.get(player.roomCode);
    if (!room || !room.gameStarted || room.gameEnded) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game not active' }));
        return;
    }

    // Check if it's player's turn
    if (room.currentPlayer !== player.symbol) {
        ws.send(JSON.stringify({ type: 'error', message: 'Not your turn' }));
        return;
    }

    const { layer, row, col } = message;

    // Check if move is valid
    if (room.board[layer][row][col] !== '') {
        ws.send(JSON.stringify({ type: 'error', message: 'Cell already taken' }));
        return;
    }

    // Make move
    room.board[layer][row][col] = player.symbol;
    
    // Check for win
    const winResult = checkWin(room.board, player.symbol);
    const isDraw = !winResult && checkDraw(room.board);

    if (winResult || isDraw) {
        // Game over
        room.gameEnded = true;
        broadcastToRoom(player.roomCode, {
            type: 'move_made',
            layer,
            row,
            col,
            player: player.symbol,
            nextPlayer: room.currentPlayer
        });

        setTimeout(() => {
            broadcastToRoom(player.roomCode, {
                type: 'game_over',
                winner: winResult ? winResult.winner : null,
                winningCells: winResult ? winResult.winningCells : null
            });
        }, 500);
    } else {
        // Continue game
        room.currentPlayer = room.currentPlayer === 'X' ? 'O' : 'X';
        broadcastToRoom(player.roomCode, {
            type: 'move_made',
            layer,
            row,
            col,
            player: player.symbol,
            nextPlayer: room.currentPlayer
        });
    }
}

function handleNewGame(ws, message) {
    const player = playerConnections.get(ws);
    if (!player) return;

    const room = rooms.get(player.roomCode);
    if (!room || room.players.length < 2) return;

    // Reset game state
    room.board = Array(3).fill().map(() => Array(3).fill().map(() => Array(3).fill('')));
    room.currentPlayer = 'X';
    room.gameEnded = false;
    room.gameStarted = true;

    // Notify all players
    broadcastToRoom(player.roomCode, {
        type: 'game_start',
        currentPlayer: room.currentPlayer
    });

    console.log(`New game started in room ${player.roomCode}`);
}

function handleLeaveRoom(ws, message) {
    handleDisconnect(ws);
}

function handleChatMessage(ws, message) {
    const player = playerConnections.get(ws);
    if (!player) return;

    broadcastToRoom(player.roomCode, {
        type: 'chat_message',
        from: player.symbol,
        message: message.message
    });
}

function handleDisconnect(ws) {
    const player = playerConnections.get(ws);
    if (!player) return;

    const room = rooms.get(player.roomCode);
    if (room) {
        // Remove player from room
        room.players = room.players.filter(p => p.ws !== ws);
        
        // Notify remaining players
        broadcastToRoom(player.roomCode, {
            type: 'player_left',
            playerSymbol: player.symbol
        });

        // Remove empty rooms
        if (room.players.length === 0) {
            rooms.delete(player.roomCode);
            console.log(`Room ${player.roomCode} deleted (empty)`);
        } else {
            // Reset game if someone left during gameplay
            room.gameStarted = false;
            room.gameEnded = false;
        }
    }

    playerConnections.delete(ws);
    console.log(`Player ${player.symbol} left room ${player.roomCode}`);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`WebSocket server running on port ${PORT}`);
    console.log(`Connect clients to: ws://localhost:${PORT}`);
});