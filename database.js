const mysql = require('mysql2');
const dotenv = require('dotenv');
const moment = require('moment');

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
    await Player_add_default_value();

    let [id] = await pool.query(`select player_id from players order by player_id DESC LIMIT 1;`);
    return id;
};

// last connection of player 
async function Player_add_default_value() {
    // create new row with last_connection and default clan_data
    let sql = ` insert into players (last_connection, clan_data) values 
    (now(), 
    json_object("is_in_clan", false, "clan_id", null, "role", null)
    );`;

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
    try {
        await pool.query(`UPDATE players 
            SET player_name = ?, 
                player_icon = ?, 
                playerInfoClass = ?, 
                playerInfoColor = ? 
            WHERE player_id = ?`, [newName, newIcon, playerInfoClass, playerInfoColor, player_id]);

        return 'success'; // Erfolgreich abgeschlossen

    } catch (error) {
        // Überprüfe, ob der Fehler ein Duplikat-Fehler (z.B. UNIQUE-Constraint) ist
        if (error.code === 'ER_DUP_ENTRY') { // MySQL-Duplikat-Fehlercode
            return 'duplicate';
        } else {
            console.log(error); // Logge den Fehler, falls es ein anderer Fehler ist
            return 'error'; // Allgemeiner Fehler
        };
    };
};

// player creates room
async function CreateRoom(id, xyCellAmount, InnerGameMode, playerTimer, fieldoptions, globalGameTimer, isPlaying, fieldIndex, fieldTitle,
    thirdPlayer, pointsToWin, win_patterns, playerAmount, player1_name, player2_name, player3_name, player1_icon, player2_icon, player1_role, player2_role, player3_role,
    player1_socketID, player2_socketID, player3_socketID, player1_advancedIcon, player2_advancedIcon, player1_IconColor, player2_IconColor, player1_timer, player2_timer, currentPlayer,
    costumCoords, costumPatterns, costumIcon, killAllDrawnCells, player1_id, p1_XP, curr_music_name, level_id, is_random_player_lobby, x_and_y, tournament_hash) {

    try {
        pool.query(`insert into roomdata (RoomID, xyCellAmount, InnerGameMode, PlayerTimer, fieldoptions,globalGameTimer ,isPlaying ,fieldIndex ,fieldTitle,
                thirdPlayer,pointsToWin,win_patterns,players,player1_name,player2_name,player3_name,player1_icon,player2_icon,player1_role ,player2_role ,player3_role ,player1_socketID ,
                player2_socketID ,player3_socketID ,player1_advancedIcon ,player2_advancedIcon ,player1_IconColor ,player2_IconColor ,player1_timer,player2_timer,currentPlayer, costumField, 
                costumPatterns, costumIcon, killAllDrawnCells, player1_id, p1_XP, curr_music_name, level_id, is_random_player_lobby, x_and_y, tournament_hash) 
        
                values (?, ?, ?, ?, ?, ?, ?, ?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? , ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

            [id, xyCellAmount, InnerGameMode, playerTimer, fieldoptions, globalGameTimer, isPlaying, fieldIndex, fieldTitle,
                thirdPlayer, pointsToWin, win_patterns, playerAmount, player1_name, player2_name, player3_name, player1_icon, player2_icon, player1_role, player2_role, player3_role,
                player1_socketID, player2_socketID, player3_socketID, player1_advancedIcon, player2_advancedIcon, player1_IconColor, player2_IconColor, player1_timer, player2_timer, currentPlayer,
                JSON.stringify(costumCoords), JSON.stringify(costumPatterns), costumIcon, killAllDrawnCells, player1_id, p1_XP, curr_music_name, level_id, is_random_player_lobby, JSON.stringify(x_and_y),
                tournament_hash
            ]
        );
    } catch (error) {
        console.error(error);
    };
};

async function SetUpWaitingEntry(p1_xp, p1_id, room_id) {
    try {
        let [insertId] = await pool.query(`insert into waiting_list (creator_id, creator_xp, room_id) values (?,?,?)`, [p1_id, p1_xp, room_id]);
        return insertId;

    } catch (error) {
        return error
    };
};

async function RemoveWaitingEntry(creator_id, room_id) {
    try {
        let column = creator_id ? 'creator_id' : 'room_id';
        let value = creator_id || room_id;

        if (['creator_id', 'room_id'].includes(column)) {
            // Führe die Abfrage aus
            await pool.query(`DELETE FROM waiting_list WHERE ${column} = ?`, [value]);

        } else {
            throw new Error('Invalid column name');
        };

    } catch (error) {
        console.log(error);
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

// user joins the lobby => all data from the user needs to be added now
async function UserJoinsRoom(GameID, UserName, icon, socketID, advancedIcon, IconColor, player_id, p_XP) {
    await pool.query(`update roomdata set player2_name = ?, player2_icon = ?, player2_socketID = ?, player2_advancedIcon = ?, player2_IconColor = ?, player2_id = ?, p2_XP = ? where RoomID = ?`, [UserName, icon, socketID, advancedIcon, IconColor, player_id, p_XP, GameID]);
};

// third user (role: blocker) join the lobby => all data from the blocker needs to be added now
async function BlockerJoinsRoom(GameID, BlockerName, socketID, player_id) {
    await pool.query(`update roomdata set player3_name = ?, player3_socketID = ?, player3_id = ? where RoomID = ?`, [BlockerName, socketID, player_id, GameID]);
};

// user leaves the lobby => all data from the user needs to be reseted now
async function UserLeavesRoom(GameID) {
    await pool.query(`update roomdata set player2_name = "", player2_icon = "", player2_socketID = "", player2_advancedIcon = "", player2_IconColor = "" where RoomID = ?`, [GameID]);
};

// third user (role: blocker) leaves the lobby => all data from the blocker needs to be reseted now
async function BlockerLeavesRoom(GameID) {
    await pool.query(`update roomdata set player3_name = "", player3_socketID = "" where RoomID = ?`, [GameID]);
};

// Find room by socket id and check which role that socketID had in that room
// If the socketID belongs to no room so nothing could be found, everything is okay and nothing needs to do
async function FindRoomBySocketID(socketID) {
    try {
        // List of all columns to find the value of
        const socketFields = ['player1_socketID', 'player2_socketID', 'player3_socketID'];

        for (const [index, field] of socketFields.entries()) {
            let result = await pool.query(`SELECT * FROM roomdata WHERE ${field} = ?`, [socketID]);

            if (result[0].length > 0) {
                let roomData = result[0][0];
                let role = index === 0 ? "admin" : index === 1 ? "user" : "blocker";
                return [role, roomData]; // return role and room data
            };
        };

        // find no result
        console.log(`Disconnected socket: ${socketID} is in no room`);
        return [];

    } catch (error) {
        console.error(`Error finding room by socket ID: ${error.message}`);
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
    try {
        await pool.query(`update players set player_name = ?, player_icon = ?, playerInfoClass = ?, playerInfoColor = ?, quote = ?, onlineGamesWon = ?, 
            XP = ?, currentUsedSkin = ?, commonPattern = ? where player_id = ?`, [player_name, player_icon, playerInfoClass, playerInfoColor, quote, onlineGamesWon, XP, current_used_skin, commonPattern, player_id]);

    } catch (error) {
        console.log(error);
    };
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
        player_timer = ?, icon = ?, pattern = ?, costum_patterns = ?, costum_field = ?, bot_mode = ?, bot_patterns = ? where id = ?`, [levelData.status, levelData.cellgrid, levelData.name, parseInt(id), levelData.bgmusic, levelData.bgcolor1, levelData.bgcolor2, levelData.requiredpoints, levelData.playertimer,
            levelData.levelicon, JSON.stringify(levelData.allowedpatterns), JSON.stringify(levelData.costumPatterns), JSON.stringify(levelData.costumField), levelData.BotMode, JSON.stringify(levelData.BotPatterns), levelData.id,
        ]);

        // console.log(rows, levelData.id);
        return levelData.id;

    } else {
        // get current date
        let [date] = await pool.query(`select current_date`);

        // write complete new level in database and generate new id
        let [rows] = await pool.query(`insert into levels (level_status, field, level_name, creator_id, bg_music, bg1, bg2, required_points, player_timer, icon, pattern, creation_date, costum_patterns, costum_field, bot_mode, bot_patterns) values 
        (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [levelData.status, levelData.cellgrid, levelData.name, parseInt(id), levelData.bgmusic, levelData.bgcolor1, levelData.bgcolor2, levelData.requiredpoints, levelData.playertimer,
            levelData.levelicon, JSON.stringify(levelData.allowedpatterns), JSON.stringify(date[0]["current_date"]), JSON.stringify(levelData.costumPatterns), JSON.stringify(levelData.costumField), levelData.BotMode, JSON.stringify(levelData.BotPatterns)
        ]);

        // console.log(rows);
        return rows.insertId; // unique id of the level
    };
};


// create new clan
const CreateClan = async(clan_name, clan_logo, clan_description, player_data, clan_room_id, cb) => {
    // console.log(clan_name, clan_logo, clan_description, player_data);

    try {
        let query = `
        insert into clans (level, name, logo, members, admin, field, XP, description, room_id) values (
            1,
            ?,
            ?,
            json_object(
                ?, json_object(
                    'name', ?,
                    'clan_id', 0,
                    'role', 'leader',
                    'position', json_object('x', 0, 'y', 0),
                    'XP', ?,
                    'join_date', ?
                )
            ),
            json_object('id', ?,'clan_id', 0, 'name', ?, 'role', 'leader'),
            1,
            ?,
            ?,
            ?
        );`;

        let [rows] = await pool.query(query, [
            clan_name, clan_logo, player_data["player_id"],
            player_data["player_name"],
            player_data["XP"],
            moment(new Date()).format('MMMM D, YYYY'),
            player_data["player_id"],
            player_data["player_name"],
            player_data["XP"],
            clan_description,
            clan_room_id
        ]);

        return [rows["serverStatus"], rows["insertId"]];

    } catch (error) {
        console.log(error);
    };
};

// load new column to gameLogs
const new_gamLog_entry = async(gameData) => {
    // console.log(gameData);

    let [row] = await pool.query(
        `insert into gamelogs (
            level_id,
            level_name,
            level_icon,
            p1_id,
            p2_id,
            p1_name,
            p2_name,
            p2_color,
            p1_color,
            p1_icon,
            p2_icon,
            p1_points,
            p2_points,
            blocker,
            blocker_name,
            cells_blocked_by_blocker,
            patterns_used,
            field_size,
            bg1,
            bg2,
            game_duration,
            moves,
            player_clock,
            points_to_win,
            allowed_patterns,
            costum_patterns,
            game_mode,
            field_mode,
            kill_cells_after_point,
            max_amount_of_moves,
            p3_id,
            field_index,
            music_name,
            boneyard_arr,
            tournament_data
        ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
            gameData[0],
            gameData[1],
            gameData[2],
            gameData[3],
            gameData[4],
            gameData[5],
            gameData[6],
            gameData[7],
            gameData[8],
            gameData[9],
            gameData[10],
            gameData[11],
            gameData[12],
            gameData[13],
            gameData[14],
            gameData[15],
            gameData[16],
            gameData[17],
            gameData[18],
            gameData[19],
            gameData[20],
            gameData[21],
            gameData[22],
            gameData[23],
            gameData[24],
            gameData[25],
            gameData[26],
            gameData[27],
            gameData[28],
            gameData[29],
            gameData[30],
            gameData[31],
            gameData[32],
            gameData[33],
            JSON.stringify(gameData[34])
        ]
    );

    return row.insertId;
};

async function CreateClanTournament(data, clan_id, player_id) {
    try {
        const formattedStartDate = moment(data.startDate).format('YYYY-MM-DD HH:mm:ss');
        const formattedEndDate = moment(data.endDate).format('YYYY-MM-DD HH:mm:ss');

        // ex.: new Date("2024-08-28T22:00:00.000Z"); new Date("2024-09-07T22:00:00.000Z")
        // calculate tournament duration and divide it with rounds 
        // const round_duration = (data.startDate - data.endDate) / (data.current_state.rounds + -1);
        const startDate = new Date(data.startDate);
        const endDate = new Date(data.endDate);
        const rounds = data.tree_structure.rounds.length + (-1);

        // Berechnung der Gesamtdauer des Turniers in Tagen
        const tournamentDuration = (endDate - startDate) / (1000 * 60 * 60 * 24);

        // Berechnung der Dauer jeder Runde in Tagen
        const roundDuration = tournamentDuration / rounds;

        // Objekt zum Speichern der Rundendaten
        const roundSchedule = {};

        // Berechnung der Start- und Enddaten jeder Runde und Speichern im Objekt
        for (let i = 0; i < rounds; i++) {
            let roundStartDate = new Date(startDate.getTime() + i * roundDuration * 24 * 60 * 60 * 1000);
            let roundEndDate = new Date(roundStartDate.getTime() + roundDuration * 24 * 60 * 60 * 1000);

            roundSchedule[`round_${i + 1}`] = {
                startDate: roundStartDate.toISOString().split('T')[0],
                endDate: roundEndDate.toISOString().split('T')[0]
            };
        };

        const q = `INSERT INTO tournaments (
            name, initiator, allowed_amount, participant_amount, participants, 
            start_date, finish_date, gems_to_put_in_pot, pot_value, allowed_patterns,
            current_state, player_clock, field_size, points_to_win, clan_id, round_schedule
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        pool.query(q, [
            data.name,
            player_id,
            data.participants,
            0,
            JSON.stringify([]),
            formattedStartDate,
            formattedEndDate,
            data.gemsInPot,
            0,
            JSON.stringify(data.allowedPatterns),
            JSON.stringify(data.tree_structure),
            data.playerClock,
            data.fieldSize,
            data.pointsToGet,
            clan_id,
            JSON.stringify(roundSchedule)

        ]).then(([rows]) => {
            // console.log(rows);
        }).catch(err => {
            console.log(err);
        });

        return { success: true };

    } catch (error) {
        console.error(error);
        return { success: false };
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
    pool: pool,
    UserLeavesRoom: UserLeavesRoom,
    BlockerLeavesRoom: BlockerLeavesRoom,
    FindRoomBySocketID: FindRoomBySocketID,
    UserJoinsRoom: UserJoinsRoom,
    BlockerJoinsRoom: BlockerJoinsRoom,
    UpdateGameData: UpdateGameData,
    NewPlayerProfileQuote: NewPlayerProfileQuote,
    UpdateAllUserData: UpdateAllUserData,
    SearchPlayers: SearchPlayers,
    SaveNewLevel,
    CreateClan,
    new_gamLog_entry,
    SetUpWaitingEntry,
    RemoveWaitingEntry,
    CreateClanTournament
};