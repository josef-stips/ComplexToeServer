const { instrument } = require('@socket.io/admin-ui');
const database = require("./database");
const crypto = require('crypto');
const moment = require('moment');

const http = require('http');
const express = require('express');

const App = express();
const server = http.createServer(App);
const PORT = process.env.PORT || 3000;
const { Server } = require('socket.io');
const { clearInterval } = require('timers');

const io = new Server(server, {
    cors: {
        origin: ["https://admin.socket.io", "http://127.0.0.1:3000"],
        credentials: true,
    },
});

// dev
instrument(io, {
    // auth: {
    //     type: "basic",
    //     username: "admin",
    //     password: process.env.SOCKET_ADMIN,
    // },
    auth: false,
    mode: 'development'
});

App.use(express.json());
App.use(express.static('./node_modules/@socket.io/admin-ui/ui/dist'));

App.get('/', (req, res) => {
    res.send('Secret server for complex toe from josef');
});

App.get('/gfiv47859z597832gtruzfds783w4', async(req, res) => {
    // request from database
    let [result] = await database.pool.query(`select * from players`);
    res.json(result);
});

// server listen
server.listen(PORT, () => {
    console.log(`listening on *:${PORT}`);
});

// some stuff
class const_data {
    constructor() {
        this.clan_roles = {
            0: "leader",
            1: "dikaios",
            2: "sophron",
            3: "member"
        };

        this.DataFields = {
            0: 5,
            1: 10,
            2: 15,
            3: 20,
            4: 25,
            5: 30,
            6: 40
        };
    };
};

const constData = new const_data();

// socket ids with player ids
let socketIdById = {};

// Websocket 
io.on('connection', socket => {
    console.log(`a user connected to the server (${new Date()}): ` + socket.id);

    // Check if the player was at least once in this app
    // if yes, pass some information. f.e the treasure countdown so it does not restart everytime the player opens the app
    io.to(socket.id).emit('CheckIfPlayerAlreadyExists');

    // Player already was in the game
    socket.on("PlayerAlreadyExists", async(PlayerID, treasureIsAvailible, cb) => {
        try {
            let [row] = await database.pool.query(`select banned from players where player_id = ?`, [parseInt(PlayerID)]);
            if (row[0].banned) cb(row[0].banned);

        } catch (error) {
            console.log(error);
        };

        // If the player already exists, a countdown (interval) is playing in the background in the database already
        // Check if the countdown is done
        if (treasureIsAvailible == "false") {
            let answer = await database.checkIfCountDown(parseInt(PlayerID));

            if (answer[0].length >= 1) {
                // send message to user so he is updated and treasure is availible till he opens it
                io.to(socket.id).emit('availible-treasure');

            } else {
                // Treasure is not open, interval is not over
                // send timestamp to client so it knows when the treasure is open
                let datetime = await database.getTreasure_TimeStamp(parseInt(PlayerID));
                io.to(socket.id).emit('availible-treasure-NOT', datetime);
            };

            cb(false);

            // treasure is open but user doesn't opened it in his last log in
        } else if (treasureIsAvailible == "true") {
            cb(false);
            return;
        };

        socketIdById[parseInt(PlayerID)] = socket.id;

        // update "last connection time" in database
        await database.Player_UpdateConnection(parseInt(PlayerID));
    });

    // Player is for the first time in the game
    socket.on("PlayerNotExisted", async() => {
        // create player by add a new row to the connection time: player id is auto_increment
        // return auto generated player id
        let [{ player_id: playerID }] = await database.createPlayer();
        socketIdById[parseInt(playerID)] = socket.id;

        // send id to player, player saves it his storage
        io.to(socket.id).emit("RandomPlayerID_generated", playerID);
    });

    // activate chest countdown again after opening
    socket.on('activate-treasureCountDown', async(PlayerID, UserOpenedTreasureOnceBefore, afterOpening) => {
        if (afterOpening == "afterOpening") {
            // kill old interval
            if (UserOpenedTreasureOnceBefore == "false") {
                // Player never opened the treasure in this game
                // so a new time stamp needs to be created with his player_id as an id
                await database.createTimeStamp(parseInt(PlayerID));

            } else if (UserOpenedTreasureOnceBefore == "true") {
                // Player opened the treasure once before
                // So the countdown (interval) just needs to be updated
                await database.updateTimeStamp(parseInt(PlayerID));
            };
        };
    });

    // user checks every second when the treasure countdown (interval) is still "running" or done (in the databse)
    // It is actually a timestamp 24 hours away from the datetime of the last treasure opening
    socket.on("check_Treasure_Countdown", async(playerID) => {
        // check 
        if (!isNaN(parseInt(playerID))) {
            let answer = await database.checkIfCountDown(parseInt(playerID));

            // if true then the treasure is availible
            if (answer[0].length >= 1) {
                io.to(socket.id).emit('availible-treasure');
            };
        };
    });

    // player disconnected from the lobby
    socket.on('disconnect', async reason => {
        console.log(`user disconnected from the server ${new Date()}: ` + socket.id);

        // about clan rooms
        let rooms = [...socket.rooms];

        rooms.forEach(room => {
            if (isNaN(room)) {
                io.to(room).emit('player_leaves_clan_room', 74);
            };
        });

        // check if the disconnected socket belongs to a room and if yes which role he played in that room
        let data = await database.FindRoomBySocketID(socket.id);

        if (data[0] == undefined) return;

        // if it belongs to a room check which role he played and do the specified things
        if (data[0] == "admin") {
            // Delete the room from database
            kill_room(data[1].RoomID);

            // delete the room from the server and inform the other player (user) in the room about it
            io.to(data[1].RoomID).emit('INFORM_admin_left_room');

            // kicks out all player so the room gets deleted from the server
            io.socketsLeave(data[1].RoomID);

            await database.RemoveWaitingEntry(data[1].player1_id);

        } else if (data[0] == "user") {
            // check if the user that disconnected was in a game with the admin (and blocker)
            if (data[1].isPlaying == 1) {
                // they were playing
                io.to(data[1].RoomID).emit('INFORM_user_left_game');
                // reset global game timer
                await database.pool.query(`update roomdata set globalGameTimer = 0 where RoomID = ?`, [data[1].RoomID]);
                // set "isPlaying" attribute to false 
                await database.pool.query(`update roomdata set isPlaying = false where RoomID = ?`, [data[1].RoomID]);
                // reset user data from database
                await database.UserLeavesRoom(data[1].RoomID);

            } else {
                // they were not playing
                io.to(data[1].RoomID).emit('INFORM_user_left_room');
            };

        } else if (data[0] == "blocker") {
            // check if the user that disconnected was in a game with the admin (and blocker)
            if (data[1].isPlaying == 1) {
                // they were playing
                io.to(data[1].RoomID).emit('INFORM_blocker_left_game');
                // reset global game timer
                await database.pool.query(`update roomdata set globalGameTimer = 0 where RoomID = ?`, [data[1].RoomID]);
                // set "isPlaying" attribute to false 
                await database.pool.query(`update roomdata set isPlaying = false where RoomID = ?`, [data[1].RoomID]);
                // reset user data from database
                await database.BlockerLeavesRoom(data[1].RoomID);

            } else {
                // they were not playing
                io.to(data[1].RoomID).emit('INFORM_blocker_left_room');
            };
        };
    });

    // user updated his name on his local game, the updated name needs to be stored in the database
    socket.on("sendNameToDatabase", async(PlayerID, updatedName, updatedIcon, userInfoClass, userIncoColor, cb) => {
        let status = await database.PlayerUpdatesData(parseInt(PlayerID), updatedName, updatedIcon, userInfoClass, userIncoColor);
        cb({ status });
    });

    // create game room (lobby) and its game code
    socket.on('create_room', (GameData, callback) => {
        try {
            createRoom(GameData);
        } catch (error) {
            console.log(error)
        } finally {
            callback(roomID);
        };
    });

    // client creates room with its data
    async function createRoom(GameData) {
        const min = 100000;
        const max = 999999;

        let roomID = createID(min, max);

        // check if room already exists
        let result = await database.pool.query(`select * from roomdata where RoomID = ?`, [roomID]);

        // if room doesn't exists => create it
        if (result[0].length == 0) {
            // join room as admin because your the creator
            socket.join(roomID);
            // console.log(roomID);

            // create room in database with given data
            await database.CreateRoom(parseInt(roomID), parseInt(GameData[2]), GameData[1], parseInt(GameData[0]), JSON.stringify([]), 0, false, parseInt(GameData[5]), GameData[6],
                GameData[9], GameData[10], JSON.stringify(GameData[11]), 1, GameData[3], "", "", GameData[4], "", "admin", "user", "blocker",
                socket.id, "", "", GameData[7], "", GameData[8], "", parseInt(GameData[0]), parseInt(GameData[0]), 1, GameData[12], GameData[13], GameData[14], GameData[15], GameData[16], GameData[17], GameData[18], GameData[19], GameData[20], GameData[21], GameData[22]);

            // send msg to opponent ! only in tournament mode !
            // console.log(GameData[22], GameData[23], GameData[23].toString(), socketIdById, socketIdById[GameData[23]])

            if (GameData[22]) {
                let tournament_player_msg = { msg: true, msg_type: "tournament_opponent_created_lobby", player: GameData[3], player_id: GameData[16], room_id: roomID };
                await database.pool.query(`update players set clan_msgs = ? where player_id = ?`, [JSON.stringify(tournament_player_msg), GameData[23]]);
                io.to(socketIdById[GameData[23]]).emit('tournament_opponent_created_lobby', tournament_player_msg);
            };

            // Inform and update the page of all other people who are clients of the room about the name of the admin
            io.to(roomID).emit('Admin_Created_And_Joined', [GameData[3], GameData[4], GameData[7], GameData[9]]); // PlayerData[9] = third player as boolean
            return;

        } else {
            console.log(`A room with this id already exists: ${roomID}`);
        };
    };

    socket.on('update_room_x_and_y', async(roomID, x_and_y) => {
        await database.pool.query(`update roomdata set x_and_y = ? where RoomID = ?`, [JSON.stringify(x_and_y), roomID]);
    });

    // try to enter a room. If room exists, the player enters the room but still needs to confirm his user data
    socket.on('TRY_enter_room', async(GameID, callback) => {
        const roomId = parseInt(GameID); // Einmalige Konvertierung der GameID

        try {
            // Abfrage: Existiert der Raum und enthält alle benötigten Daten
            let query = `
                SELECT thirdPlayer, xyCellAmount, PlayerTimer, InnerGameMode, player3_name, player2_name, costumField,players 
                FROM roomdata 
                WHERE RoomID = ?`;
            let [result] = await database.pool.query(query, [roomId]);

            if (result.length === 0) {
                // Raum existiert nicht
                return callback(['no room found']);
            };

            // Extrahieren der Daten aus der Abfrage
            const {
                thirdPlayer,
                xyCellAmount: FieldSize,
                PlayerTimer,
                InnerGameMode,
                player3_name: Player3Name,
                player2_name: Player2Name,
                costumField,
                players: playerAmount
            } = result[0];

            // Prüfen, ob der Raum existiert
            const room = io.sockets.adapter.rooms.get(roomId);
            const roomSize = room ? room.size : 0;

            if (roomSize === 1 || (roomSize === 2 && thirdPlayer == 1)) {
                // Spieler tritt dem Raum bei
                socket.join(roomId);

                // Unterscheidung, ob 2 oder 3 Spieler im Raum sind und Bedingungen erfüllt sind
                if (roomSize == 2 && thirdPlayer == 1 && playerAmount == 2) {
                    await database.pool.query(`update roomdata set players = players + 1 where RoomID = ?`, [roomId]);
                    callback(['room exists', roomId, FieldSize, PlayerTimer, InnerGameMode, "thirdplayer", costumField]);

                } else if (playerAmount == 1) {
                    await database.pool.query(`update roomdata set players = players + 1 where RoomID = ?`, [roomId]);
                    callback(['room exists', roomId, FieldSize, PlayerTimer, InnerGameMode, "secondplayer", costumField]);
                };

            } else {
                // Raum ist voll
                callback([`You can't join`]);
            };

        } catch (error) {
            console.error(`Error trying to enter room ${roomId}:`, error);
            callback(['no room found']);
        };
    });

    // If the room existed, the user joined and setted up his data, this emit listener storages the data on the server
    // And it informs all player in the room about player 2 (user) and player 1 (admin)
    // data[0] = room id ; data[1] = player name ; data[2] = player icon
    socket.on('CONFIRM_enter_room', async(data, callback) => {
        const roomId = parseInt(data[0]);

        // Eine einzige Datenbankabfrage, um alle benötigten Daten gleichzeitig abzurufen
        const query = `
            SELECT 
                player1_name, player1_icon, player1_advancedIcon, player1_IconColor, 
                thirdPlayer, player3_name, player2_name, player1_id, is_random_player_lobby, x_and_y, players
            FROM roomdata 
            WHERE RoomID = ?`;

        const [rows] = await database.pool.query(query, [roomId]);
        const roomData = rows[0];

        const {
            player1_name: player1Name,
            player1_icon: player1Icon,
            player1_advancedIcon: player1AdvancedIcon,
            player1_IconColor: player1IconColor,
            thirdPlayer: thirdPlayerBool,
            player3_name: thirdPlayerName,
            player2_name: player2Name,
            player1_id: player1Id,
            is_random_player_lobby: isRndPlayerLobby,
            x_and_y: xy,
            players: playerAmount
        } = roomData;

        let [username, icon, advancedIcon, iconColor, role] = data.slice(1);

        // Check if the user's name conflicts with existing player names
        if ((player2Name === "" && (username === player1Name || username === thirdPlayerName)) ||
            (thirdPlayerName === "" && (username === player2Name || username === player1Name))) {
            callback('Choose a different name!');
            return;
        };

        // Check if the user's icon conflicts with the admin's icon
        if (player2Name === "" &&
            (icon.toUpperCase() === player1Icon.toUpperCase() && advancedIcon === "empty" ||
                advancedIcon === player1AdvancedIcon && advancedIcon !== "empty")) {
            callback('Choose a different icon!');
            return;
        };

        if (role === "user") {
            // Save user data in the database
            await database.UserJoinsRoom(roomId, username, icon, socket.id, advancedIcon, iconColor, data[6], data[7]);

            // Notify other players in the room
            io.to(roomId).emit('SecondPlayer_Joined', [username, icon, advancedIcon, iconColor, thirdPlayerBool, thirdPlayerName, player1Name]);
            role = "user";

        } else if (role === 'blocker') {
            // Save blocker data in the database
            await database.BlockerJoinsRoom(roomId, username, socket.id, data[6]);

            // Notify other players in the room
            io.to(roomId).emit('ThirdPlayer_Joined', [username, icon, advancedIcon, iconColor, thirdPlayerBool]);
            role = "blocker";
        };

        if (isRndPlayerLobby) {
            await database.RemoveWaitingEntry(player1Id);

            setTimeout(async() => {
                await request_game_to_start([roomId, xy[0], xy[1]]);
            }, 1000);
        };

        callback([username, player1Name, player1Icon, icon, advancedIcon, player1AdvancedIcon, player1IconColor, role, thirdPlayerBool]);
    });

    // the third player (blocker) joins the lobby and requests the data for the second player so he can see it
    socket.on('thirdplayer_requests_SecondPlayerData', async(data) => {
        const roomId = parseInt(data[0]); // Game ID, einmal in einer Variablen speichern

        try {
            // Datenbankabfrage, um alle benötigten Daten in einer Anfrage abzurufen
            let query = `
                SELECT player2_name, player2_icon, player2_advancedIcon, player2_IconColor, player1_name 
                FROM roomdata 
                WHERE RoomID = ?`;
            let result = await database.pool.query(query, [roomId]);

            if (result[0].length === 0) {
                console.error(`No data found for RoomID: ${roomId}`);
                return;
            };

            // Extrahieren der Ergebnisse aus der Abfrage
            let player2_name = result[0][0].player2_name; // Name des zweiten Spielers
            let player2_icon = result[0][0].player2_icon; // Icon des zweiten Spielers
            let player2_advancedIcon = result[0][0].player2_advancedIcon; // Erweitertes Icon des zweiten Spielers
            let player2_icon_color = result[0][0].player2_IconColor; // Farbe des Icons des zweiten Spielers
            let player1_name = result[0][0].player1_name; // Name des ersten Spielers

            // Updates der HTML für alle Spieler im Raum mit den Daten des zweiten Spielers
            io.to(roomId).emit('SecondPlayer_Joined', [
                player2_name, // Name des zweiten Spielers
                player2_icon, // Icon des zweiten Spielers
                player2_advancedIcon, // Erweitertes Icon des zweiten Spielers
                player2_icon_color, // Farbe des Icons
                false, // Event-Status (false)
                "thirdPlayer_RequestsData", // Event-Type
                player1_name // Name des ersten Spielers
            ]);
        } catch (error) {
            console.error(`Error fetching data for RoomID: ${roomId}`, error);
        };
    });

    // admin wants to start the game
    socket.on('request_StartGame', async(Data) => {
        await request_game_to_start(Data);
    });

    // same cell blocker for everyone in the game room1
    function single_CellBlock(cells, cellIndex) {
        cells[cellIndex] = '§';
    };

    socket.on("activateEyeDamage", async(id, cellDistance) => { // legacy code. not in use. do not touch
        let cells = [];

        async function doBlock() {
            for (let i = 0; i < 1600; i++) {
                cells.push('');
            };

            let rndIndex = Math.floor(Math.random() * ((cellDistance - 5) * (cellDistance - 5)));

            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 6; j++) {
                    let maxCellDistance = cellDistance * i;
                    single_CellBlock(cells, rndIndex + j + maxCellDistance);
                };
            };
        };

        await doBlock();
        await io.to(parseInt(id)).emit("EyeDamage", cells);
    });

    // user leaves lobby. if admin leaves lobby => room gets killes and all users in there gets kicked out
    socket.on('user_left_lobby', async(user, roomID, from_continue_btn, tournament_opponent_id, callback) => {
        try {
            // clear and kill game interval
            clearInterval(io.sockets.adapter.rooms.get(parseInt(roomID))?.intervalID);
            const room = io.sockets.adapter.rooms.get(parseInt(roomID));
            if (room) {
                room.intervalID = null;
            };

            await database.pool.query(`update roomdata set win_combinations = JSON_ARRAY(),p1_points = 0, p2_points = 0, players = players - 1 where RoomID = ?`, [parseInt(roomID)]);

            // general things
            if (user == 'admin') {
                // Check if they were in a game playing tic tac toe or not
                let result = await database.pool.query(`select isPlaying from roomdata where RoomID = ?`, [parseInt(roomID)]);
                let isPlaying = result[0][0].isPlaying;

                // set the global timer to default again
                await database.pool.query(`update roomdata set globalGameTimer = 0 where RoomID = ?`, [parseInt(roomID)]);

                // If they are in a game
                if (isPlaying == 1) {
                    // send message to the admin and especially to all other clients that the game is killed
                    // so they are just in the lobby again
                    // the room is still existing with all clients
                    io.to(roomID).emit('killed_game', from_continue_btn);

                    // They do not play anymore
                    await database.pool.query(`update roomdata set isPlaying = 0 where RoomID = ?`, [parseInt(roomID)]);

                    return;
                };

                // if they are still in the lobby and the admin leaves
                if (isPlaying == 0) {
                    // case: tournament
                    if (tournament_opponent_id) {
                        io.to(socketIdById[tournament_opponent_id]).emit('universal_clan_msg_abort_lobby');
                        await database.pool.query(`update players set clan_msgs = ? where player_id = ?`, [JSON.stringify([]), tournament_opponent_id]);
                    };

                    // send a function to the other person of the room so their html updates properly
                    io.to(roomID).emit('killed_room');

                    await database.RemoveWaitingEntry(null, parseInt(roomID));

                    // Room gets deleted from the database
                    kill_room(parseInt(roomID));

                    // kicks out all player so the room gets deleted from the server
                    io.socketsLeave(roomID);

                    // callback to frontend
                    callback('You killed the lobby');
                };

            } else if (user == 'user') { // user kicks himself from the lobby or gets kicked

                // Check if they were in a game
                let result;
                try {
                    result = await database.pool.query(`select isPlaying from roomdata where RoomID = ?`, [parseInt(roomID)]);

                } catch (error) {
                    console.log(error);
                    callback('You just left the game');
                    return;
                };

                let isPlaying = result[0][0].isPlaying;

                // reset all data for the second player in database
                await database.UserLeavesRoom(parseInt(roomID));

                // console.log(isPlaying);
                // If they were playing
                if (isPlaying == 1) {
                    // user just leaves
                    socket.leave(parseInt(roomID));

                    // Inform admin that user just left
                    io.to(parseInt(roomID)).emit('INFORM_user_left_game');

                    // update the value 'isPlaying' to false to say they are not playing
                    await database.pool.query(`update roomdata set isPlaying = 0 where RoomID = ?`, [parseInt(roomID)]);

                    // callback to frontend to update the data of the user who left
                    callback('You just left the game');

                    return;

                } else if (isPlaying == 0) { // If they were not playing

                    // user just leaves
                    socket.leave(parseInt(roomID));

                    // inform all other players that you left
                    io.to(parseInt(roomID)).emit('INFORM_user_left_room');

                    // callback to frontend to update the data of the user who left
                    callback('You just left the game');
                };

            } else if (user == "blocker") { // the third player (blocker) leaves the lobby
                // Check if they were in a game playing tic tac toe or not
                let result;
                try {
                    result = await database.pool.query(`select isPlaying from roomdata where RoomID = ?`, [parseInt(roomID)]);

                } catch (error) {
                    console.log(error);
                    callback('You just left the game');
                    return;
                };

                let isPlaying = result[0][0].isPlaying;

                // reset all data for the second player in database
                await database.BlockerLeavesRoom(parseInt(roomID));

                // If they were playing
                if (isPlaying == 1) {
                    // user just leaves
                    socket.leave(parseInt(roomID));

                    // Inform admin that user just left
                    io.to(parseInt(roomID)).emit('INFORM_blocker_left_game');

                    // update the value 'isPlaying' to false to say they are not playing
                    await database.pool.query(`update roomdata set isPlaying = 0 where RoomID = ?`, [parseInt(roomID)]);

                    // callback to frontend to update the data of the user who left
                    callback('You just left the game');

                    return;
                };

                // If they were not playing
                if (isPlaying == 0) {
                    // user just leaves
                    socket.leave(parseInt(roomID));

                    // inform all other players that you left
                    io.to(parseInt(roomID)).emit('INFORM_blocker_left_room');

                    // callback to frontend to update the data of the user who left
                    callback('You just left the game');
                };
            };

        } catch (error) {
            console.log(error);
        };
    });

    socket.on('watcher_left_game', async(id, cb) => {
        socket.leave(id);
        await database.pool.query(`update roomdata set watching_count = watching_count - 1 where RoomID = ?`, [id]);
        let [row] = await database.pool.query(`select watching_count from roomdata where RoomID = ?`, [id]);
        io.to(id).emit('update_watching_count', row[0].watching_count);
        cb(id);
    });

    socket.on('kick_user_from_lobby', async(user_type, roomID, cb) => {
        // let [socket_row2] = await database.pool.query(`select player2_socketID from roomdata where RoomID = ?`, [parseInt(roomID)]);
        // let [socket_row3] = await database.pool.query(`select player3_socketID from roomdata where RoomID = ?`, [parseInt(roomID)]);

        // let p2_socketID = socket_row2[0].player2_socketID;
        // let p3_socketID = socket_row3[0].player3_socketID;

        // let all_sockets_in_room = await io.in(roomID).fetchSockets();

        switch (user_type) {
            case 'user':
                io.to(roomID).emit('lobby_kick', user_type);

                // let FoundSocket2 = findSocketById(all_sockets_in_room, p2_socketID);
                // FoundSocket2.leave(parseInt(roomID));
                break;

            case 'blocker':

                io.to(roomID).emit('lobby_kick', user_type);

                // let FoundSocket3 = findSocketById(all_sockets_in_room, p3_socketID);
                // FoundSocket3.leave(parseInt(roomID));
                break;
        };
    });

    // If the admin starts the game with the boneyard inner game mode,
    // this emit chooses random indexes of the options array and marks them 
    // data[0] = room ID, data[1] = result, data[2] = options, data[3] = xyCellAmount
    // result = random 2d array with numbers, options = represents game field in array
    socket.on('Global_Boneyard', async(data, cb) => {
        // process which marks random indexes of the options array that need to be blocked
        for (i = 0; i < data[1].length; i++) {
            let RIndex = Math.floor(Math.random() * data[1][i].length);
            let Index = data[1][i][RIndex]

            // options index value to unknown zeichen
            data[2][Index] = "%%";
        };

        // update global options array
        await database.pool.query(`update roomdata set boneyard_arr = ? where RoomID = ?`, [JSON.stringify(data[2]), parseInt(data[0])]);
        let Fieldoptions = await database.pool.query(`select boneyard_arr from roomdata where RoomID = ?`, [parseInt(data[0])]);

        // send modified global options array to every client in room
        io.to(parseInt(data[0])).emit('recieveGlobalOptions', Fieldoptions[0][0].boneyard_arr);
    });

    // legacy:
    // Just a small thing so all '%%' character from the global options array are getting deleted
    socket.on('BoneyardFinalProcess', async id => {
        // let Fieldoptions = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(id)]);

        // let options = JSON.parse(Fieldoptions[0][0].Fieldoptions);
        // for (let i = 0; i < options.length; i++) {
        //     options[i] = '';
        // };

        // await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(id)]);
    });

    // Only the admin can reload the game
    // When he reloads, a message to all clients gets send
    socket.on('Reload_OnlineGame', async(id, x, y) => {
        // create global game options
        let options = new Array(x * y).fill("");

        // set the global timer to default again and reset options
        await database.pool.query(`update roomdata set globalGameTimer = 0,Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(id)]);

        // reset data
        io.sockets.adapter.rooms.get(parseInt(GameID)).timerData.currentPlayer = 1;
        io.sockets.adapter.rooms.get(parseInt(GameID)).timerData.player_clock = io.sockets.adapter.rooms.get(roomID).timerData.initial_clock;

        // send message to all clients and updated options array
        io.to(parseInt(id)).emit('Reload_GlobalGame', options);
    });

    // Some client clicked on the board
    // data[0] = id, data[2] = cell Index, data[3] = player form (x,o,z etc.), data[5] = skin color of player
    socket.on('PlayerClicked', async(data) => {
        // console.log(data);

        // get and modify Fieldoptions in database
        let Fieldoptions = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let options = JSON.parse(Fieldoptions[0][0].Fieldoptions);
        options[data[2]] = data[3];

        await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(data[0])]);

        // update player info on all clients which player can set next
        let currentPlayer;


        if (data[1] == 'admin') { // admin
            data[4] = false;

            currentPlayer = 2;

        } else { // user
            data[4] = true;

            currentPlayer = 1;
        };

        let FieldoptionsUpdated = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(data[0])]);

        io.to(parseInt(data[0])).emit('player_clicked', [JSON.parse(FieldoptionsUpdated[0][0].Fieldoptions), data[4], data[5], data[6]]);
    });

    // reset timer
    socket.on("Request_Players_timer", async(GameID, playerN_timer_event, playerN_timer, playerInNumber, currPlayer, initial_time) => {
        // reset data
        io.sockets.adapter.rooms.get(parseInt(GameID)).timerData.currentPlayer = Number(playerInNumber);
        io.sockets.adapter.rooms.get(parseInt(GameID)).timerData.player_clock = io.sockets.adapter.rooms.get(parseInt(GameID)).timerData.initial_clock;

        if(io.sockets.adapter.rooms.get(parseInt(GameID))?.intervalID == null) {
            startPlayerTimerUpdates([{PlayerTimer: initial_time}] , Number(GameID));
        };

        io.to(parseInt(GameID)).emit('changePlayerTurnDisplay', io.sockets.adapter.rooms.get(parseInt(GameID)).timerData.currentPlayer);
    });

    // user wants to stop the player timers
    socket.on("stop_Players_timer", async GameID => {
        // clear and kill game interval
        clearInterval(io.sockets.adapter.rooms.get(parseInt(GameID))?.intervalID);
        const room = io.sockets.adapter.rooms.get(parseInt(roomID));
        if (room) {
            room.intervalID = null;
        };
    });

    // Bug fix for the single_CellBlock function in the checkWinner function when Player sets his form
    socket.on('resetOptions', async(id, xyCellAmount, killAllDrawnCells, WinCombination, optionsFromClient, cb) => {
        // create options
        let options = [];

        // console.log(killAllDrawnCells, WinCombination, options);

        if (killAllDrawnCells) {
            options = new Array(xyCellAmount * xyCellAmount).fill("");

        } else {
            WinCombination.forEach(index => optionsFromClient[index] = "");
            options = optionsFromClient;
        };

        // update global Fieldoptions variable in database
        await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(id)]);
        let Fieldoptions = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(id)]);

        cb(options);
    });

    // for the blocker combat inner game mode in online mode 
    // the third player sets his block and this gets global for all players in the game
    socket.on('BlockerCombat', async(id, Index) => {
        let Fieldoptions = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(id)]);

        let options = JSON.parse(Fieldoptions[0][0].Fieldoptions);
        options[Index] = '%%';

        await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(id)]);

        io.to(parseInt(id)).emit('blockerCombat_action', options);
    });

    // just a major bug fix
    socket.on('BlockerCombatFinalProcess', async(id, index) => {
        let Fieldoptions = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(id)]);
        let options = JSON.parse(Fieldoptions[0][0].Fieldoptions);

        options[index] = '';

        await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(id)]);
    });

    // admin calls ultimate win
    socket.on('Call_UltimateWin', async(id, data) => {
        // stop player timer in database
        // await database.DeletePlayerClocks(`player1_timer_event_${id}`, `player2_timer_event_${id}`);
        const room = io.sockets.adapter.rooms.get(parseInt(roomID));
        if (room) {
            clearInterval(io.sockets.adapter.rooms.get(parseInt(id))?.intervalID);
            room.intervalID = null;
        };

        // send neccesary data to all clients in lobby
        io.to(parseInt(id)).emit('global_UltimateWin', data[0], data[1], data[2], data[3], data[4], data[5]);
    });

    // admin calls global game timer which all clients recieve through this emit
    socket.on('globalTimer', async id => {
        // request current global game timer from database
        try {
            let globalGameTimer = await database.pool.query(`select globalGameTimer from roomdata where RoomID = ?`, [parseInt(id)]);

            let ggT = globalGameTimer[0][0].globalGameTimer;
            ggT = ggT + 1;

            await database.pool.query(`update roomdata set globalGameTimer = ? where RoomID = ?`, [ggT, parseInt(id)]);
            let globalGameTimerUpdated = await database.pool.query(`select globalGameTimer from roomdata where RoomID = ?`, [parseInt(id)]);

            io.to(parseInt(id)).emit('display_GlobalGameTimer', globalGameTimerUpdated[0][0].globalGameTimer);

        } catch (error) {
            console.log(error)
        };
    });

    // admin changes game data in the lobby
    socket.on('Lobby_ChangeGameData', async(id, display, SpecificData, Selection) => {

        if (Selection == 1) {
            let xy = parseInt(SpecificData.split('x')[0]);
            await database.pool.query(`update roomdata set x_and_y = ? where RoomID = ?`, [JSON.stringify([xy, xy]), parseInt(id)]);
        };

        io.to(parseInt(id)).emit('ChangeGameData', display, SpecificData, Selection);
    });

    // admin updates game data in lobby
    socket.on('updateGameData', async(id, xyCell_Amount, curr_innerGameMode, curr_selected_PlayerClock, fieldIndex, fieldTitle) => {
        // console.log(id, xyCell_Amount, curr_innerGameMode, curr_selected_PlayerClock, fieldIndex, fieldTitle);
        // update in database
        await database.UpdateGameData(parseInt(id), xyCell_Amount, curr_innerGameMode, curr_selected_PlayerClock, fieldIndex, fieldTitle);
    });

    // socket client sends text message in the online game mode message feature
    socket.on("sendMessage", (text, from, id) => {
        io.to(parseInt(id)).emit("recieveMessage", text, from);
    });

    // admin changed required amount of points to win a game dynamically in the lobby
    socket.on("AdminChangesPointsToWin_InLobby", async(id, value) => {
        await database.pool.query(`update roomdata set pointsToWin = ? where RoomID = ?`, [Number(value), parseInt(id)]);

        io.to(parseInt(id)).emit("AdminChanged_PointsToWin", Number(value));
    });

    // user who joins the lobby wants to know how many points are required to win a game
    socket.on("Request_PointsToWin", async(id, cb) => {
        let PointsToWin = await database.pool.query(`select pointsToWin from roomdata where RoomID = ?`, [parseInt(id)]);
        cb(PointsToWin[0][0].pointsToWin);
    });

    // user requests the allowed patterns so they display on the lobby for him
    socket.on("Request_AllowedPatterns", async(id, cb) => {
        let WinPatterns = await database.pool.query(`select win_patterns, costumPatterns from roomdata where RoomID = ?`, [parseInt(id)]);
        cb(JSON.parse(WinPatterns[0][0].win_patterns), WinPatterns[0][0].costumPatterns);
    });

    // admin changed the allowed patterns in the lobby => update all player in lobby
    socket.on("Admin_AlterAllowedPatterns", async(id, array) => {
        await database.pool.query(`update roomdata set win_patterns = ? where RoomID = ?`, [JSON.stringify(array), parseInt(id)]);
        io.to(parseInt(id)).emit("Updated_AllowedPatterns", array);
    });

    // Player submits or creates new quote for his user profile
    socket.on("UserSubmitsNewQuote", async(quote, player_id) => {
        await database.NewPlayerProfileQuote(quote, parseInt(player_id));
    });

    // when player clicks on his user profile and he has an account, all his data gets saved in database
    socket.on("SaveAllData", async(player_name, player_icon, playerInfoClass, playerInfoColor, quote, onlineGamesWon, XP, current_used_skin, player_id, commonPattern) => {
        await database.UpdateAllUserData(player_name, player_icon, playerInfoClass, playerInfoColor, quote, onlineGamesWon, XP, current_used_skin, parseInt(player_id), commonPattern);
    })

    // player searches an user with a name or user id
    socket.on("RequestPlayers", async(text, player_id, player_name, cb) => {
        let result = await database.SearchPlayers(text);

        // check if one player from it is the player who searches. If yes, delete that player from the list
        for (let player of result) {
            // console.log("player: ", player);

            if (player["player_id"] == player_id) {
                result = result.filter(player => player["player_id"] != player_id);
            };
        };

        // check result
        if (result == undefined || result.length == 0) { // no player found
            cb(false);

        } else { // normal result, player/s found
            cb(true, result);
        };
    });

    // user clicks on friends-list btn to see his friends. load his friends list from database players table
    socket.on("RequestFriends", async(PlayerID, cb) => {
        let [FriendsList] = await database.pool.query(`select friends from players where player_id = ?`, [PlayerID]);

        // id : x, name : y
        let NameToID = {};

        if (FriendsList[0]["friends"] != null) { // there are friends
            let ParsedList = JSON.parse(FriendsList[0]["friends"]);

            // for each id, search required data in database and push into object
            for (let id of ParsedList) {
                let [NameRow] = await database.pool.query(`select player_name from players where player_id = ?`, [id]);
                let [IconRow] = await database.pool.query(`select player_icon from players where player_id = ?`, [id]);
                let [IconColorRow] = await database.pool.query(`select playerInfoColor from players where player_id = ?`, [id]);
                let [IconClassRow] = await database.pool.query(`select playerInfoClass from players where player_id = ?`, [id]);

                // finally, just get all data from the player
                let [row] = await database.pool.query(`select * from players where player_id = ?`, [id]);

                let FriendName = NameRow[0]["player_name"];
                let FriendIcon = IconRow[0]["player_icon"];
                let FriendIconColor = IconColorRow[0]["playerInfoColor"];
                let FriendIconClass = IconClassRow[0]["playerInfoClass"];

                NameToID[id] = [FriendName, FriendIcon, FriendIconColor, FriendIconClass, { AllData: row[0] }];
            };
            // send friend names with id's to player who requested it
            cb(NameToID);

        } else {
            cb(false);
        };
    });

    // player sends message to other player
    socket.on("SendMessage_ToOtherPlayer", async(Sender_ID, Sender_Name, message, Receiver_ID, Receiver_Name, cb) => {
        // get messages from Receiver ID's database
        let [messages] = await database.pool.query(`select messages from players where player_id = ?`, [Receiver_ID]);
        let messagesArray = messages[0]["messages"];

        try {
            if (messagesArray == null) {
                let NewMessagesArray = [];
                NewMessagesArray.push([Sender_Name, message]);

                await database.pool.query(`update players set messages = ? where player_id = ?`, [JSON.stringify(NewMessagesArray), Receiver_ID]);

            } else if (messagesArray) {
                let OldArray = JSON.parse(messagesArray);
                OldArray.push([Sender_Name, message]);

                await database.pool.query(`update players set messages = ? where player_id = ?`, [JSON.stringify(OldArray), Receiver_ID]);
            };

        } catch (error) {
            console.log(error);

        } finally {
            cb(Receiver_Name); // As callback that everything went good and message is now in the receiver's database  
        };
    });

    // App of user requests his own messages from database 
    socket.on("RequestMessages", async(userID, cb) => {
        if (userID) {
            let [messages] = await database.pool.query(`select messages from players where player_id = ?`, [userID]);
            let messagesArray = messages[0]["messages"];

            // false: no messages, otherwise: array of message/s
            (messagesArray != null) ? cb(messagesArray): cb(false);
        };
    });

    // user clicked on a message so it can be deleted now
    socket.on("DeleteMessage", async(PlayerID, messageText, cb) => {
        let [OldArray] = await database.pool.query(`select messages from players where player_id = ?`, [PlayerID]);
        let TextArray = JSON.parse(OldArray[0]["messages"])

        if (messageText == null) messageText = "";

        // console.log(messageText);

        TextArray = await TextArray.filter(text => text[1] != messageText);

        // console.log(TextArray);

        // send back the amount of messages still existing
        await cb(TextArray.length);

        await database.pool.query(`update players set messages = ? where player_id = ?`, [JSON.stringify(TextArray), PlayerID]);
    });

    // user requests on the start of the app automatically friend requests
    socket.on("RequestFriendRequests", async(PlayerID, cb) => {
        if (PlayerID) {
            let [rows] = await database.pool.query(`select friend_requests from players where player_id = ?`, [PlayerID]);
            let FriendRequests = rows[0]["friend_requests"]; // [], null, ["..."]

            // if there is something, send friend request. If not send negative answer
            (FriendRequests == null || FriendRequests == "[]") ? cb(false): cb(JSON.parse(FriendRequests));
        };
    });

    // When player clicks on an user he has to know if he is friends with him. check it here.
    socket.on("CheckIfUserIsFriend", async(PlayerID, SearchedPlayer_ID, cb) => {
        let [rows] = await database.pool.query(`select friends from players where player_id = ?`, [PlayerID]);
        let Friends = rows[0]["friends"];

        // check if player has friends
        if (Friends != null && Friends != "[]") {
            let FriendsList = JSON.parse(Friends);

            // console.log(FriendsList)

            for (let id of FriendsList) {
                if (id == SearchedPlayer_ID) {
                    cb(true); // searched player is in friends list!
                    break;
                };
            };

            // if player is not in friends list
            cb(false);

        } else cb(false); // no friends
    });

    // User wants to add other player and sends him friend request
    socket.on("SendFriendRequest", async(SenderID, ReceiverID, cb) => {
        // First, check wether the other player (receiver of friend request) also already sended him a friend request
        let [FriendRequestsFromSender] = await database.pool.query(`select friend_requests from players where player_id = ?`, [SenderID]);
        let FriendRequests1 = FriendRequestsFromSender[0]["friend_requests"];

        // console.log(SenderID, FriendRequests1);

        if (FriendRequests1 != null) {
            let FriendRequestList = JSON.parse(FriendRequests1);
            FriendRequestList = FriendRequestList.filter(id => id == ReceiverID);

            if (FriendRequestList.length > 0) {
                AcceptFriendRequest(ReceiverID, SenderID, cb, "fromSendFriendRequestBtn")
                return;
            };
        };

        let [rows] = await database.pool.query(`select friend_requests from players where player_id = ?`, [ReceiverID]);
        let [FriendsRows] = await database.pool.query(`select friends from players where player_id = ?`, [ReceiverID]);
        let FriendRequests = rows[0]["friend_requests"];
        let FriendsList = FriendsRows[0]["friends"];

        if (FriendRequests != null) { // It is an array = Get array, modify array, send back array

            // the user shouldn't send multiple friend request. That's obviously dumb. 
            // So check if he already sended and return 

            for (let request of JSON.parse(FriendRequests)) {
                if (request == SenderID) {
                    cb(false);
                    return;
                };
            };

            // You should also check wether they are already friends but it doesn't display it yet
            if (FriendsList != null) {
                for (let id of JSON.parse(FriendsList)) {
                    if (id == SenderID) {
                        cb(false);
                        return;
                    };
                };
            };

            // else:

            // get
            let FriendRequestList = JSON.parse(FriendRequests);
            // modify
            FriendRequestList.push(SenderID);
            // send back
            await database.pool.query(`update players set friend_requests = ? where player_id = ?`, [JSON.stringify(FriendRequestList), ReceiverID]);

        } else { // no existing array = Create Array, modify array, send array

            // create
            let NewArray = [];
            // modify
            NewArray.push(SenderID);
            // send
            await database.pool.query(`update players set friend_requests = ? where player_id = ?`, [JSON.stringify(NewArray), ReceiverID]);
        };
    });

    // User wants to delete other player from his friend list
    // The first id needs to be deleted on the database from the second player and vice versa
    socket.on("DeleteFriendFromFriendList", async(PlayerID, PlayerToDeleteFromFriendList_ID) => {
        // get database data
        let [rows_fromPlayer1] = await database.pool.query(`select friends from players where player_id = ?`, [PlayerID]);
        let [rows_fromPlayer2] = await database.pool.query(`select friends from players where player_id = ?`, [PlayerToDeleteFromFriendList_ID]);

        let Player1_FriendsList = JSON.parse(rows_fromPlayer1[0]["friends"]);
        let Player2_FriendsList = JSON.parse(rows_fromPlayer2[0]["friends"]);

        // delete id's from each other's database. There has not to be a check wether the data is null or something because you can't delete something which doesn't exists
        Player1_FriendsList = Player1_FriendsList.filter(id => id != PlayerToDeleteFromFriendList_ID);
        Player2_FriendsList = Player2_FriendsList.filter(id => id != PlayerID);

        // send back updated data
        await database.pool.query(`update players set friends = ? where player_id = ?`, [Player2_FriendsList, PlayerToDeleteFromFriendList_ID]);
        await database.pool.query(`update players set friends = ? where player_id = ?`, [Player1_FriendsList, PlayerID]);
    });

    // Accept friend request 
    socket.on("AcceptFriendRequest", async(RequesterID, AccepterID, cb) => {
        AcceptFriendRequest(RequesterID, AccepterID, cb);
    });

    // Abort friend request 
    socket.on("AbortFriendRequest", async(RequesterID, AccepterID, cb) => {
        // get friend requests list
        let [row] = await database.pool.query(`select friend_requests from players where player_id = ?`, [AccepterID]); // get friend requests
        let FriendRequests = JSON.parse(row[0]["friend_requests"]);

        // delete requester id from request list
        FriendRequests = FriendRequests.filter(requesterID => requesterID != RequesterID);

        // update in database
        await database.pool.query(`update players set friend_requests = ? where player_id = ?`, [JSON.stringify(FriendRequests), AccepterID]);

        cb(true); // final step
    });

    // user wants some other player name by his id 
    socket.on("GetNameByID", async(id, cb) => {
        let [row] = await database.pool.query(`select player_name from players where player_id = ?`, [id])
        let Name = row[0]["player_name"];

        cb(Name);
    });

    // get player data by its id
    socket.on("GetDataByID", async(id, cb) => {
        let data = await getDataById(id);
        cb(data);
    });

    // user wants to remove friend from friends list
    socket.on("DeleteFriend", async(PlayerID, FriendID, cb) => {
        let [PlayerFriendsRow] = await database.pool.query(`select friends from players where player_id = ?`, [PlayerID]); // get friends list
        let [FriendFriendsRow] = await database.pool.query(`select friends from players where player_id = ?`, [FriendID]); // get friends list
        let FriendsList = JSON.parse(PlayerFriendsRow[0]["friends"]);
        let Friend_FriendsList = JSON.parse(FriendFriendsRow[0]["friends"]);

        FriendsList = FriendsList.filter(id => id != FriendID); // remove id from other player in player's row
        // Friend_FriendsList = Friend_FriendsList.filter(id => id != PlayerID); // remove in friend's row the players id

        // overwrite in database
        await database.pool.query(`update players set friends = ? where player_id = ?`, [JSON.stringify(FriendsList), PlayerID]); // from player
        await database.pool.query(`update players set friends = ? where player_id = ?`, [JSON.stringify(Friend_FriendsList), FriendID]); // from friend

        // callback
        cb(true);
    });

    // when player joins lobby in his database row there must stand an info about that he is in a game currently
    socket.on("setPlayerInRoomStatus", async(PlayerID, RoomID) => {
        await database.pool.query(`update players set isInRoom = ? where player_id = ?`, [RoomID, PlayerID]);
    });

    // when player in not in the room anymore
    socket.on("removePlayerInRoomStatus", async(PlayerID) => {
        await database.pool.query(`update players set isInRoom = null where player_id = ?`, [PlayerID]);
    });

    // player clicks on profile of other player
    socket.on("ClickOnProfile", async(PlayerName, RoomID, cb) => {
        let [row] = await database.pool.query(`select * from players where isInRoom = ? and player_name = ?`, [RoomID, PlayerName]);
        let PlayerInfo = row[0];

        cb(PlayerInfo);
    });

    // User saves his level in database
    socket.on("SaveCurrentLevel", async(PlayerID, LevelData, cb) => {

        let level_id = await database.SaveNewLevel(PlayerID, LevelData);
        cb(level_id);
    });

    // User requests levels that are created by him
    socket.on("RequestLevels", async(PlayerID, cb) => {
        let [rows] = await database.pool.query(`select * from levels where creator_id = ?`, [parseInt(PlayerID)]);

        cb(rows);
    });

    // User removes level
    socket.on("RemoveLevel", async(levelID, cb) => {
        let [rows] = await database.pool.query(`delete from levels where id = ?`, [levelID]);

        cb(rows);
    });

    // Of Online Game for all players in the lobby the background color of the game changes
    socket.on("ChangeBGColor", async(GameID, bgcolor1, bgcolor2) => {
        await database.pool.query(`update roomdata set bgcolor1 = ?, bgcolor2 = ? where RoomID = ?`, [bgcolor1, bgcolor2, GameID]);

        io.to(GameID).emit("GetBgcolors", bgcolor1, bgcolor2);
    });

    // Player requests online level on search
    socket.on("RequestOnlineLevels", async(text, cb) => {
        let [rows] = await database.pool.query(`select * from levels where level_name = ? and CreatorBeatIt = 1 and publish_date is not null`, [text]);

        cb(rows);
    });

    // User beat his own level which he created and it should be ready to publish now
    socket.on("UserVerifiedLevel", async(level_id, cb) => {
        await database.pool.query(`update levels set CreatorBeatIt = true where id = ?`, [level_id]); // update 

        let [rows] = await database.pool.query(`select CreatorBeatIt from levels where id = ?`, [level_id]); // get new value
        cb(rows[0]["CreatorBeatIt"]); // send to frontend
    });

    // check wether player beat his own level to publish it
    socket.on("Check_UserVerifiedLevel", async(level_id, cb) => {
        let [verified] = await database.pool.query(`select CreatorBeatIt from levels where id = ?`, [level_id]) // request

        cb(verified[0]["CreatorBeatIt"]);
    });

    // User wants to publish level
    socket.on("PublishLevel", async(level_id, cb) => {
        // get current date
        let [date] = await database.pool.query(`select current_date`);

        await database.pool.query(`update levels set publish_date = ? where id = ?`, [JSON.stringify(date[0]["current_date"]), level_id]); // update 
        await database.pool.query(`update levels set level_status = 1 where id = ?`, [level_id]); // update

        let [rows] = await database.pool.query(`select level_status from levels where id = ?`, [level_id]); // get new value
        cb(rows[0]["level_status"]); // send to frontend
    });

    // User wants to unpublish level
    socket.on("UnpublishLevel", async(level_id, cb) => {
        await database.pool.query(`update levels set publish_date = null where id = ?`, [level_id]); // update 
        await database.pool.query(`update levels set level_status = 0 where id = ?`, [level_id]); // update
        await database.pool.query(`update levels set CreatorBeatIt = 0 where id = ?`, [level_id]); // update

        let [rows] = await database.pool.query(`select level_status from levels where id = ?`, [level_id]); // get new value
        cb(rows[0]["level_status"]); // send to frontend
    });

    // User requests all online level
    socket.on("DisplayAllOnlineLevel", async(cb) => {
        let [rows] = await database.pool.query(`select * from levels where CreatorBeatIt = 1 and publish_date is not null and level_status = 1`);

        let Players = [];
        for (let creator_id of rows) {
            let [player] = await database.pool.query(`select * from players where player_id = ?`, [creator_id["creator_id"]]);
            Players.push(player);
        };

        cb(rows, Players);
    });

    // user searches for clans
    socket.on("clan_search", async(query, cb) => {
        let result;

        if (!isNaN(Number(query))) {
            [result] = await database.pool.query(`select * from clans where id = ?`, [Number(query)]);

        } else {
            [result] = await database.pool.query(`select * from clans where name = ?`, [query]);
        };

        cb(result);
    });

    // automatic: user gets a proposal of popular clans
    socket.on("popular_clans", async(cb) => {
        let [rows] = await database.pool.query(`select * from clans`);

        cb(rows);
    });

    socket.on("join_clan", async(player_id, clan_id, cb) => {
        await AddPlayerToClan(player_id, clan_id, cb, false);
    });

    socket.on("accept_clan_request", async(player_id, clan_id, cb) => {
        await AddPlayerToClan(player_id, clan_id, cb, true);
    });

    // user wants to leave his clean
    socket.on("leave_clan", async(player_id, player_role, default_player_clan_data, clan_id, cb) => {
        // console.log(player_id);
        let clanData = await removePlayerOfClan(player_id, clan_id);

        // refresh XP value of clan
        await clan_refresh_XP_value(clan_id, clanData, socket);

        cb(clanData);
    });

    socket.on("kick_member", async(member_id, clan_id, kicker_name, kicker_id, kick_reason, cb) => {
        let kick_obj = { name: kicker_name, kick_reason, kicker_id };

        // remove out of clan with kick obj
        let clanData = await removePlayerOfClan(member_id, clan_id, kick_obj);

        // refresh XP value of clan
        await clan_refresh_XP_value(clan_id, clanData);

        cb(true);
    });

    socket.on("promote_member", async(member_id, clan_id, promote_reason, cb) => {
        // console.log(member_id, clan_id);
        let [rows] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);
        let clanData = rows[0];
        let members = clanData.members;
        let member = members[member_id];

        if (member) {
            let new_role_index = await promoteClanMember(member, member_id, members, clan_id, null, clanData, promote_reason);

            cb({ new_role: [constData.clan_roles[new_role_index]] });

        } else {
            cb(false);
        };
    });

    socket.on("create_clan", async(clan_name, clan_logo, clan_description, player_id, cb) => {
        let hash = create_hash_id(clan_name);

        let [row] = await database.pool.query(`select * from players where player_id = ?`, [player_id]);
        let [serverStatus, insertId] = await database.CreateClan(clan_name, clan_logo, clan_description, row[0], "clan" + hash, cb);

        if (serverStatus == 2) {
            let [rows] = await database.pool.query(`select * from clans where id = ?`, [insertId]);
            await clan_refresh_XP_value(rows[0].id, rows[0]);
            await passClanMsg(`${row[0].player_name} created this clan`, null, insertId, "clan_msg");

            cb(rows[0]);

        } else {
            cb(null);
        };
    });

    socket.on("connect_to_clan_room", async(clan_id, player_id, cb) => {
        const [rows] = await database.pool.query(`select room_id, in_room from clans where id = ?`, [clan_id]);
        const room_id = rows[0]["room_id"];
        let in_room_list = rows[0]["in_room"];
        // console.log(in_room_list);

        if (!in_room_list) in_room_list = [];
        !in_room_list.includes(player_id) && in_room_list.push(player_id);

        await database.pool.query(`update clans set in_room = ? where id = ?`, [JSON.stringify(in_room_list), clan_id]);

        cb(in_room_list);
        socket.join(room_id);
    });

    socket.on("leave_clan_room", async(roomID, clan_id, player_id) => {
        // console.log(roomID, clan_id, player_id);
        const [rows] = await database.pool.query(`select in_room from clans where id = ?`, [clan_id]);
        let player_in_room = rows[0]["in_room"];

        if (player_in_room[player_id]) delete player_in_room[player_id];

        await database.pool.query(`update clans set in_room = ? where id = ?`, [JSON.stringify(player_in_room), clan_id]);

        io.to(roomID).emit("player_leaves_clan_room", player_id);
        // socket.leave(roomID);
    });

    socket.on("get_clan_data", async(clan_id, cb) => {
        let [row] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);
        cb(row[0]);
    });

    socket.on("playground_player_moves", (player_id, UserInfoClass, UserInfoColor, UserIcon, coords, roomID) => {
        // console.log(player_id, ": ", coords);
        io.to(roomID).emit("recieve_player_coords", player_id, coords, UserInfoClass, UserInfoColor, UserIcon);
    });

    socket.on("pass_clan_message", async(text, player_id, clan_id) => {
        passClanMsg(text, player_id, clan_id, "human");
    });

    socket.on("check_personal_data_for_level_x", async(player_id, level_id, cb) => {
        let [result] = await database.pool.query(`select * from players_level_data where player_id = ? and level_id = ?`, [player_id, level_id]);

        let rows = result[0];

        if (rows == null) {

            await database.pool.query(`insert into players_level_data (
                level_id, player_id) values (?,?)
            `, [level_id, player_id]);

            rows = await database.pool.query(`select * from players_level_data where player_id = ? and level_id = ?`, [player_id, level_id]);
        };

        let [result2] = await database.pool.query(`select * from levels where id = ?`, [level_id]);

        cb(rows, result2[0]);
    });

    socket.on("alter_personal_data_for_level_x", async(player_id, level_id, points_made, beat, like, cb) => {});

    socket.on("submit_comment_to_level", async(text, level_id, player_id, player_name, player_points, cb) => {
        player_points = player_points.points_made || 0;

        let query = `
            insert into level_comments (level_id, player_id, player_points, 
                comment_text, player_name
            ) values (

                ?,
                ?,
                ?,
                ?,
                ?
            )
        `;

        let [result] = await database.pool.query(query, [level_id, player_id, player_points, text, player_name]);

        let insertedComment = {
            comment_id: result.insertId,
            level_id,
            player_id,
            player_points,
            comment_text: text,
            comment_date: new Date(),
            player_name
        };
        cb(insertedComment);
    });

    socket.on("like_level_comment", async(level_id, player_id, comment_id) => {
        player_reacts_to_comment_under_a_level(1, true, level_id, player_id, comment_id, "like");
    });

    socket.on("dislike_level_comment", async(level_id, player_id, comment_id) => {
        player_reacts_to_comment_under_a_level(1, false, level_id, player_id, comment_id, "dislike");
    });

    socket.on("unlike_level_comment", async(level_id, player_id, comment_id) => {
        player_reacts_to_comment_under_a_level(-1, null, level_id, player_id, comment_id, "like");
    });

    socket.on("undislike_level_comment", async(level_id, player_id, comment_id) => {
        player_reacts_to_comment_under_a_level(-1, null, level_id, player_id, comment_id, "dislike");
    });

    socket.on("load_comments", async(level_id, player_id, cb) => {
        let [results] = await database.pool.query(`select * from level_comments where level_id = ?`, [level_id]);
        let [results2] = await database.pool.query(`select comment_reactions from players_level_data where 
        player_id = ? and level_id = ?`, [player_id, level_id]);

        let value;

        if (results2[0]) {
            cb(results, results2[0].comment_reactions);

        } else {
            cb(results, null);
        };
    });

    socket.on("update_online_level_data", async(won, time, points, player_id, level_id, patterns_used, cb) => {
        // console.log(won, time, points, player_id, level_id, patterns_used);
        let [result] = await database.pool.query(`select points_made, best_time, beat, beat_date from players_level_data 
        where player_id = ? and level_id = ?`, [player_id, level_id]);

        let data = result[0];

        let newData = {
            points: null,
            best_time: null,
            beat: null,
            beat_date: null
        };

        if (!data) {
            newData = {
                points: points,
                best_time: time,
                beat: won,
                beat_date: new Date()
            };

            await database.pool.query(`insert into players_level_data (player_id, level_id, points_made, best_time, beat, beat_date) values (?,?,?,?,?,?)
            `, [player_id, level_id, newData.points, newData.best_time, newData.beat, newData.beat_date]);

        } else {
            newData.points = Math.max(data["points_made"], points);
            newData.best_time = data["best_time"] != 0 && data["best_time"] ? Math.min(data["best_time"], time) : time;
            newData.beat = data["beat"] == null ? won : won == true ? won : data["beat"];
            newData.beat_date = data["beat_date"] == null && won ? new Date() : data["beat_date"];

            await database.pool.query(`update players_level_data set 

                points_made = ?,
                best_time = ?,
                beat = ?,
                beat_date = ? where level_id = ? and player_id = ?
            `, [newData.points, newData.best_time, newData.beat, newData.beat_date, level_id, player_id]);
        };

        // next, update columns of table levels 
        let [level_results] = await database.pool.query(`select used_patterns from levels where id = ?`, [level_id]);
        let used_patterns_old = level_results[0].used_patterns;

        if (!used_patterns_old) used_patterns_old = [];
        // console.log(patterns_used);

        patterns_used.forEach(p => {
            used_patterns_old.push(p);
        });

        await database.pool.query(`update levels set used_patterns = ? where id = ?`, [JSON.stringify(used_patterns_old), level_id]);

        cb(newData);
    });

    socket.on("request_level_for_id", async(level_id, cb) => {
        let [results] = await database.pool.query(`select * from levels where id = ?`, [level_id]);
        let [creator_row] = await database.pool.query(`select * from players where player_id = ?`, [results[0].creator_id]);
        cb(results[0], creator_row[0]);
    });

    socket.on("like_level", async(level_id, player_id, cb) => {
        let [results] = await database.pool.query(`select reaction from 
            players_level_data where level_id = ? and player_id = ?
            `, [level_id, player_id]);

        let reaction = results[0].reaction;

        // like level
        if (reaction == 0 || !reaction) {
            await database.pool.query(`update levels set likes = likes + 1 where id = ?`, [level_id]);
            await database.pool.query(`update players_level_data set reaction = 1 
                where level_id = ? and player_id = ?`, [level_id, player_id]);
        };

        let [likes_result] = await database.pool.query(`select likes from levels where id = ?`, [level_id]);
        cb(likes_result[0].likes);
    });

    socket.on("fetch_users_level_reaction", async(level_id, player_id, cb) => {
        let [result] = await database.pool.query(`select reaction from players_level_data 
            where level_id = ? and player_id = ?
            `, [level_id, player_id]);

        cb(result[0]);
    });

    socket.on("get_avg_pattern_of_level", async(level_id, cb) => {
        let [results] = await database.pool.query(`select used_patterns from levels where id = ?`, [level_id]);
        let used_patterns = results[0].used_patterns;
        // console.log(used_patterns);

        if (!used_patterns) {
            cb(null)

        } else {
            // avg pattern
            const mostFrequentString = used_patterns.reduce((acc, str) => {
                acc[str] = (acc[str] || 0) + 1;

                if (acc[str] > acc.maxCount) {
                    acc.maxCount = acc[str];
                    acc.mostFrequent = str;
                };

                return acc;

            }, { mostFrequent: null, maxCount: 0 }).mostFrequent;

            cb(mostFrequentString);
        };
    });

    // get top 100 players 
    socket.on("get_best_players_of_level", async(level_id, cb) => {
        let [results] = await database.pool.query(`select * from players_level_data where level_id = ?`, [level_id]);
        let data = results;
        // console.log(data);

        if (data.length <= 0) cb(null, null);

        // sort array
        data.sort(compare_players_level_data);

        // only top 100
        data = data.slice(0, 100);

        let player_data_list = [];

        // max 100 top players on level scoreboard
        for (let i = 0; i < data.length; i++) {
            let level_data = data[i];

            let [player_result] = await database.pool.query(`select * from players where player_id = ?`, [level_data["player_id"]]);
            let player_data = player_result[0];

            player_data_list.push(player_data);
        };

        cb(data, player_data_list);
    });

    // get last 100 players
    socket.on("get_recent_players", async(cb) => {
        let [players] = await database.pool.query(`select * from players`);

        // console.log(players.slice(0, 100))
        cb(players.slice(0, 100));
    });

    // get 100 best players
    socket.on("top_100_players_global", async(player_id, filter, cb) => {
        let [players] = await database.pool.query(`select * from players`);
        let sort_func = filter == 'XP' ? compare_player_after_XP : filter == 'Games' ? compare_player_after_Games : compare_player;

        players.sort(sort_func);
        players = players.slice(-100);

        cb(players);
    });

    // get top 100 best friends
    socket.on("top_100_players_local", async(player_id, filter, cb) => {
        let [friends_row] = await database.pool.query(`select friends from players where player_id = ?`, [player_id]);
        let friends = await Promise.all(JSON.parse(friends_row[0].friends).map(async id => await getDataById(Number(id))));
        // console.log(friends);
        let sort_func = filter == 'XP' ? compare_player_after_XP : filter == 'Games' ? compare_player_after_Games : compare_player;

        friends.sort(sort_func);
        friends = friends.slice(-100);

        cb(friends);
    });

    // player updates clan data through joining a new clan
    socket.on("update_clan_data", async(clan_data, player_id, cb) => {

        let [rows] = await database.pool.query(`update players set clan_data = ? where
            player_id = ?`, [clan_data, player_id]);
        cb(rows.insertId);
    });

    socket.on("send_XP_to_clan", async(clan_id, player_id, player_XP, cb) => {
        let [rows] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);
        let members = rows[0]["members"];
        // console.log(members, player_id, player_XP);

        try {
            members[player_id].XP = player_XP;

            await database.pool.query(`update clans set members = ? where id = ?`, [JSON.stringify(members), clan_id]);
            await clan_refresh_XP_value(clan_id, rows[0], "init");

            let [updated_row] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);

            cb(updated_row[0]);

        } catch (error) {
            cb(rows[0]);
            console.log(error);
        };
    });

    // on client load client requests ingoing clan messages in his personal db row or important clan messages in clans table
    socket.on("check_for_ingoing_clan_msgs", async(player_id, clan_id, cb) => {
        let personal_clan_msg;

        try {
            let [player_rows] = await database.pool.query(`select clan_msgs from players where player_id = ?`, [player_id]);
            personal_clan_msg = player_rows[0].clan_msgs;
            // if (typeof clan_id == Number) {
            //     console.log(clan_id);
            // };
        } catch (error) {
            console.log(error);
        };

        cb(personal_clan_msg);
    });

    // clean ingoing personal clan messages
    socket.on("clean_personal_clan_msgs", async(player_id) => {
        await database.pool.query(`update players set clan_msgs = null where player_id = ?`, [player_id]);
    });

    // player sends join request to clan
    socket.on("clan_join_request", async(player_data, clan_data, request_text, cb) => {

        // send clan live request and save in db in messages
        try {
            await passClanMsg(`${player_data.player_name} wants to join the clan`, player_data.player_id, clan_data["id"], "join_request", player_data, request_text);

            cb(true);

        } catch (error) {
            console.log(error);
            cb(false);
        };
    });

    // remove msg from db and live 
    socket.on("remove_clan_msg", async(clan_id, msg_id) => {

        // get
        let [row] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);
        let clan_chat = row[0].chat;
        let requests = row[0]["requests"];

        // modify chat
        let msg = clan_chat.find(msg => msg.msg_id === msg_id);
        let newChat = clan_chat;

        if (clan_chat.includes(msg)) {
            newChat = clan_chat.filter(m => m !== msg);
        };

        // modify requests row
        if (requests == null) requests = [];
        requests = requests.filter(id => id !== id);

        // update
        await database.pool.query(`update clans set chat = ?, requests = ? where id = ?`, [JSON.stringify(newChat), JSON.stringify(requests), clan_id]);
        io.to(row[0].room_id).emit("rm_clan_msg", msg_id);
    });

    // update clan description
    socket.on("update_clan_desc", async(clan_id, new_desc, cb) => {
        try {
            await database.pool.query(`update clans set description = ? where id = ?`, [new_desc, clan_id]);
            await passClanMsg(`updated clan description`, null, clan_id, "clan_msg", null, null, false, "clan_msg");
            cb(true);

        } catch (error) {
            console.log(error);
            cb(false);
        };
    });

    // game log stuff

    // load from server when client wants to monitor his previuous games in a list f.ex
    socket.on("load_gameLog", async(player_id, cb) => {
        let [row] = await database.pool.query(`select * from gamelogs where p1_id = ? or p2_id = ? or p3_id = ?`, [player_id, player_id, player_id]);
        cb(row);
    });

    // when client played a new game and finished playing. load to table
    socket.on("update_gameLog", async(gameData, cb) => {
        let insertId = await database.new_gamLog_entry(gameData);
        cb(insertId);
    });

    // client requests all rooms that are playing atm and allowed watching
    socket.on('get_curr_online_games', async(cb) => {
        try {
            // Fetch all the rooms where can_watch is 1
            let [rooms] = await database.pool.query(`SELECT * FROM roomdata WHERE can_watch = 1 AND isPlaying = 1`);
            // let [rooms] = await database.pool.query(`SELECT * FROM roomdata WHERE can_watch = 1`);

            // Fetch player data for each room
            const fetchPlayerDataPromises = rooms.map(async(room) => {
                const [playerDataRows] = await database.pool.query(
                    `SELECT * FROM players WHERE player_id IN (?, ?, ?)`, [room.player1_id, room.player2_id, room.player3_id]
                );
                room.player_data_rows = playerDataRows;
                return room;
            });

            // Wait for all player data queries to complete
            const roomsWithPlayerData = await Promise.all(fetchPlayerDataPromises);

            // Callback with the rooms containing player data
            cb(roomsWithPlayerData);

        } catch (error) {

            console.error('Error fetching current online games:', error);
            cb({ error: 'Failed to fetch current online games' });
        };
    });

    // client requests to watch a selected game
    socket.on('try_to_watch_game', async(roomID, cb) => {
        try {
            let [row] = await database.pool.query(`SELECT * FROM roomdata WHERE roomID = ? AND can_watch = 1 AND isPlaying = 1`, [roomID]);
            let success = false;

            if (row) {
                success = true;
                socket.join(roomID);

                await database.pool.query(`update roomdata set watching_count = ? where RoomID = ?`, [row[0].watching_count + 1, roomID]);

                let [row] = await database.pool.query(`select watching_count from roomdata where RoomID = ?`, [roomID]);
                io.to(roomID).emit('update_watching_count', row[0].watching_count);
            };

            await cb({ success: row ? true : false });

        } catch (error) {
            console.error('Error fetching selected online game to watch:', error);
            cb({ error: 'Error fetching selected online game to watch' });
        };
    });

    // on sub win in online game: update player points in db
    socket.on('update_game_points', async(room_id, p1_points, p2_points, win_combination) => {
        try {
            await database.pool.query(`update roomdata set p1_points = ?, p2_points = ?,win_combinations = JSON_ARRAY_APPEND(IFNULL(win_combinations, '[]'), '$', ?)  where roomID = ?`, [p1_points, p2_points, JSON.stringify(win_combination), room_id]);

        } catch (error) {
            console.log(error);
        };
    });

    socket.on('update_can_watch_game', async(id, bool) => {
        await database.pool.query(`update roomdata set can_watch = ? where RoomID = ?`, [bool, id]);
    });

    // created random player lobby
    socket.on('created_random_player_lobby', async(p1_id, p1_XP, room_id, cb) => {
        await database.SetUpWaitingEntry(p1_XP, p1_id, room_id)
            .then(res => cb(res));
    });

    // wants to join a random lobby
    socket.on('random_player_join_entry', async(p2_id, p2_XP, cb) => {
        try {
            let [rows] = await database.pool.query(`select * from  waiting_list where (? / creator_XP) > 0.35`, [p2_XP]);
            cb(rows, rows[0].room_id);

        } catch (error) {
            console.log(error);
            cb([], null);
        };
    });

    socket.on('create_clan_tournament', async(tournamet_data, clan_id, player_id, cb) => {
        let { success } = await database.CreateClanTournament(tournamet_data, clan_id, player_id);
        cb(success);
    });

    socket.on('load_tournaments', async(clan_data, cb) => {
        try {
            let [rows] = await database.pool.query(`select * from tournaments where clan_id = ?`, [clan_data.clan_id]);
            cb(rows);
        } catch (error) {
            console.log(error);
        };
    });

    // player wants to join his clan's clan tournament
    socket.on('contribute_to_put_and_participate', async(amount, tournament_id, player_id, cb) => {
        try {
            let [rows] = await database.pool.query(`select * from tournaments where id = ?`, [tournament_id]);

            if (rows[0].participant_amount >= rows[0].allowed_amount) {
                cb(false, 'The tournament is full.');
                return;
            };

            let [{ serverStatus }] = await database.pool.query(
                `update tournaments set participants = JSON_ARRAY_APPEND(IFNULL(participants, '[]'), '$', ?), pot_value = pot_value + ?, 
                participant_amount = participant_amount + 1 where id = ?`, [player_id, amount, tournament_id]);

            let [rowsNew] = await database.pool.query(`select * from tournaments where id = ?`, [tournament_id]);

            // Add player to the next free space in the first column of the matches
            let tree_result = await add_player_to_tournament_tree(rowsNew[0], player_id);
            if (!tree_result) cb(false, 'The tournament is full.');

            cb(serverStatus, 'You have successfully joined the tournament!', rowsNew[0]);

        } catch (error) {
            console.log(error);
            cb(false, 'Something went wrong. Try again later.');
        };
    });

    socket.on('tournament_match_lobby_exists', async(hash, cb) => {
        database.pool.query(`select * from roomdata where tournament_hash = ?`, [hash]).then(res => cb(res[0][0]));
    });

    socket.on('tournament_player_to_next_round', async(rounds_dataset, winner, winner_id, curr_round, match_idx, tour_id, clan_id, cb) => {
        let update_success = await tournament_player_to_next_round(rounds_dataset, winner, winner_id, curr_round - 1, curr_round, match_idx, tour_id, clan_id);
        cb(update_success);
    });

    socket.on('get_gameLog_by_tournament_data', async(tournament_match_data, cb) => {
        try {
            const query = `
                SELECT * FROM gamelogs 
                WHERE JSON_UNQUOTE(JSON_EXTRACT(tournament_data, '$.clan_id')) = ?
                AND JSON_UNQUOTE(JSON_EXTRACT(tournament_data, '$.player1')) = ?
                AND JSON_UNQUOTE(JSON_EXTRACT(tournament_data, '$.player2')) = ?
                AND JSON_UNQUOTE(JSON_EXTRACT(tournament_data, '$.tournament_id')) = ?`;

            const { clan_id, player1, player2, tournament_id } = tournament_match_data;
            const [rows] = await database.pool.query(query, [clan_id, player1, player2, tournament_id]);

            if (rows.length > 0) {
                cb(rows[0]);
            } else {
                cb(null);
            };
        } catch (error) {
            console.error("Fehler bei der Abfrage 'get_gameLog_by_tournament_data':", error);
            cb(false);
        };
    });

    socket.on('delete_tournament_due_to_participants', async(t_data, clan_id, cb) => {
        try {
            // delete tournament
            await database.pool.query(`delete from tournaments where id = ?`, [t_data.id]);

            // get clan data 
            let [rows] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);

            // clan msg
            io.to(rows[0].room_id).emit("delete_tournament_due_to_participants_clan_msg", winner_name, tournament_name);
            await passClanMsg(`Due to a lack of participants the tournament ${t_data.name} had to be deleted.`, null, clan_id, "clan_msg");

            // callback
            cb({ success: true, t_data });

        } catch (error) {
            cb({ success: false, error, t_data });
            console.log(error);
        };
    });
});

const tournament_player_to_next_round = async(rounds_dataset, winner, winner_id, curr_round, next_round, match_idx, tour_id, clan_id) => {
    // determines the position of the player in the next match. Wether he should land on player 1 or player 2 position in array.
    const winnerIndex = match_idx % 2;
    const NextMatchIndex = Math.floor(Math.abs(match_idx / 2));

    // console.log('Dataset:', rounds_dataset, 'Winner:', winner, 'Current Round:', curr_round, 'Next Round:', next_round, 'Match Index:', match_idx, tour_id, "winnerIndex: ", winnerIndex);
    // Instead of fetching the whole dataset and modifying it, directly update the specific field in the DB 
    try {
        // Update winner in the current round and match 
        await database.pool.query(`UPDATE tournaments SET current_state = JSON_SET(current_state, '$.rounds[?].matches[?].winner', ?) WHERE id = ?`, [curr_round, match_idx, winner, tour_id]);

        // Optionally, update the next round's player data (if needed) 
        await database.pool.query(`UPDATE tournaments SET current_state = JSON_SET(current_state, '$.rounds[?].matches[?].players[?]', ?) WHERE id = ?`, [next_round, NextMatchIndex, winnerIndex, winner, tour_id]);

        // console.log('Winner and next match updated successfully.');

        // check wether the next round is the last round. If so the player won the entire tournament
        if (rounds_dataset.rounds[next_round].final) {
            player_won_tournament(tour_id, clan_id, winner_id);
            // console.log("player won the tournament:", tour_id);
        };

        return true;

    } catch (error) {
        console.error('Error updating the database:', error, "data:", rounds_dataset, winner, winner_id, curr_round, next_round, match_idx, tour_id, clan_id);
        return false;
    };
};

// player got to the next final round where he cannot play against another player which means he won the entire tournament and gets the pot
// 1. clan msg for the entire clan that player x won
// 2. player gets pot and gets notified (use universal pop up for that)
const player_won_tournament = async(tour_id, clan_id, winner_id) => {
    // console.log("df", tour_id, clan_id, winner_id);

    // get data from database
    let [rows] = await database.pool.query(`select room_id from clans where id = ?`, [clan_id]);
    let roomID = rows[0].room_id;

    let [player_rows] = await database.pool.query(`select player_name from players where player_id = ?`, [winner_id]);
    let winner_name = player_rows[0].player_name;

    let [tour_rows] = await database.pool.query(`select * from tournaments where id = ?`, [tour_id]);
    let tournament_name = tour_rows[0].name;
    let pot_value = tour_rows[0].pot_value;

    // update tournament winner row 
    await database.pool.query(`update tournaments set winner_player_id = ? where id = ?`, [winner_id, tour_id]);

    // clan chat message
    io.to(roomID).emit("player_won_tournament", winner_name, tournament_name);
    await passClanMsg(`${winner_name} won the clan tournament ${tournament_name}!`, null, clan_id, "clan_msg");

    // player message
    let clan_player_msg = { msg: true, msg_type: "tournament_won", pot_value, tournament_name };
    await database.pool.query(`update players set clan_msgs = ? where player_id = ?`, [JSON.stringify(clan_player_msg), winner_id]);
};

// On player joins tournament: Add player to the next free space in the first column of the matches
const add_player_to_tournament_tree = async(tournament_data, player_id, idx = 0) => {
    let data = tournament_data.current_state;
    let found_space = false;

    for (let i = 0; i < data.rounds[idx].matches.length; i++) {
        const match = data.rounds[idx].matches[i];

        for (let j = 0; j < match.players.length; j++) {
            if (match.players[j] === "Player ???" && !found_space) {
                match.players[j] = `Player ${player_id}`;
                found_space = true;
                break;
            };
        };
    };

    if (found_space) {
        await database.pool.query(`update tournaments set current_state = ? where id = ?`, [JSON.stringify(data), tournament_data.id]);
        return true;
    };

    // If no free spot is found
    return false;
};

// player reacts to comment under a level
const player_reacts_to_comment_under_a_level = async(operation_type, bool_type, level_id, player_id, comment_id, reaction_type) => {
    // console.log("lol: ", operation_type, bool_type, level_id, player_id, comment_id, reaction_type);

    if (reaction_type == "like") {
        await database.pool.query(`update level_comments set likes = likes + ? where comment_id = ?`, [operation_type, comment_id]);

    } else if (reaction_type == "dislike") {

        await database.pool.query(`update level_comments set dislikes = dislikes + ? where comment_id = ?`, [operation_type, comment_id]);
    };

    let personal_data = await has_player_personal_level_data(player_id, level_id);

    if (personal_data[0].comment_reactions == null) {

        let query = `
            update players_level_data set comment_reactions = ? where level_id = ? and player_id = ?
        `;

        await database.pool.query(query, [JSON.stringify({
            [comment_id]: bool_type
        }), level_id, player_id]);

    } else {

        let [result] = await database.pool.query(`select comment_reactions from players_level_data where player_id = ? and level_id = ?`, [player_id, level_id]);
        // console.log(result);
        result[0].comment_reactions[comment_id] = bool_type;

        await database.pool.query(`update players_level_data set comment_reactions = ? where level_id = ? and player_id = ?`, [JSON.stringify(result[0].comment_reactions), level_id, player_id]);
    };
};

// if player has no personal data saved to this online level, create row.
const has_player_personal_level_data = async(player_id, level_id) => {
    let [result] = await database.pool.query(`select * from players_level_data where player_id = ? and level_id = ?`, [player_id, level_id]);
    // console.log(result);

    return result;
};

// User accepts friend request
const AcceptFriendRequest = async(RequesterID, AccepterID, cb, fromSendFriendRequestBtn) => {
    let [row] = await database.pool.query(`select friend_requests from players where player_id = ?`, [AccepterID]); // get friend requests
    let [FriendsRow] = await database.pool.query(`select friends from players where player_id = ?`, [AccepterID]); // get friends list
    let [FriendsRowFromRequester] = await database.pool.query(`select friends from players where player_id = ?`, [RequesterID]); // get friends list from requester
    let FriendRequests = row[0]["friend_requests"];
    let FriendsList = FriendsRow[0]["friends"];
    let FriendsListFromRequester = FriendsRowFromRequester[0]["friends"];

    // console.log(fromSendFriendRequestBtn)

    if (FriendRequests != null && FriendRequests != "[]") { // savety if question
        // get array from string
        let FriendRequestArray = JSON.parse(FriendRequests);

        // delete requester id from friend requests
        FriendRequestArray = FriendRequestArray.filter(id => id != RequesterID);

        await database.pool.query(`update players set friend_requests = ? where player_id = ?`, [JSON.stringify(FriendRequestArray), AccepterID]);

        // update database of requester so he also knows that they are friends
        if (FriendsListFromRequester == null) {
            let NewFriendsListArrayForRequester = [];
            NewFriendsListArrayForRequester.push(AccepterID);

            await database.pool.query(`update players set friends = ? where player_id = ?`, [JSON.stringify(NewFriendsListArrayForRequester), RequesterID]);

        } else if (FriendsListFromRequester == "[]" || FriendsListFromRequester != null) {
            let ExistingFriendsListFromRequest = JSON.parse(FriendsListFromRequester);
            ExistingFriendsListFromRequest.push(AccepterID);

            await database.pool.query(`update players set friends = ? where player_id = ?`, [JSON.stringify(ExistingFriendsListFromRequest), RequesterID]);
        };

        // Add request id to friends list
        if (FriendsList == null) { // if no friends yet
            let NewFriendsListArray = [];
            NewFriendsListArray.push(RequesterID);

            await database.pool.query(`update players set friends = ? where player_id = ?`, [JSON.stringify(NewFriendsListArray), AccepterID]);

            fromSendFriendRequestBtn == "fromSendFriendRequestBtn" ? cb("FriendsNow") : cb(true); // Requester successfully removed from request list and added to friends list

        } else if (FriendsList == '[]' || FriendsList != null) { // had or has friends
            let ExistingFriendsList = JSON.parse(FriendsList);
            ExistingFriendsList.push(RequesterID);

            await database.pool.query(`update players set friends = ? where player_id = ?`, [JSON.stringify(ExistingFriendsList), AccepterID]);

            fromSendFriendRequestBtn == "fromSendFriendRequestBtn" ? cb("FriendsNow") : cb(true); // Requester successfully removed from request list and added to friends list
        };
    };
};

// add player to clan
const AddPlayerToClan = async(player_id, clan_id, cb, accept_request) => {
    // console.log(player_id, clan_id, cb, accept_request);

    // get clan data
    let [rows] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);
    let clanData = rows[0];
    let chat = clanData.chat;

    if (Object.keys(clanData.members).length > 50) {
        cb("full");
        return;
    };

    if (!clanData) return;

    // get player data
    let [player_rows] = await database.pool.query(`select * from players where player_id = ?`, [player_id]);

    // when player already in clan. DO NOT add to another clan
    if (!player_rows[0].clan_data) player_rows[0].clan_data = { "role": null, "clan_id": null, "is_in_clan": false };
    if (player_rows[0].clan_data.clan_id != null) {

        if (accept_request) {
            await passClanMsg(`${player_rows[0].player_name} is already in another clan`, player_rows[0].player_id, clan_id, "clan_msg", player_rows[0], null, true);
            await cb(true, clanData, player_rows[0]);
        };

        return;
    };

    // do not look after it when the player's request is accepted
    if (!accept_request) {

        // user already sended request
        if (clanData["requests"] == null) clanData["requests"] = [];

        if (clanData["requests"].includes(player_id)) {
            cb("request_sended");
            return;
        };

        if (clanData["previous_members"] == null) clanData["previous_members"] = [];

        // user is previous member. Have to send join request
        if (clanData["previous_members"][player_id]) {
            cb(false, clanData, player_rows[0]);
            return;
        };
    };

    clanData["members"][player_id] = {
        "XP": player_rows[0].XP,
        "name": player_rows[0].player_name,
        "role": "member",
        "clan_id": clan_id,
        "position": {},
        "join_date": moment(new Date()).format('MMMM D, YYYY')
    };

    // update clan member data
    await database.pool.query(`update clans set members = ? where
            id = ?`, [JSON.stringify(clanData.members), clan_id]);

    // update clan data in players table
    let newPlayersClanData = {
        "role": "member",
        "clan_id": clan_id,
        "is_in_clan": true
    };

    if (accept_request) {
        let PlayersClanMessage = {
            "msg": true,
            "msg_type": "request_accepted",
            "clan_id": clanData["id"],
            "clan_name": clanData["name"]
        };

        await database.pool.query(`update players set clan_data = ?, clan_msgs = ? where player_id = ?`, [JSON.stringify(newPlayersClanData), JSON.stringify(PlayersClanMessage), player_id]);
    };

    // refresh XP value of clan
    await clan_refresh_XP_value(clan_id, clanData);

    // send callback
    await cb(true, clanData, player_rows[0]);

    // send message to everyone in clan room online
    io.to(clanData["room_id"]).emit("player_joined_clan", player_rows[0].player_name);

    // save message in db
    await passClanMsg(`${player_rows[0].player_name} joined the clan`, null, clan_id, "clan_msg", player_rows[0]);
};

// choose new clan leader
const chooseNewClanLeader = async(members) => {
    members = Object.entries(members);

    const roleOrder = {
        'dikaios': 1,
        'sophron': 2,
        'member': 3
    };
    // console.log(members);

    // sort after roles. Player with the highest role becomes the new leader
    const member = members
        .filter(([id, data]) => data.role !== 'leader') // sort out previous leader
        .sort(([idA, dataA], [idB, dataB]) => { // sort members in a highrockey
            return roleOrder[dataA.role] - roleOrder[dataB.role];
        })[0]; // select most valuable player to be choosen as a leader


    return member ? [member[1], member[0]] : [null, null];
};

// remove player out of a clan
const removePlayerOfClan = async(player_id, clan_id, kick_action) => { // kick_action ? {name: kicker_name, reason: "kick reason" ...}
    // console.log(clan_id, player_id, kick_action, "fgiojgoajgjioklsflikjghslidkhgklsjdffsdhgjklsdfghsdjkghsdklj");

    // get clan data
    let [rows] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);
    let clanData = rows[0];
    let MemberData = clanData.members[player_id];

    // leader left the clan. Have to choose new leader
    if (MemberData.role == "leader") {
        let [memberToBePromoted, memberId] = await chooseNewClanLeader(clanData.members);

        memberToBePromoted && await promoteClanMember(memberToBePromoted, memberId, clanData.members, clan_id, "promoteToLeader", clanData,
            `${MemberData.name}, the previous leader, has left the clan. You have been automatically promoted to leader because you are the most valuable player in the clan.`);
    };

    delete clanData.members[player_id];

    // when clan is empty now, delete clan
    if (Object.keys(clanData.members).length <= 0) {
        await database.pool.query(`delete from clans where id = ?`, [clan_id]);

    } else {

        // don't delete clan. Just update member data
        await database.pool.query(`update clans set members = ? where
                id = ?`, [JSON.stringify(clanData.members), clan_id]);

        // add player to previous_members row

        // get
        let [previous_members_row] = await database.pool.query(`select previous_members from clans where id = ? `, [clan_id]);
        let previous_members = previous_members_row[0].previous_members;
        // console.log(previous_members);

        // modify
        if (!previous_members) previous_members = {};

        previous_members[player_id] = {
            "XP": MemberData.XP,
            "name": MemberData.name,
            "role": MemberData.role,
            "clan_id": MemberData.clan_id,
            "position": {}
        };
        // console.log(previous_members);

        // update
        await database.pool.query(`update clans set previous_members = ? where
                id = ?`, [JSON.stringify(previous_members), clan_id]);
        // console.log(kick_action, "rdsggsgfegf");

        // player got not kicked
        if (!kick_action) {

            // live message
            io.to(clanData["room_id"]).emit("player_left_clan", MemberData.name);

            // save live message in db
            passClanMsg(`${MemberData.name} left the clan`, null, clan_id, "clan_msg");

            // player got kicked
        } else {

            // live message
            io.to(clanData["room_id"]).emit("player_got_kicked", MemberData.name, kick_action.name, player_id, clanData);

            // save live message in db
            passClanMsg(`${kick_action.name} kicked ${MemberData.name} out of the clan`, null, clan_id, "clan_msg");

            // update clan message of player
            let clan_player_msg = { msg: true, msg_type: "kick", kick_reason: kick_action.kick_reason, kicker_id: kick_action.kicker_id, kicker_name: kick_action.name };
            await database.pool.query(`update players set clan_msgs = ?, clan_data = ? where player_id = ?`, [JSON.stringify(clan_player_msg), null, player_id]);
        };
    };

    return clanData;
};

// promote clan member
const promoteClanMember = async(member, member_id, members, clan_id, promoteToLeader, clanData, promote_reason) => {

    let old_role = member.role;
    let curr_role_index;
    let new_role_index;
    let new_role;

    if (!promoteToLeader) {

        old_role = member.role;
        curr_role_index = Object.keys(constData.clan_roles).find(key => constData.clan_roles[key] === member.role);
        new_role_index = curr_role_index - 1;
        new_role = constData.clan_roles[new_role_index];

    } else {
        new_role = "leader";

        const newAdminObj = {
            "id": member_id,
            "name": member.name,
            "role": "leader",
            "clan_id": clan_id
        };

        await database.pool.query(`update clans set admin = ? where id = ?`, [JSON.stringify(newAdminObj), clan_id]);
    };

    member.role = new_role

    // define msg for player who gets promoted
    const msg = {
        "msg_type": "promote",
        "old_role": old_role,
        "new_role": member.role,
        "clan_name": clanData.name,
        "clan_id": clanData.id,
        promote_reason
    };

    await database.pool.query(`update clans set members = ? where id = ?`, [JSON.stringify(members), clan_id]);
    await database.pool.query(`update players set clan_msgs = ? where player_id = ?`, [JSON.stringify(msg), member_id]);

    await passClanMsg(`${member.name} got promoted to ${member.role}`, member_id, clan_id, "promotion", null, null);

    return new_role_index;
};

// pass clan message
const passClanMsg = async(text, player_id, clan_id, msg_type, player_data = null, request_text, no_player_id_needed, simple_text_msg) => {
    let [results] = await database.pool.query('SELECT * FROM clans WHERE id = ?', [clan_id]);
    let chat = results[0].chat;
    let author_role = (msg_type !== "join_request" && !no_player_id_needed) ?
        (player_id ? results[0].members[player_id]["role"] : null) :
        null;

    if (msg_type == "join_request" && results[0].members[player_id]) {
        return;
    };

    if (chat === null) chat = [];

    let msg_id = chat[chat.length - 1] ? chat[chat.length - 1].msg_id + 1 : 0;

    // define and add new message
    const newMessage = {
        msg_id: msg_id,
        message: text,
        from: player_id,
        date: moment(new Date()).format('MMMM D, YYYY, h:mm A'),
        role: author_role,
        type: msg_type,
        player_data: player_data,
        request_text
    };

    chat.push(newMessage);

    if (chat.length > 100) {
        chat.shift();
    };

    if (!results[0].requests) results[0].requests = [];

    // update "requests" row
    if (msg_type == "join_request") {
        results[0]["requests"].push(player_id);
    };

    let [ResultSetHeader] = await database.pool.query(`update clans set chat = ?, requests = ? where id = ?`, [
        JSON.stringify(chat), JSON.stringify(results[0]["requests"]), clan_id
    ]);

    // send data live
    if (player_id) {
        let player_data = await getDataById(player_id);
        io.to(results[0]["room_id"]).emit("new_clan_message", newMessage, player_data, msg_type);
    };

    if (simple_text_msg) {
        io.to(results[0]["room_id"]).emit("new_clan_message", newMessage, null, "clan_msg");
    };
};

// generates ID for the room
const createID = (min, max) => { let = roomID = Math.floor(Math.random() * (max - min + 1)) + min; return roomID; };

// player kills room which he created before
const kill_room = async(id) => {
    // check if room exists
    let roomData = await database.pool.query(`select * from roomdata where RoomID = ?`, [id]);

    // delete room from database if room exists
    if (roomData[0].length > 0) {

        // clear and kill game interval
        clearInterval(io.sockets.adapter.rooms.get(parseInt(id))?.intervalID);
        const room = io.sockets.adapter.rooms.get(parseInt(roomID));
        if (room) {
            room.intervalID = null;
        };

        // delete room from database
        database.DeleteRoom(parseInt(id));
    };
};

// create hash id number
const create_hash_id = (text) => {
    let hash = crypto.createHash('sha256');
    hash.update(text);
    hash = hash.digest('hex');

    return hash;
};

// get all players data by its db id
const getDataById = async(id) => {
    try {
        let [row] = await database.pool.query(`select * from players where player_id = ?`, [id]);
        return row[0];

    } catch (error) {
        return false;
    };
};

// compare players_level_data of a level
function compare_players_level_data(a, b) {
    // Compare by best_time (ascending)
    if (a.best_time !== b.best_time) {
        return a.best_time - b.best_time;
    };

    // Compare by points_made (descending)
    if (a.points_made !== b.points_made) {
        return b.points_made - a.points_made;
    };

    // Compare by beat_date (ascending)
    // Handle cases where beat_date might be null
    const dateA = a.beat_date ? new Date(a.beat_date) : null;
    const dateB = b.beat_date ? new Date(b.beat_date) : null;

    if (dateA && dateB) {
        return dateA - dateB;
    } else if (dateA && !dateB) {
        return -1; // a should come before b
    } else if (!dateA && dateB) {
        return 1; // b should come before a
    } else {
        return 0; // both dates are null, they are equal
    };
};

// compare players data 
function compare_player(a, b) {
    const gamesWon1 = !a.onlineGamesWon ? 0 : a.onlineGamesWon
    const gamesWon2 = !b.onlineGamesWon ? 0 : b.onlineGamesWon;

    if (gamesWon1 !== gamesWon2) {
        return b.onlineGamesWon - a.onlineGamesWon;
    };

    const XP1 = !a.XP ? 0 : a.XP;
    const XP2 = !b.XP ? 0 : b.XP;

    if (XP1 !== XP2) {
        return b.onlineGamesWon - a.onlineGamesWon;
    };

    if (a.player_id !== b.player_id) {
        return a.player_id - b.player_id;
    };
};

function compare_player_after_XP(a, b) {
    const XP1 = !a.XP ? 0 : a.XP;
    const XP2 = !b.XP ? 0 : b.XP;

    if (XP1 !== XP2) {
        return b.onlineGamesWon - a.onlineGamesWon;
    };

    if (a.player_id !== b.player_id) {
        return a.player_id - b.player_id;
    };
};

function compare_player_after_Games(a, b) {
    const gamesWon1 = !a.onlineGamesWon ? 0 : a.onlineGamesWon
    const gamesWon2 = !b.onlineGamesWon ? 0 : b.onlineGamesWon;

    if (gamesWon1 !== gamesWon2) {
        return b.onlineGamesWon - a.onlineGamesWon;
    };

    if (a.player_id !== b.player_id) {
        return a.player_id - b.player_id;
    };
};

const level_xp_requirement = {
    1: 0,
    2: 100,
    3: 300,
    4: 700,
    5: 900,
    6: 1100,
    7: 1500,
    8: 1900,
    9: 2200,
    10: 3000,
    11: 5000,
    12: 6000,
    13: 8000,
    14: 10000,
    15: 12000,
    16: 14000,
    17: 16000,
    18: 17000,
    19: 18000,
    20: 19000,
    21: 20000,
    22: 21000,
    23: 22000,
    24: 23000,
    25: 24000,
    26: 25000,
    27: 26000,
    28: 27000,
    29: 28000,
    30: 29000,
    31: 30000,
    32: 31000,
    33: 32000,
    34: 33000,
    35: 34000,
    36: 35000,
    37: 36000,
    38: 37000,
    39: 38000,
    40: 40000
};

const clan_refresh_XP_value = async(clan_id, clan_data, from) => {
    return new Promise(async resolve => {
        // console.log(clan_id, clan_data);

        let members = clan_data.members;
        let clan_XP = 0;

        for (const [_, member] of Object.entries(members)) {

            let member_XP = !member["XP"] ? 0 : member["XP"];
            clan_XP += await member_XP
        };

        let curr_clan_level = getClanLevel(clan_XP);
        let best_level = clan_data.best_level <= curr_clan_level ? curr_clan_level : clan_data.best_level;

        await database.pool.query(`update clans set XP = ? where id = ?`, [clan_XP, clan_id]);
        await database.pool.query(`update clans set level = ?, best_level = ? where id = ?`, [curr_clan_level, best_level, clan_id]);

        if (from != "init") {

            io.to(clan_data["room_id"]).emit("update_clan_XP_bar", clan_XP, curr_clan_level);
            resolve();
        };

        resolve();
    });
};

function getClanLevel(clan_XP) {
    let currentLevel = 1;

    for (let level in level_xp_requirement) {

        if (clan_XP >= level_xp_requirement[level]) {
            currentLevel = parseInt(level);
        } else {
            break;
        };
    };

    return currentLevel;
};

function findSocketById(socketList, id) {
    for (const socket of socketList) {
        if (socket.id === id) {
            return socket;
        };
    };

    return null;
};

async function request_game_to_start(Data) {
    try {
        const roomID = parseInt(Data[0]);
        const [x, y] = [Data[1], Data[2]];

        // request data from database
        const roomDataQuery = `select player2_name, thirdPlayer, player3_name, fieldTitle from roomdata where RoomID = ?`;
        const [roomData] = await database.pool.query(roomDataQuery, [roomID]);

        // If the lobby is full and the user confirmed his data 
        const room = io.sockets.adapter.rooms.get(roomID);
        const lobbySize = room?.size ?? 0;
        const { player2_name, thirdPlayer, player3_name, fieldTitle } = roomData[0];

        if (
            (lobbySize >= 2 && player2_name !== '' && thirdPlayer == 0) ||
            (lobbySize >= 3 && player2_name !== '' && player3_name !== '' && thirdPlayer == 1)
        ) {
            // Start the game
            await startGame(roomID, x, y, fieldTitle);
        };
    } catch (error) {
        console.error('Error starting game:', error);
    };
};

async function startGame(roomID, x, y, fieldTitle) {
    try {
        // Update room to show game is in progress and reset field options
        const options = Array(x * y).fill("");
        await database.pool.query(`update roomdata set isPlaying = 1, Fieldoptions = "", globalGameTimer = 0, Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), roomID]);

        // Fetch updated room data and start the game
        const [updatedRoomData] = await database.pool.query(`select * from roomdata where RoomID = ?`, [roomID]);

        // Initialize Eye Boss if necessary
        if (fieldTitle === "Merciful slaughter note: this code is not used currently. Do not touch without required knowleadge.") {
            await startEyeBoss(60, roomID);
        };

        // Initialize player timers
        await initializePlayerTimers(roomID);

        io.to(roomID).emit('StartGame', updatedRoomData);

        // Start sending the player timer updates
        startPlayerTimerUpdates(updatedRoomData, roomID);

    } catch (error) {
        console.error('Error during game setup:', error);
    };
};

// <<<<<<<<<<<<<<<< legacy code <<<<<<<<<<<<<<<<
async function startEyeBoss(interval, roomID) {
    try {
        await database.pool.query(`update roomdata set eyeAttackInterval = ? where RoomID = ?`, [interval, roomID]);
        await database.startEyeAttackInterval(roomID, `eyeAttackInterval_${roomID}`);
    } catch (error) {
        console.error('Error starting Eye Boss attack interval:', error);
    };
};
// <<<<<<<<<<<<<<< legacy code <<<<<<<<<<<<<<<

async function initializePlayerTimers(roomID) {
    await database.pool.query(`update roomdata set win_combinations = JSON_ARRAY(), p1_points = 0, p2_points = 0 where RoomID = ?`, [roomID]);
};

function startPlayerTimerUpdates(roomData, roomID) {
    if (!roomData || roomData?.length === 0 || !io.sockets.adapter.rooms.get(roomID)) return;

    // initializing player timer object and interval in room
    io.sockets.adapter.rooms.get(roomID).timerData = {
        currentPlayer: 1,
        initial_clock: roomData[0]?.PlayerTimer,
        player_clock: roomData[0]?.PlayerTimer,
    };

    io.sockets.adapter.rooms.get(roomID).intervalID = setInterval(async() => {
        try {
            let initial_clock = io.sockets.adapter.rooms.get(roomID).timerData.initial_clock;

            if(io.sockets.adapter.rooms.get(roomID).timerData.player_clock > 0) {
                io.sockets.adapter.rooms.get(roomID).timerData.player_clock -= 1;

            } else if(io.sockets.adapter.rooms.get(roomID).timerData.player_clock <= 0) {
                io.sockets.adapter.rooms.get(roomID).timerData.player_clock = initial_clock;

                // swap current player
                io.sockets.adapter.rooms.get(roomID).timerData.currentPlayer = io.sockets.adapter.rooms.get(roomID).timerData.currentPlayer == 1 ? 2 : 1;
                io.to(roomID).emit("EndOfPlayerTimer", io.sockets.adapter.rooms.get(roomID).timerData.currentPlayer);
            };

            if(io.sockets.adapter.rooms.get(roomID).timerData.currentPlayer == 1) {
                io.to(roomID).emit('playerTimer', io.sockets.adapter.rooms.get(roomID).timerData.player_clock, initial_clock, io.sockets.adapter.rooms.get(roomID).timerData.currentPlayer, 0);

            } else {
                io.to(roomID).emit('playerTimer', initial_clock, io.sockets.adapter.rooms.get(roomID).timerData.player_clock, io.sockets.adapter.rooms.get(roomID).timerData.currentPlayer, 0);
            };

        } catch (error) {
            console.error('Error during player timer updates:', error);
            clearInterval(io.sockets.adapter.rooms.get(roomID)?.intervalID);
        }
    }, 1000);
};

// paste this line in the interval code block for eye attack
// const {eyeAttackInterval} = roomData[0];
// const eyeAttackActive = eyeAttackInterval !== 1000;
// if (eyeAttackActive && eyeAttackInterval <= 0) {
//     await triggerEyeAttack(roomID);
// };

// async function triggerEyeAttack(roomID) {
//     await database.stopEyeAttackInterval(`eyeAttackInterval_${roomID}`);
//     await database.startEyeAttackInterval(roomID, `eyeAttackInterval_${roomID}`);
//     io.to(roomID).emit("EyeAttack");
// };
