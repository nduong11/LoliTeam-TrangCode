require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const csv = require('csv-parser');
const sentiment = require('wink-sentiment');

const app = express();
const port = process.env.API_PORT || 8080;

app.use(cors());
app.use(express.json());

const mysql = require('mysql2');

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error('❌ Lỗi kết nối:', err.message);
  } else {
    console.log('✅ Đã kết nối đến database:', process.env.DB_NAME);
  }
});

// API: Lấy danh sách bảng
app.get('/tables', (req, res) => {
  db.query('SHOW TABLES', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    const tableKey = Object.keys(results[0])[0];
    const tableNames = results.map(row => row[tableKey]);

    res.json(tableNames);
  });
});

// API: Lấy dữ liệu từ một bảng cụ thể
app.get('/data/:table', (req, res) => {
  const tableName = req.params.table;

  db.query(`SELECT * FROM \`${tableName}\``, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// API: Lấy dữ liệu theo ID từ bảng cụ thể + phân tích
app.get('/data/:table/:id', async (req, res) => {
  const tableName = req.params.table;
  const recordId = parseInt(req.params.id, 10);

  try {
    let results;

    if (recordId === -1) {
      const [randomRows] = await db.promise().query(
        `SELECT * FROM \`${tableName}\` ORDER BY RAND() LIMIT 1`
      );
      results = randomRows;
    } else {
      const [rows] = await db.promise().query(
        `SELECT * FROM \`${tableName}\` WHERE id = ? LIMIT 1`,
        [recordId]
      );
      results = rows;
    }

    if (!results || results.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bản ghi' });
    }

    const { whitelist, blacklist } = await loadWhitelistBlacklist('./checkDomain.csv');

    const analyze = await analyzeEmailUnified(
      { tableName, recordId: results[0].id },
      whitelist,
      blacklist
    );

    res.json({
      data: results[0],
      analysis: analyze
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Phân tích email và nội dung nhập tay
app.post('/analyze', async (req, res) => {
  const { email, content } = req.body;

  if (!content || !email) {
    return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ email và content.' });
  }

  try {
    const { whitelist, blacklist } = await loadWhitelistBlacklist('./checkDomain.csv');

    const result = await analyzeEmailUnified(
      { email, content },
      whitelist,
      blacklist
    );

    res.json(result);

  } catch (error) {
    console.error('Lỗi phân tích:', error.message);
    res.status(500).json({ error: 'Đã xảy ra lỗi trong quá trình phân tích.' });
  }
});

// Hàm phân tích chung gom 2 hàm cũ
async function analyzeEmailUnified({ tableName, recordId, email, content }, whitelist, blacklist) {
  if (tableName && recordId != null) {
    const [recordRows] = await db.promise().query(
      `SELECT * FROM \`${tableName}\` WHERE id = ? LIMIT 1`,
      [recordId]
    );

    if (recordRows.length === 0) {
      throw new Error('Không tìm thấy bản ghi');
    }

    email = recordRows[0].from_email || '';
    content = recordRows[0].content || '';

    var isSpamFromDb = await checkIsSpamContent(tableName, recordId);
  } else {
    var isSpamFromDb = false;
  }

  const normalizedContent = (content || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const isSpam = isSpamFromDb || checkSpamWithKeywords(normalizedContent);
  const isPositive = analyzeSentiment(content);
  const hasUrl = containsURL(content);
  const emailStatus = checkEmail(email, whitelist, blacklist);

  const explanationList = [];

  if (email) explanationList.push(`- Email: ${email}`);
  if (isSpam) explanationList.push('- Nội dung có dấu hiệu thư rác');
  if (isPositive) explanationList.push('- Giọng điệu có tính thôi thúc');
  if (hasUrl) explanationList.push('- Có chứa liên kết');
  if (emailStatus === 2) explanationList.push('- Email nằm trong **danh sách đen**');
  else if (emailStatus === 0) explanationList.push('- Email nằm trong **danh sách tin cậy**');
  else explanationList.push('- Không xác định được độ tin cậy của email gửi');

  let finalVerdict = 'An toàn';
  if (isSpam) finalVerdict = 'Spam (thư rác)';
  else if (emailStatus === 2) finalVerdict = 'Giả mạo (phishing)';
  else if (hasUrl && !isPositive) finalVerdict = 'Nghi ngờ';

  return {
    explanation: explanationList.join('\n'),
    verdict: finalVerdict
  };
}

// Check spam theo từ khóa
function checkSpamWithKeywords(content) {
  const keywords = ['giảm giá', 'chỉ còn', 'ưu đãi', 'free'];
  return keywords.some(keyword => content.includes(keyword));
}

// Check spam trong DB bằng từ khóa (không kiểm tra trùng nội dung nữa)
async function checkIsSpamContent(tableName, recordId) {
  try {
    const [recordRows] = await db.promise().query(
      `SELECT * FROM \`${tableName}\` WHERE id = ? LIMIT 1`,
      [recordId]
    );

    if (recordRows.length === 0) {
      throw new Error('Không tìm thấy bản ghi');
    }

    const record = recordRows[0];
    const inputContentRaw = record.content.toLowerCase().replace(/\s+/g, ' ').trim();

    return checkSpamWithKeywords(inputContentRaw);

  } catch (err) {
    console.error('Lỗi checkIsSpamContent:', err.message);
    return false;
  }
}

// Phân tích cảm xúc
function analyzeSentiment(text) {
  const result = sentiment(text);
  return result.score > 0;
}

// Check URL trong text
function containsURL(text) {
  const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+|\b[a-zA-Z0-9.-]+\.(com|net|org|vn|edu|gov|io|co)(\/[^\s]*)?/gi;
  return urlRegex.test(text);
}

// Kiểm tra email whitelist/blacklist
function checkEmail(email, whitelist, blacklist) {
  if (!email) return 1;

  const lowerEmail = email.toLowerCase();
  const domain = lowerEmail.split('@')[1];
  if (!domain) return 1;

  for (const blackStr of Object.keys(blacklist)) {
    if (domain.includes(blackStr)) {
      return 2;
    }
  }

  for (const whiteStr of Object.keys(whitelist)) {
    if (domain === whiteStr) {
      return 0;
    }
  }

  return 1;
}

// Đọc file CSV whitelist và blacklist
function loadWhitelistBlacklist(filePath) {
  return new Promise((resolve, reject) => {
    const whitelist = {};
    const blacklist = {};

    fs.createReadStream(filePath)
      .pipe(csv({ separator: ',' }))
      .on('data', (row) => {
        const domain = (row['whitelist'] || '').trim().toLowerCase();
        const tld = (row['blacklist'] || '').trim().toLowerCase();

        if (domain) whitelist[domain] = true;
        if (tld) blacklist[tld] = true;
      })
      .on('end', () => resolve({ whitelist, blacklist }))
      .on('error', reject);
  });
}

app.listen(port, () => {
  console.log(`🚀 Backend đang chạy tại http://localhost:${port}`);
});
