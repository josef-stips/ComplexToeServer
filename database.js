const mysql = require('mysql2');
const dotenv = require('dotenv');
dotenv.config();

const pool = mysql.createPool({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE,
    connectionLimit: process.env.DATABASE_CONNECTION_LIMIT,
    waitForConnections: true,
    queueLimit: 0
}).promise();

// get all players
async function getPlayers() {
    const [rows] = await pool.query(`select * from players`);
    return rows;
};

// create new player id
async function createPlayer() {
    // when a completely new player joins the game -> add his connection time: now() (datetime)
    // "player id" is auto_increment so an id for this player generates automatically
    await Player_lastConnection();

    let [id] = await pool.query(`select player_id from players order by player_id DESC LIMIT 1;`);
    return id;
};

// last connection of player 
async function Player_lastConnection() {
    let sql = ` insert into players (last_connection) values (now());`;
    await pool.query(sql);
};

// update last connection of player 
async function Player_UpdateConnection(PlayerID) {
    let sql = ` update players set last_connection = now() where player_id = ?;`;
    await pool.query(sql, [PlayerID]);
};

// when the player OPENS the TREASURE for the FIRST TIME, the 24 hour countdown needs to be created in the database table. table name: timer
async function createTimeStamp(player_id) { // player_id = player_id from players table
    let sql = `INSERT INTO timer (id, end_time)
    VALUES (? ,NOW() + INTERVAL 24 HOUR);`

    pool.query(sql, [player_id]);
};

// when the player opens the treasure not for the first time, the countdown (or interval) needs to be updated
async function updateTimeStamp(player_id) {
    let sql = `UPDATE timer SET end_time = NOW() + INTERVAL 24 HOUR WHERE id = ?;`;
    pool.query(sql, [player_id]);
};

// when an existing player joins the game: check if the 24 hour countdown is already done
async function checkIfCountDown(id) {
    if (!isNaN(id)) {
        // check if countdown is done
        let sql = `SELECT * FROM timer WHERE end_time <= NOW() and id = ?;`;

        // answer from database
        let answer = await pool.query(sql, [id]);
        return answer;
    };
};

// return timestamp when the treasure is availible again
async function getTreasure_TimeStamp(player_id) {
    return pool.query(`select end_time from timer where id = ?;`, [player_id]);
};

// user updates his name or creates one. this name needs to be stored in 'players' table
async function PlayerUpdatesData(player_id, newName, newIcon, playerInfoClass, playerInfoColor) {
    await pool.query(`update players set player_name = ? where player_id = ?`, [newName, player_id]);
    await pool.query('update players set player_icon = ? where player_id = ?', [newIcon, player_id]);
    await pool.query(`update players set playerInfoClass = ? where player_id = ?`, [playerInfoClass, player_id]);
    await pool.query('update players set playerInfoColor = ? where player_id = ?', [playerInfoColor, player_id]);
};

// player creates room
async function CreateRoom(id, xyCellAmount, InnerGameMode, playerTimer, fieldoptions, globalGameTimer, isPlaying, fieldIndex, fieldTitle,
    thirdPlayer, pointsToWin, win_patterns, playerAmount, player1_name, player2_name, player3_name, player1_icon, player2_icon, player1_role, player2_role, player3_role,
    player1_socketID, player2_socketID, player3_socketID, player1_advancedIcon, player2_advancedIcon, player1_IconColor, player2_IconColor, player1_timer, player2_timer, currentPlayer) {

    try {
        pool.query(`insert into roomdata (RoomID, xyCellAmount, InnerGameMode, PlayerTimer, fieldoptions,globalGameTimer ,isPlaying ,fieldIndex ,fieldTitle,
                thirdPlayer,pointsToWin,win_patterns,players,player1_name,player2_name,player3_name,player1_icon,player2_icon,player1_role ,player2_role ,player3_role ,player1_socketID ,
                player2_socketID ,player3_socketID ,player1_advancedIcon ,player2_advancedIcon ,player1_IconColor ,player2_IconColor ,player1_timer,player2_timer,currentPlayer
                ) 
        
                values (?, ?, ?, ?, ?, ?, ?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?, ?)`,

            [id, xyCellAmount, InnerGameMode, playerTimer, fieldoptions, globalGameTimer, isPlaying, fieldIndex, fieldTitle,
                thirdPlayer, pointsToWin, win_patterns, playerAmount, player1_name, player2_name, player3_name, player1_icon, player2_icon, player1_role, player2_role, player3_role,
                player1_socketID, player2_socketID, player3_socketID, player1_advancedIcon, player2_advancedIcon, player1_IconColor, player2_IconColor, player1_timer, player2_timer, currentPlayer
            ]
        );
    } catch (error) {
        console.error(error);
    };
};

// admin deletes room by leaving
async function DeleteRoom(id) {
    try {
        pool.query(`delete from roomdata where roomID = ?`, [id]);

    } catch (error) {
        console.error(error);
    };
};

// start player clock for the first/second player
async function StartPlayerClock(eventName, id, currPlayerTimer, currentPlayerNumber) {
    // request the Player Clock starting second (ex. 70,50,30,15,5) from the room data 
    let MaxTimerValue;
    try {
        let results = await pool.query(`select PlayerTimer from roomdata where RoomID = ?`, [id]);
        MaxTimerValue = results[0][0].PlayerTimer;
    } catch (error) {
        console.log(error);
    };

    // reset the both timer
    let sql = `update roomdata set player1_timer = ?, player2_timer = ? where RoomID = ?`;
    await pool.query(sql, [MaxTimerValue, MaxTimerValue, id]);

    // Aktuelle Zeit als Startzeit für das MySQL-Event (+ 2 Stunden, wie in Ihrem Code)
    let currentDateTime = new Date();

    // Endzeit für das MySQL-Event berechnen, indem MaxTimerValue Sekunden zur aktuellen Zeit hinzugefügt werden
    let formattedEndDateTime = new Date();
    formattedEndDateTime.setSeconds(formattedEndDateTime.getSeconds() + MaxTimerValue);

    currentDateTime.setHours(currentDateTime.getHours() + 1);
    formattedEndDateTime.setHours(formattedEndDateTime.getHours() + 1);

    // Ausgabe von Start- und Endzeit
    console.log(currentDateTime.toISOString().slice(0, 19).replace('T', ' '), formattedEndDateTime.toISOString().slice(0, 19).replace('T', ' '));

    // create "interval"
    const connection = await pool.getConnection();
    try {
        await connection.query(`
            CREATE EVENT IF NOT EXISTS ${eventName}

            ON SCHEDULE EVERY 1 SECOND STARTS '${currentDateTime.toISOString().slice(0, 19).replace('T', ' ')}' ENDS '${formattedEndDateTime.toISOString().slice(0, 19).replace('T', ' ')}'
 
            DO BEGIN

                UPDATE roomdata
                SET ${currPlayerTimer} = GREATEST(${currPlayerTimer} - 1, 0),
                    currentPlayer = CASE WHEN ${currPlayerTimer} <= 0 THEN ${currentPlayerNumber} ELSE ${currentPlayerNumber} END
                WHERE RoomID = ${id};
                
            END
        `);
    } catch (error) {
        console.error(error);
    } finally {
        connection.release();
    };
};

// when game gets killed: stop both player1_timer event scheduler and the second one
async function DeletePlayerClocks(eventName1, eventName2) {
    let connection = pool.getConnection();
    try {
        (await connection).query(`drop event if exists ${eventName1}`);
        (await connection).query(`drop event if exists ${eventName2}`);
    } catch (error) {
        console.log(error)
    } finally {
        (await connection).release();
    };
};

// user joins the lobby => all data from the user needs to be added now
async function UserJoinsRoom(GameID, UserName, icon, socketID, advancedIcon, IconColor) {
    await pool.query(`update roomdata set player2_name = ?, player2_icon = ?, player2_socketID = ?, player2_advancedIcon = ?, player2_IconColor = ? where RoomID = ?`, [UserName, icon, socketID, advancedIcon, IconColor, GameID]);
};

// third user (role: blocker) join the lobby => all data from the blocker needs to be added now
async function BlockerJoinsRoom(GameID, BlockerName, socketID) {
    await pool.query(`update roomdata set player3_name = ?, player3_socketID = ? where RoomID = ?`, [BlockerName, socketID, GameID]);
};

// user leaves the lobby => all data from the user needs to be reseted now
async function UserLeavesRoom(GameID) {
    await pool.query(`update roomdata set player2_name = "", player2_icon = "", player2_socketID = "", player2_advancedIcon = "", player2_IconColor = "" where RoomID = ?`, [GameID]);
};

// third user (role: blocker) leaves the lobby => all data from the blocker needs to be reseted now
async function BlockerLeavesRoom(GameID) {
    await pool.query(`update roomdata set player3_name = "", player3_socketID = "" where RoomID = ?`, [GameID]);
};

// start eye attack interval
async function startEyeAttackInterval(GameID, eventName) {
    await pool.query(`update roomdata set eyeAttackInterval = 60 where roomID = ?`, [parseInt(GameID)]);

    // create "interval" for eye attack so it is synchronous in all clients
    const connection = await pool.getConnection();
    try {
        await connection.query(`
                CREATE EVENT IF NOT EXISTS ${eventName}
                ON SCHEDULE EVERY 1 SECOND
                DO
                BEGIN
                    DECLARE current_attackInterval_${GameID} INT;
    
                    SELECT eyeAttackInterval INTO current_attackInterval_${GameID} FROM roomdata WHERE roomID = ${GameID};
    
                    IF current_attackInterval_${GameID} > 0 THEN
                        UPDATE roomData
                        SET eyeAttackInterval = GREATEST(eyeAttackInterval - 1, 0)
                        WHERE RoomID = ${GameID};
                    ELSE
                        DROP EVENT IF EXISTS ${eventName};
                    END IF;
                END
            `);
    } catch (error) {
        console.error(error);
    } finally {
        connection.release();
    };
};

// stop eye attack interval when it reaches its end and the eye attacks
async function stopEyeAttackInterval(eventName) {
    let connection = pool.getConnection();
    try {
        (await connection).query(`drop event if exists ${eventName}`);
    } catch (error) {
        console.log(error)
    } finally {
        (await connection).release();
    };
};

// Find room by socket id and check which role that socketID had in that room
// If the socketID belongs to no room so nothing could be found, everything is okay and nothing needs to do
async function FindRoomBySocketID(socketID) {
    // check if the socketID that disconnected is the admin
    let results1 = await pool.query(`select * from roomdata where player1_socketID = ?`, [socketID]);
    let results2 = await pool.query(`select * from roomdata where player2_socketID = ?`, [socketID]);
    let results3 = await pool.query(`select * from roomdata where player3_socketID = ?`, [socketID]);

    console.log(results1);
    console.log(results2);
    console.log(results3);

    if (results1[0].length > 0) { // socket is admin in a room
        let roomData = results1[0][0];

        console.log(roomData)
        return ["admin", roomData];

    } else if (results2[0].length > 0) { // socket is user in a room
        let roomData = results2[0][0];

        return ["user", roomData];

    } else if (results3[0].length > 0) { // socket is blocker in a room
        let roomData = results3[0][0];

        return ["blocker", roomData];

    } else { // socket was in no room
        console.log(`disconnected socket: ${socketID} is in no room`);
        return [];
    };
};

// updates game data when admin changes something in lobby
async function UpdateGameData(id, xyCellAmount, InnerGameMode, PlayerTimer, fieldIndex, fieldTitle) {
    await pool.query(`update roomdata set xyCellAmount = ?,InnerGameMode = ?, PlayerTimer = ?, fieldIndex = ?, fieldTitle = ? where RoomID = ?`, [parseInt(xyCellAmount), InnerGameMode, parseInt(PlayerTimer), parseInt(fieldIndex), fieldTitle, parseInt(id)]);
};

// User submits or creates new quote
const NewPlayerProfileQuote = async(quote, player_id) => {
    await pool.query('update players set quote = ? where player_id = ?', [quote, player_id]);
};

// Update all user data to database as quick fix
const UpdateAllUserData = async(player_name, player_icon, playerInfoClass, playerInfoColor, quote, onlineGamesWon, XP, current_used_skin, player_id, commonPattern) => {
    await pool.query(`update players set player_name = ?, player_icon = ?, playerInfoClass = ?, playerInfoColor = ?, quote = ?, onlineGamesWon = ?, 
    XP = ?, currentUsedSkin = ?, commonPattern = ? where player_id = ?`, [player_name, player_icon, playerInfoClass, playerInfoColor, quote, onlineGamesWon, XP, current_used_skin, commonPattern, player_id]);
};

// search a player in player table with an id or name
const SearchPlayers = async(text) => {
    let result;

    if (isNaN(text)) { // is a text (name of player)
        [result] = await pool.query(`select * from players where player_name = ? `, [text]);

    } else { // is a number (id of player)
        [result] = await pool.query(`select * from players where player_id = ? `, [text]);
    };

    return result;
};

// save new level from player in database
const SaveNewLevel = async(id, levelData) => {
    // Check if level already exists and only needs to be overwritten
    if (levelData.id != 0) {
        // overwrite already existing level in database with given id
        let [rows] = await pool.query(`update levels set level_status = ?, field = ?, level_name = ?, creator_id = ?, bg_music = ?, bg1 = ?, bg2 = ?, required_points = ?,
        player_timer = ?, icon = ?, pattern = ?, costum_patterns = ?, costum_field = ? where id = ?`, [levelData.status, levelData.cellgrid, levelData.name, parseInt(id), levelData.bgmusic, levelData.bgcolor1, levelData.bgcolor2, levelData.requiredpoints, levelData.playertimer,
            levelData.levelicon, JSON.stringify(levelData.allowedpatterns), JSON.stringify(levelData.costumPatterns), JSON.stringify(levelData.costumField), levelData.id
        ]);

        console.log(rows, levelData.id);
        return levelData.id;

    } else {
        // get current date
        let [date] = await pool.query(`select current_date`);

        // write complete new level in database and generate new id
        let [rows] = await pool.query(`insert into levels (level_status, field, level_name, creator_id, bg_music, bg1, bg2, required_points, player_timer, icon, pattern, creation_date, costum_patterns, costum_field) values 
        (?,?,?,?,?,?,?,?,?,?,?,?,?, ?)`, [levelData.status, levelData.cellgrid, levelData.name, parseInt(id), levelData.bgmusic, levelData.bgcolor1, levelData.bgcolor2, levelData.requiredpoints, levelData.playertimer,
            levelData.levelicon, JSON.stringify(levelData.allowedpatterns), JSON.stringify(date[0]["current_date"]), JSON.stringify(levelData.costumPatterns), JSON.stringify(levelData.costumField)
        ]);

        console.log(rows);
        return rows.insertId; // unique id of the level
    };
};

// try to log functions
async function main() {
    try {
        const players = await checkIfCountDown();
        console.log(players)

    } catch (err) {
        console.log("an error while loading the players occured: " + err);
    };
};
// main();

// export database functions
module.exports = {
    createPlayer: createPlayer,
    getPlayers: getPlayers,
    createTimeStamp: createTimeStamp,
    updateTimeStamp: updateTimeStamp,
    checkIfCountDown: checkIfCountDown,
    getTreasure_TimeStamp: getTreasure_TimeStamp,
    PlayerUpdatesData: PlayerUpdatesData,
    Player_UpdateConnection: Player_UpdateConnection,
    CreateRoom: CreateRoom,
    DeleteRoom: DeleteRoom,
    StartPlayerClock: StartPlayerClock,
    pool: pool,
    DeletePlayerClocks: DeletePlayerClocks,
    UserLeavesRoom: UserLeavesRoom,
    BlockerLeavesRoom: BlockerLeavesRoom,
    FindRoomBySocketID: FindRoomBySocketID,
    UserJoinsRoom: UserJoinsRoom,
    BlockerJoinsRoom: BlockerJoinsRoom,
    UpdateGameData: UpdateGameData,
    startEyeAttackInterval: startEyeAttackInterval,
    stopEyeAttackInterval: stopEyeAttackInterval,
    NewPlayerProfileQuote: NewPlayerProfileQuote,
    UpdateAllUserData: UpdateAllUserData,
    SearchPlayers: SearchPlayers,
    SaveNewLevel
};