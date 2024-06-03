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
    res.send('Secret server for complex toe from josef stips');
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

// Websocket 
io.on('connection', socket => {
    console.log('a user connected to the server ' + socket.id);

    // Check if the player was at least once in this app
    // if yes, pass some information. f.e the treasure countdown so it does not restart everytime the player opens the app
    io.to(socket.id).emit('CheckIfPlayerAlreadyExists');

    // Player already was in the game
    socket.on("PlayerAlreadyExists", async(PlayerID, treasureIsAvailible) => {
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

            // treasure is open but user doesn't opened it in his last log in
        } else if (treasureIsAvailible == "true") {
            return;
        };

        // update "last connection time" in database
        await database.Player_UpdateConnection(parseInt(PlayerID));
    });

    // Player is for the first time in the game
    socket.on("PlayerNotExisted", async() => {
        // create player by add a new row to the connection time: player id is auto_increment
        // return auto generated player id
        let [{ player_id: playerID }] = await database.createPlayer();

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
        console.log('user disconnected from the server ' + socket.id);

        // check if the disconnected socket belongs to a room and if yes which role he played in that room
        let data = await database.FindRoomBySocketID(socket.id);

        if (data[0] == undefined) return;

        // if it belongs to a room check which role he played and do the specified things
        if (data[0] == "admin") {
            // Delete the room from database
            kill_room(data[1].RoomID)

            // delete the room from the server and inform the other player (user) in the room about it
            io.to(data[1].RoomID).emit('INFORM_admin_left_room');

            // kicks out all player so the room gets deleted from the server
            io.socketsLeave(data[1].RoomID);

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
    socket.on("sendNameToDatabase", async(PlayerID, updatedName, updatedIcon, userInfoClass, userIncoColor) => {
        await database.PlayerUpdatesData(parseInt(PlayerID), updatedName, updatedIcon, userInfoClass, userIncoColor);
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
                socket.id, "", "", GameData[7], "", GameData[8], "", parseInt(GameData[0]), parseInt(GameData[0]), 1, GameData[12], GameData[13], GameData[14], GameData[15]);

            // Inform and update the page of all other people who are clients of the room about the name of the admin
            io.to(roomID).emit('Admin_Created_And_Joined', [GameData[3], GameData[4], GameData[7], GameData[9]]); // PlayerData[9] = third player as boolean

            return;

        } else {
            console.log("A room with this id already exists")
        };
    };

    // try to enter a room. If room exists, the player enters the room but still needs to confirm his user data
    socket.on('TRY_enter_room', async(GameID, callback) => { // the id the user parsed into the input field
        // check if room already exists
        let result = await database.pool.query(`select * from roomdata where RoomID = ?`, [parseInt(GameID)]);

        // check if the room allows a third player
        let result1 = await database.pool.query(`select thirdPlayer from roomdata where RoomID = ?`, [parseInt(GameID)]);
        let thirdPlayer;
        if (result1[0].length > 0) {
            thirdPlayer = result1[0][0].thirdPlayer;
        };

        // if room EXISTS
        if (result[0].length >= 1) { // check if room exists

            try {
                // check if the room is full. (over 2 player => full)
                if (io.sockets.adapter.rooms.get(parseInt(GameID)).size == 1 ||
                    // or second condition: the room is full but they need a blocker so the player can join as a blocker
                    io.sockets.adapter.rooms.get(parseInt(GameID)).size == 2 && thirdPlayer == 1) {
                    // join room
                    socket.join(parseInt(GameID));

                    // Game Data for the client
                    let result2 = await database.pool.query(`select xyCellAmount from roomdata where RoomID = ?`, [parseInt(GameID)]);
                    let result3 = await database.pool.query(`select PlayerTimer from roomdata where RoomID = ?`, [parseInt(GameID)]);
                    let result4 = await database.pool.query(`select InnerGameMode from roomdata where RoomID = ?`, [parseInt(GameID)]);
                    let result5 = await database.pool.query(`select player3_name from roomdata where RoomID = ?`, [parseInt(GameID)]);
                    let result6 = await database.pool.query(`select player2_name from roomdata where RoomID = ?`, [parseInt(GameID)]);
                    let [result7] = await database.pool.query(`select costumField from roomdata where RoomID = ?`, [parseInt(GameID)]);

                    let FieldSize = result2[0][0].xyCellAmount;
                    let PlayerTimer = result3[0][0].PlayerTimer;
                    let InnerGameMode = result4[0][0].InnerGameMode;
                    let Player3Name = result5[0][0].player3_name;
                    let Player2Name = result6[0][0].player2_name;
                    let costumField = result7[0].costumField;

                    // callback to client who wants to join:

                    // if three player are in the lobby, there is a third player allowed and there is a second player
                    if (io.sockets.adapter.rooms.get(parseInt(GameID)).size == 3 && thirdPlayer == 1 &&
                        Player3Name == '' && Player2Name != '') {
                        // send data to client who joined
                        callback(['room exists', GameID, FieldSize, PlayerTimer, InnerGameMode, "thirdplayer", costumField]);

                    } else { // if there are only 2 player in the lobby or a third player is not allowed or there is a third player but not a second player
                        // send data to client who joined
                        callback(['room exists', GameID, FieldSize, PlayerTimer, InnerGameMode, "secondplayer", costumField]);
                    };

                } else { // room is full
                    callback([`You can't join`]);
                };
            } catch (error) {
                callback(['no room found']);
                console.log(error);
            };

        } else { // room does not exists, alert user
            // callback to client who wants to join
            callback(['no room found']);
        };
    });

    // If the room existed, the user joined and setted up his data, this emit listener storages the data on the server
    // And it informs all player in the room about player 2 (user) and player 1 (admin)
    // data[0] = room id ; data[1] = player name ; data[2] = player icon
    socket.on('CONFIRM_enter_room', async(data, callback) => {
        // get required data from database
        let result = await database.pool.query(`select player1_name from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result1 = await database.pool.query(`select player1_icon from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result2 = await database.pool.query(`select player1_advancedIcon from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result3 = await database.pool.query(`select player1_IconColor from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result4 = await database.pool.query(`select thirdPlayer from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result5 = await database.pool.query(`select player3_name from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result6 = await database.pool.query(`select player2_name from roomdata where RoomID = ?`, [parseInt(data[0])]);

        let player1Name = result[0][0].player1_name;
        let player1Icon = result1[0][0].player1_icon;
        let player1_advancedIcon = result2[0][0].player1_advancedIcon;
        let player1_IconColor = result3[0][0].player1_IconColor;
        let thirdPlayer_bool = result4[0][0].thirdPlayer;
        let thirdPlayer_name = result5[0][0].player3_name;
        let player2_name = result6[0][0].player2_name;

        // Check if users name is equal to admins name or to the third Player's name
        if (player2_name == "") { // second player wants to join
            if (data[1] == player1Name || data[1] == thirdPlayer_name) {
                callback('Choose a different name!');
                return;
            };

            // Check if users icon is equal to admins icon
            if (data[2].toUpperCase() == player1Icon.toUpperCase() && data[3] == "empty" || data[3] == player1_advancedIcon && data[3] != "empty") {
                callback('Choose a different icon!');
                return;
            };

        } else if (thirdPlayer_name == "") { // third player wants to join
            if (data[1] == player2_name || data[1] == player1Name) {
                callback('Choose a different name!');
                return;
            };
        };

        // console.log(player1Name, player1Icon, player1_advancedIcon, player1_IconColor, thirdPlayer_bool, thirdPlayer_name);
        // console.log(data[5]);

        if (data[5] == "user") {
            // save data about user in database
            // The 'role' is already declared when the room was created by the admin so it is not here
            database.UserJoinsRoom(parseInt(data[0]), data[1], data[2], socket.id, data[3], data[4]); // name, icon, socket.id, advancedIcon, iconColor

            // updates the html of all players in the room with the name and data of the second player
            io.to(parseInt(data[0])).emit('SecondPlayer_Joined', [data[1], data[2], data[3], data[4], thirdPlayer_bool, thirdPlayer_name, player1Name]); // second parameter => icon of second player

        } else if (data[5] == "blocker") {
            // save data in object
            // The 'role' is already declared when the room was created by the admin
            database.BlockerJoinsRoom(parseInt(data[0]), data[1], socket.id);

            // updates the html of all players in the room with the name and data of the third player
            io.to(parseInt(data[0])).emit('ThirdPlayer_Joined', [data[1], data[2], data[3], data[4], thirdPlayer_bool]); // second parameter => icon of second player
        };

        callback([data[1], player1Name, player1Icon, data[2], data[3], player1_advancedIcon, player1_IconColor]);
    });

    // the third player (blocker) joins the lobby and requests the data for the second player so he can see it
    socket.on('thirdplayer_requests_SecondPlayerData', async(data) => { // data[0] = game id
        // request data from database
        let result = await database.pool.query(`select player2_name from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result1 = await database.pool.query(`select player2_icon from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result2 = await database.pool.query(`select player2_advancedIcon from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let result3 = await database.pool.query(`select player2_IconColor from roomdata where RoomID = ?`, [parseInt(data[0])]);

        // name from first player
        let row = await database.pool.query(`select player1_name from roomdata where RoomID = ?`, [parseInt(data[0])]);
        let FirstPlayerName = row[0][0].player1_name;

        let firstplayerData_name = result[0][0].player2_name // user name
        let firstplayerData_icon = result1[0][0].player2_icon // user icon
        let firstplayerData_advanced_icon = result2[0][0].player2_advancedIcon // user advanced skin, if he doesn't have one it displays "empty" so his shoosed letter
        let firstplayerData_icon_color = result3[0][0].player2_IconColor // skin color of user

        // updates the html of all players in the room with the name and data of the second player
        io.to(parseInt(data[0])).emit('SecondPlayer_Joined', [firstplayerData_name, firstplayerData_icon,
            firstplayerData_advanced_icon, firstplayerData_icon_color, false, "thirdPlayer_RequestsData", FirstPlayerName
        ]); // second parameter => icon of second player
    });

    // admin wants to start the game
    socket.on('request_StartGame', async(Data) => {
        try {
            // request data from database
            let player2_name = await database.pool.query(`select player2_name from roomdata where RoomID = ?`, [parseInt(Data[0])]);
            let thirdPlayer = await database.pool.query(`select thirdPlayer from roomdata where RoomID = ?`, [parseInt(Data[0])]);
            let player3_name = await database.pool.query(`select player3_name from roomdata where RoomID = ?`, [parseInt(Data[0])]);

            // If the lobby is full and the user confirmed his data 
            if (io.sockets.adapter.rooms.get(parseInt(Data[0])).size >= 2 && player2_name[0][0].player2_name != '' &&
                thirdPlayer[0][0].thirdPlayer == 0 ||
                // or: second condition where third player (blocker) is required
                io.sockets.adapter.rooms.get(parseInt(Data[0])).size >= 3 && player2_name[0][0].player2_name != '' &&
                player3_name[0][0].player3_name != '' && thirdPlayer[0][0].thirdPlayer == 1) { // Data[0] = room id

                // Set the global variable "isPlaying" to true to say that the users in this room are currently in a game
                await database.pool.query(`update roomdata set isPlaying = 1 where RoomID = ?`, [parseInt(Data[0])]);
                // In online mode there is only one "options" array that represents the game field for all users in the game
                // Because of that, the "options" arrays needs to be created in the server and not locally in the "Game.js" file
                await database.pool.query(`update roomdata set Fieldoptions = "" where RoomID = ?`, [parseInt(Data[0])]); // reset 

                // create global game options
                let options = [];
                for (i = 0; i < Data[1] * Data[1]; i++) { // Data[1] = xyCell_Amount , 5, 10, 15, 20 etc.
                    options.push("");
                };
                // parse in the data into the database
                await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(Data[0])]);

                // set the global timer to default again in the database
                await database.pool.query(`update roomdata set globalGameTimer = 0 where RoomID = ?`, [parseInt(Data[0])]);

                // request whole data from the room in the database
                let Roomdata = await database.pool.query(`select * from roomdata where RoomID = ?`, [parseInt(Data[0])]);

                // check if the players are playing with the eye boss. The eye has an interval (he attacks every minute)
                if (Roomdata[0][0].fieldTitle == "Merciful slaughter note: this is code is not used currently. Do not touch without required knowleadge.") {
                    // initialize eye counter in database (give it a value)
                    await database.pool.query(`update roomdata set eyeAttackInterval = 60 where roomID = ?`, [parseInt(Data[0])]);
                    // start eye attack interval
                    await database.startEyeAttackInterval(parseInt(Data[0]), `eyeAttackInterval_${Data[0]}`);

                } else {
                    await database.pool.query(`update roomdata set eyeAttackInterval = 1000 where roomID = ?`, [parseInt(Data[0])]);
                };

                // sends all room data (game, player) to both clients so everything in the game is the same and synchronised
                io.to(parseInt(Data[0])).emit('StartGame', Roomdata[0]);

                // start player clock for the first player
                await database.StartPlayerClock(`player1_timer_event_${Data[0]}`, parseInt(Data[0]), "player1_timer", 1);

                // send the time every second to the player so they can see how much time they have obviously
                let PlayerTimeRequestInterval = setInterval(async() => {
                    try {
                        // request player timers and the current player timer from database
                        var results = await database.pool.query(`select player1_timer , player2_timer, currentPlayer, eyeAttackInterval, PlayerTimer from roomdata where RoomID = ?;`, [parseInt(Data[0])]);

                    } catch (error) {
                        console.log(error);
                    };

                    try {
                        // request from database if they are still in the game
                        var result = await database.pool.query(`select isPlaying from roomdata where RoomID = ?`, [parseInt(Data[0])]);
                        var isPlaying = result[0][0].isPlaying;

                    } catch (error) {
                        console.log(error);
                    };

                    // If the players don't play anymore
                    if (isPlaying == 0) {
                        console.log("quit game");
                        // drop "interval" from database
                        await database.DeletePlayerClocks(`player1_timer_event_${Data[0]}`, `player2_timer_event_${Data[0]}`);
                        await database.stopEyeAttackInterval(`eyeAttackInterval_${Data[0]}`); // for eye boss if exists
                        // delete interval to stop sending messages to the client
                        clearInterval(PlayerTimeRequestInterval);
                        PlayerTimeRequestInterval = null;
                    };
                    // console.log(results, results[0][0]);

                    // if a result exists
                    if (results.length > 0) {
                        let player1Timer;
                        let player2Timer;
                        let currentPlayer;
                        let eyeAttackInterval;
                        let eyeAttackInterval_bool = false;
                        let attack = false;
                        let PlayerTimer;
                        // console.log(eyeAttackInterval, "eye Attack Interval")

                        try {
                            player1Timer = results[0][0].player1_timer;
                            player2Timer = results[0][0].player2_timer;
                            currentPlayer = results[0][0].currentPlayer;
                            eyeAttackInterval = results[0][0].eyeAttackInterval;
                            PlayerTimer = results[0][0].PlayerTimer;

                            PlayerTimer--;

                            if (eyeAttackInterval != 1000) {
                                eyeAttackInterval_bool = true;
                            } else {
                                eyeAttackInterval_bool = false;
                            };

                        } catch (error) {
                            console.log("quit game: " + error);
                            // drop "interval" from database
                            await database.DeletePlayerClocks(`player1_timer_event_${Data[0]}`, `player2_timer_event_${Data[0]}`);
                            await database.stopEyeAttackInterval(`eyeAttackInterval_${Data[0]}`); // for eye boss if exists

                            // delete interval to stop sending messages to the client
                            clearInterval(PlayerTimeRequestInterval);
                            PlayerTimeRequestInterval = null;
                        };

                        // ---------------- all players recieve player timer directly from database ----------------
                        io.to(parseInt(Data[0])).emit('playerTimer', player1Timer, player2Timer, currentPlayer);

                        // console.log(player1Timer, player2Timer, currentPlayer, eyeAttackInterval, eyeAttackInterval_bool);

                        // check if timer for first or second player ended
                        if (currentPlayer == 2 && player2Timer <= 0 || PlayerTimer <= 0) { // second player timer finished
                            io.to(parseInt(Data[0])).emit("EndOfPlayerTimer");

                            await database.DeletePlayerClocks(`player1_timer_event_${Data[0]}`, `player2_timer_event_${Data[0]}`);
                            // change current player
                            await database.pool.query(`update roomdata set currentPlayer = 1 where RoomID = ?`, [parseInt(Data[0])]);

                            // setTimeout(async() => {
                            await database.StartPlayerClock(`player1_timer_event_${Data[0]}`, parseInt(Data[0]), "player1_timer", 1);
                            // }, 1000);

                        };

                        if (currentPlayer == 1 && player1Timer <= 0 || PlayerTimer <= 0) { // first player timer finished
                            io.to(parseInt(Data[0])).emit("EndOfPlayerTimer");

                            await database.DeletePlayerClocks(`player1_timer_event_${Data[0]}`, `player2_timer_event_${Data[0]}`);
                            // change current player
                            await database.pool.query(`update roomdata set currentPlayer = 2 where RoomID = ?`, [parseInt(Data[0])]);

                            // setTimeout(async() => {
                            await database.StartPlayerClock(`player2_timer_event_${Data[0]}`, parseInt(Data[0]), "player2_timer", 2);
                            // }, 1000);
                        };

                        // for eye attack ---------------------------------------
                        if (eyeAttackInterval <= 0) {
                            attack = true;
                        } else attack = false;

                        if (eyeAttackInterval_bool && attack) {
                            eyeAttackInterval = 60;
                            attack = false;
                            await database.stopEyeAttackInterval(`eyeAttackInterval_${Data[0]}`);
                            await database.startEyeAttackInterval(parseInt(Data[0]), `eyeAttackInterval_${Data[0]}`);

                            io.to(parseInt(Data[0])).emit("EyeAttack");
                        };

                        if (eyeAttackInterval_bool) io.to(parseInt(Data[0])).emit("EyeAttackInterval", eyeAttackInterval);
                        // -------------------------------------------------------
                    };

                }, 1000);
            };
        } catch (error) {
            console.log(error);
        };
    });

    // same cell blocker for everyone in the game room1
    function single_CellBlock(cells, cellIndex) {
        cells[cellIndex] = '§';
    };

    socket.on("activateEyeDamage", async(id, cellDistance) => {
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
    socket.on('user_left_lobby', async(user, roomID, callback) => {
        try {
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
                    io.to(roomID).emit('killed_game');

                    // They do not play anymore
                    await database.pool.query(`update roomdata set isPlaying = 0 where RoomID = ?`, [parseInt(roomID)]);

                    // stop and delete the intervals (player clocks) in the database 
                    await database.DeletePlayerClocks(`player1_timer_event_${roomID}`, `player2_timer_event_${roomID}`); // delete them if they exists
                    await database.stopEyeAttackInterval(`eyeAttackInterval_${roomID}`); // for eye boss if exists
                    return;
                };

                // if they are still in the lobby and the admin leaves
                if (isPlaying == 0) {
                    // send a function to the other person of the room so their html updates properly
                    io.to(roomID).emit('killed_room');

                    // Room gets deleted from the database
                    kill_room(parseInt(roomID));

                    // kicks out all player so the room gets deleted from the server
                    io.socketsLeave(roomID);

                    // callback to frontend
                    callback('You killed the lobby');
                };

            } else if (user == 'user') { // user kicks himself from the lobby
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
            data[2][Index] = '%%';
        };

        // update global options array
        await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(data[2]), parseInt(data[0])]);
        let Fieldoptions = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(data[0])]);

        // send modified global options array to every client in room
        io.to(parseInt(data[0])).emit('recieveGlobalOptions', JSON.parse(Fieldoptions[0][0].Fieldoptions));
    });

    // Just a small thing so all '%%' character from the global options array are getting deleted
    socket.on('BoneyardFinalProcess', async id => {
        let Fieldoptions = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(id)]);

        let options = JSON.parse(Fieldoptions[0][0].Fieldoptions);
        for (let i = 0; i < options.length; i++) {
            options[i] = '';
        };

        await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(id)]);
    });

    // Only the admin can reload the game
    // When he reloads, a message to all clients gets send
    socket.on('Reload_OnlineGame', async(id, xyCellAmount) => {
        // set the global timer to default again
        await database.pool.query(`update roomdata set globalGameTimer = 0 where RoomID = ?`, [parseInt(id)]);

        // reset options
        await database.pool.query(`update roomdata set Fieldoptions = "" where RoomID = ?`, [parseInt(id)]);

        // create global game options
        let options = [];
        for (i = 0; i < xyCellAmount * xyCellAmount; i++) {
            options.push("");
        };

        await database.pool.query(`update roomdata set Fieldoptions = ? where RoomID = ?`, [JSON.stringify(options), parseInt(id)]);
        let Fieldoptions = await database.pool.query(`select Fieldoptions from roomdata where RoomID = ?`, [parseInt(id)]);

        // delete previous intervals
        await database.DeletePlayerClocks(`player1_timer_event_${id}`, `player2_timer_event_${id}`);
        await database.stopEyeAttackInterval(`eyeAttackInterval_${id}`); // for eye boss if exists
        // start 
        await database.StartPlayerClock(`player1_timer_event_${id}`, parseInt(id), 'player1_timer', 1);
        if (xyCellAmount == 40) await database.startEyeAttackInterval(parseInt(id), `eyeAttackInterval_${id}`); // for eye boss if exists

        // send message to all clients and updated options array
        io.to(parseInt(id)).emit('Reload_GlobalGame', JSON.parse(Fieldoptions[0][0].Fieldoptions));
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

    // user requests player timer to display => reset timer
    socket.on("Request_Players_timer", async(GameID, playerN_timer_event, playerN_timer, playerInNumber, currPlayer) => {

        // delete previous intervals
        await database.DeletePlayerClocks(`player1_timer_event_${GameID}`, `player2_timer_event_${GameID}`);

        // start 
        await database.StartPlayerClock(`${playerN_timer_event}_${GameID}`, GameID, playerN_timer, playerInNumber);

        io.to(parseInt(GameID)).emit('changePlayerTurnDisplay', currPlayer);
    });

    // user wants to stop the player timers
    socket.on("stop_Players_timer", async GameID => {
        // delete previous intervals
        await database.DeletePlayerClocks(`player1_timer_event_${GameID}`, `player2_timer_event_${GameID}`);
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
        await database.DeletePlayerClocks(`player1_timer_event_${id}`, `player2_timer_event_${id}`);

        // send neccesary data to all clients in lobby
        io.to(parseInt(id)).emit('global_UltimateWin', data[0], data[1], data[2], data[3], data[4]);
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
    socket.on('Lobby_ChangeGameData', (id, display, SpecificData, Selection) => {
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
        await database.pool.query(`update roomdata set pointsToWin = ? where RoomID = ?`, [parseInt(value), parseInt(id)]);

        io.to(parseInt(id)).emit("AdminChanged_PointsToWin", value);
    });

    // user who joins the lobby wants to know how many points are required to win a game
    socket.on("Request_PointsToWin", async(id, cb) => {
        let PointsToWin = await database.pool.query(`select pointsToWin from roomdata where RoomID = ?`, [parseInt(id)]);
        cb(PointsToWin[0][0].pointsToWin);
    });

    // user requests the allowed patterns so they display on the lobby for him
    socket.on("Request_AllowedPatterns", async(id, cb) => {
        let WinPatterns = await database.pool.query(`select win_patterns from roomdata where RoomID = ?`, [parseInt(id)]);
        cb(JSON.parse(WinPatterns[0][0].win_patterns));
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
        cb(await getDataById(id));
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
        let [result] = await database.pool.query(`select * from clans where name = ?`, [query]);

        cb(result);
    });

    // automatic: user gets a proposal of popular clans
    socket.on("popular_clans", async(cb) => {
        let [rows] = await database.pool.query(`select * from clans`);

        cb(rows);
    });

    socket.on("join_clan", async(player_id, cb) => {

    });

    socket.on("leave_clan", async(player_id, cb) => {

    });

    socket.on("kick_member", async(member_id, clan_id) => {

    });

    socket.on("promote_member", async(member_id, clan_id) => {

    });

    socket.on("create_clan", async(clan_name, clan_logo, clan_description, player_id, cb) => {
        let hash = create_hash_id(clan_name);

        let [row] = await database.pool.query(`select * from players where player_id = ?`, [player_id]);
        let [serverStatus, insertId] = await database.CreateClan(clan_name, clan_logo, clan_description, row[0], hash, cb);

        if (serverStatus == 2) {
            let [rows] = await database.pool.query(`select * from clans where id = ?`, [insertId]);
            cb(rows[0]);

        } else {
            cb(null);
        };
    });

    socket.on("get_clan_data", async(clan_id, cb) => {
        console.log(clan_id);
        let [row] = await database.pool.query(`select * from clans where id = ?`, [clan_id]);
        cb(row[0]);
    });

    socket.on("playground_player_moves", (player_id, coords) => {});

    socket.on("pass_clan_message", async(text, player_id, clan_id, cb) => {
        console.log(text, player_id, clan_id);

        let [results] = await database.pool.query('SELECT * FROM clans WHERE id = ?', [clan_id]);
        let chat = results[0].chat;
        let author_role = results[0].members[player_id]["role"];

        const newMessage = {
            message: text,
            from: player_id,
            date: moment(new Date()).format('MMMM D, YYYY, h:mm A'),
            role: author_role
        };

        if (chat === null) chat = [];
        chat.push(newMessage);

        let [ResultSetHeader] = await database.pool.query(`update clans set chat = ? where id = ?`, [
            JSON.stringify(chat), clan_id
        ]);


        let player_data = await getDataById(player_id);
        cb(chat, player_data, author_role);
    });
});

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

// generates ID for the room
const createID = (min, max) => { let = roomID = Math.floor(Math.random() * (max - min + 1)) + min; return roomID; };

// player kills room which he created before
const kill_room = async(id) => {
    // check if room exists
    let roomData = await database.pool.query(`select * from roomdata where RoomID = ?`, [id]);

    // delete room from database if room exists
    if (roomData[0].length > 0) {
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
    let [row] = await database.pool.query(`select * from players where player_id = ?`, [id]);
    return row[0];
};