// db_test.js
const mysql = require('mysql2/promise');

async function main() {
  const config = {
    host: 'database-1.cr4ki8q8k4w4.us-east-2.rds.amazonaws.com',
    port: 3306,
    user: 'webapp',
    password: 'webapp1234',
    database: 'mydb',
  };

  console.log('TRY CONNECT WITH CONFIG:', config);

  try {
    const conn = await mysql.createConnection(config);
    console.log('✅ DB 연결 성공!\n');

    // =========================================================
    //  🔎 80x 강의실이 실제로 죽헌_시간표에 존재하는지 확인
    // =========================================================
    console.log("🔍 [검사] 죽헌_시간표에 '80x' 강의실이 있는지 검사합니다...\n");

    const [roomCheck] = await conn.query(
      `
      SELECT 
        id,
        과목코드,
        과목명,
        대표교수,
        강의실1_번호,
        요일1,
        교시1,
        강의실2_번호,
        요일2,
        교시2
      FROM 죽헌_시간표
      WHERE 
        강의실1_번호 LIKE '80%' 
        OR 강의실2_번호 LIKE '80%'
      `
    );

    if (roomCheck.length === 0) {
      console.log("⚠️ 80x로 시작하는 강의실 번호(801~809 등)가 없습니다!");
      console.log("   → 현재 DB에는 202, 210, 204 같은 실제 강의실 번호만 존재할 가능성이 높습니다.");
    } else {
      console.log("✅ 80x 번호가 포함된 강의실 데이터 발견!");
      roomCheck.forEach((r, i) => console.log(`  #${i + 1}:`, r));
    }

    console.log("\n----------------------------------------------\n");

    // =========================================================
    //  기존 전체 테이블/컬럼/데이터 출력 로직
    // =========================================================
    const [tables] = await conn.query('SHOW TABLES');

    if (tables.length === 0) {
      console.log('📋 [mydb] 테이블이 없습니다.');
      await conn.end();
      return;
    }

    console.log('📋 [mydb] 테이블 & 컬럼 & 데이터\n');

    for (const row of tables) {
      const tableName = row[Object.keys(row)[0]];

      console.log(`\n🔹 테이블: ${tableName}`);

      const [cols] = await conn.query(`SHOW COLUMNS FROM \`${tableName}\``);
      cols.forEach((col) => {
        console.log(
          `  - ${col.Field} (${col.Type})` +
            (col.Null === 'NO' ? ' NOT NULL' : '') +
            (col.Key ? ` KEY=${col.Key}` : '') +
            (col.Default !== null ? ` DEFAULT=${col.Default}` : '') +
            (col.Extra ? ` ${col.Extra}` : '')
        );
      });

      const [rows] = await conn.query(`SELECT * FROM \`${tableName}\` LIMIT 10`);
      console.log(`\n📌 [${tableName}] 데이터 예시:`);

      if (rows.length === 0) {
        console.log('  (데이터 없음)');
      } else {
        rows.forEach((r, i) => console.log(`  #${i + 1}:`, r));
      }
    }

    await conn.end();
  } catch (err) {
    console.error('❌ DB 연결 실패:', err.code, err.message);
  }
}

main();
