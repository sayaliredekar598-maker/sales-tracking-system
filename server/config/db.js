const mysql = require("mysql2");

require("dotenv").config({
    path: require("path").join(__dirname, "../../.env")
});

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) {
        console.log("❌ MySQL Connection Failed");
        console.log(err.message);
    } else {
        console.log("✅ MySQL Connected Successfully");
    }
});
module.exports = db;
