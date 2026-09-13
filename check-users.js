const db = require('./backend/database');
db.all('SELECT * FROM usuarios LIMIT 2', [], (err, rows) => {
  if (err) {
    console.log('ERROR:', err.message);
  } else {
    if (rows && rows.length > 0) {
      console.log('COLUMNS:', Object.keys(rows[0]));
      console.log('DATA:', JSON.stringify(rows, null, 2));
    } else {
      console.log('NO USERS FOUND');
    }
  }
  process.exit(0);
});
