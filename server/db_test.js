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
    //  🔎 80x 강의실에서 진행되는 모든 수업 정보 출력
    //      - 강의실1_번호 / 요일1 / 교시1
    //      - 강의실2_번호 / 요일2 / 교시2
    //   를 하나의 테이블처럼 UNION 해서 조회
    // =========================================================
    console.log("🔍 [검사] 죽헌_시간표에서 '80x' 강의실(801, 802, ...) 수업 목록을 조회합니다...\n");

    // 1) 강의실별로 몇 건씩 있는지 요약
    const [roomSummary] = await conn.query(
      `
      SELECT
        t.강의실번호,
        COUNT(*) AS 수업개수
      FROM (
        SELECT 강의실1_번호 AS 강의실번호
        FROM 죽헌_시간표
        WHERE 강의실1_번호 LIKE '80%'

        UNION ALL

        SELECT 강의실2_번호 AS 강의실번호
        FROM 죽헌_시간표
        WHERE 강의실2_번호 LIKE '80%'
      ) AS t
      GROUP BY t.강의실번호
      ORDER BY t.강의실번호;
      `
    );

    if (roomSummary.length === 0) {
      console.log("⚠️ 80x로 시작하는 강의실 번호(801~809 등)가 없습니다!");
      console.log("   → 현재 DB에는 202, 210, 204 같은 실제 강의실 번호만 존재할 가능성이 높습니다.\n");
    } else {
      console.log("✅ 80x 강의실별 수업 개수 요약:");
      roomSummary.forEach((r, i) => {
        console.log(
          `  #${i + 1}: 강의실=${r.강의실번호}, 수업개수=${r.수업개수}`
        );
      });
      console.log("\n----------------------------------------------\n");
    }

    // 2) 80x 강의실에서 진행되는 모든 수업 상세 목록
    const [roomDetail] = await conn.query(
      `
      SELECT
        x.강의실번호,
        x.요일,
        x.교시,
        x.과목코드,
        x.과목명,
        x.대표교수
      FROM (
        SELECT 
          강의실1_번호 AS 강의실번호,
          요일1       AS 요일,
          교시1       AS 교시,
          과목코드,
          과목명,
          대표교수
        FROM 죽헌_시간표
        WHERE 강의실1_번호 LIKE '80%'

        UNION ALL

        SELECT 
          강의실2_번호 AS 강의실번호,
          요일2       AS 요일,
          교시2       AS 교시,
          과목코드,
          과목명,
          대표교수
        FROM 죽헌_시간표
        WHERE 강의실2_번호 LIKE '80%'
      ) AS x
      ORDER BY x.강의실번호, x.요일, x.교시;
      `
    );

    if (roomDetail.length === 0) {
      console.log("⚠️ 80x 강의실 수업 상세 데이터가 없습니다.");
    } else {
      console.log("📚 80x 강의실 수업 상세 목록 (최대 100건만 표기):\n");
      roomDetail.slice(0, 100).forEach((r, i) => {
        console.log(
          `  #${i + 1}: 강의실=${r.강의실번호}, 요일=${r.요일}, 교시=${r.교시}, 과목코드=${r.과목코드}, 과목명=${r.과목명}, 교수=${r.대표교수}`
        );
      });
      if (roomDetail.length > 100) {
        console.log(`\n  ... (총 ${roomDetail.length}건 중 100건만 출력)\n`);
      }
    }

    console.log("\n==============================================");
    console.log("📋 [mydb] 전체 테이블 & 컬럼 & 데이터 예시 출력");
    console.log("==============================================\n");

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
