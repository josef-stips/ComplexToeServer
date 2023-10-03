const mysql = require('mysql2');
const dotenv = require('dotenv');
dotenv.config();

const pool = mysql.createPool({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE,
    connectionLimit: process.env.DATABASE_CONNECTION_LIMIT
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
    let sql = ` insert into players (last_connection) values (now());`;

    const result = await pool.query(sql);
    let [id] = await pool.query(`select player_id from players order by player_id DESC LIMIT 1;`);
    return id;
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
};