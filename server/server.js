// server/server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');   // ✅ mysql2/promise 사용

const app = express();
const port = 8000;

// 미들웨어
app.use(cors());
app.use(express.json());

// DB 연결 풀 생성
const pool = mysql.createPool({
  host: process.env.DB_HOST,       // RDS 주소
  user: process.env.DB_USER,       // webapp
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,   // mydb
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 요일(숫자) → 한글 요일
function getKoreanDayName(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0~6 (일~토)
  const map = ['일', '월', '화', '수', '목', '금', '토'];
  return map[day];
}

// ==============================
//  테스트용 루트
// ==============================
app.get('/', async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT NOW() AS now');
    conn.release();

    res.json({
      message: '강의실 예약 API 서버입니다.',
      now: rows[0].now
    });
  } catch (err) {
    console.error('루트 테스트 에러:', err);
    res.status(500).json({ error: 'DB 테스트 실패' });
  }
});

// ==============================
// 1) 강의실 시간표 + 학생 예약 조회
//    GET /api/rooms/:roomId/schedule?date=YYYY-MM-DD
// ==============================
app.get('/api/rooms/:roomId/schedule', async (req, res) => {
  const roomId = req.params.roomId;     // 예: "804"
  const date = req.query.date;          // 예: "2025-11-27"

  console.log('▶ [GET] /api/rooms/:roomId/schedule 호출됨', { roomId, date });

  if (!date) {
    console.log('⚠ date 없음');
    return res.status(400).json({
      success: false,
      message: 'date 쿼리 파라미터가 필요합니다.'
    });
  }

  // 🔸 더 이상 dayName으로 시간표를 필터링하지 않음 (전체 요일 다 가져오기)
  // const dayName = getKoreanDayName(date);

  try {
    const conn = await pool.getConnection();
    console.log('✅ DB 커넥션 획득');

    // 🔹 1) 죽헌_시간표에서 "해당 강의실의 모든 과목" 조회
    //    - 강의실1_번호 = roomId 인 행
    //    - 강의실2_번호 = roomId 인 행
    //    둘 다 한 테이블(timetableRows)로 합치기
    console.log('🔎 죽헌_시간표 (모든 요일) 조회 시작');
    const [timetableRows] = await conn.query(
      `
      SELECT
        id,
        과목코드,
        과목명,
        대표교수,
        강의실1_번호 AS 강의실,
        요일1 AS 요일,
        교시1 AS 교시
      FROM 죽헌_시간표
      WHERE 강의실1_번호 = ?

      UNION ALL

      SELECT
        id,
        과목코드,
        과목명,
        대표교수,
        강의실2_번호 AS 강의실,
        요일2 AS 요일,
        교시2 AS 교시
      FROM 죽헌_시간표
      WHERE 강의실2_번호 = ?
      ORDER BY 요일, 교시
      `,
      [roomId, roomId]
    );
    console.log('✅ 죽헌_시간표 조회 완료, 개수:', timetableRows.length);

    // 🔹 2) 학생_강의실예약: 날짜 기준으로만 필터 (기존 그대로 유지)
    console.log('🔎 학생_강의실예약 조회 시작');
    const [reservationRows] = await conn.query(
      `
      SELECT
        예약번호,
        학번,
        강의실,
        사용일자,
        시작시간,
        종료시간,
        생성일시
      FROM 학생_강의실예약
      WHERE 강의실 = ? AND 사용일자 = ?
      ORDER BY 시작시간
      `,
      [roomId, date]
    );
    console.log('✅ 학생_강의실예약 조회 완료, 개수:', reservationRows.length);

    conn.release();
    console.log('🔚 커넥션 반환 및 응답 전송');

    return res.json({
      success: true,
      data: {
        date,
        roomId,
        timetable: timetableRows,   // 👈 이제 이 안에 "모든 요일의 수업"이 들어옴
        reservations: reservationRows
      }
    });
  } catch (err) {
    console.error('❌ /api/rooms/:roomId/schedule 에러:', err);
    return res.status(500).json({
      success: false,
      message: '시간표/예약 정보를 불러오는 중 오류가 발생했습니다.',
      error: String(err)
    });
  }
});

// ==============================
// 2) 학생 예약 생성
//    POST /api/reservations
//    body: { room_id, date, start_time, end_time, purpose, user_name }
// ==============================
app.post('/api/reservations', async (req, res) => {
  const { room_id, date, start_time, end_time, purpose, user_name } = req.body;

  console.log('▶ [POST] /api/reservations', req.body);

  if (!room_id || !date || !start_time || !end_time || !user_name) {
    return res.status(400).json({
      success: false,
      message: 'room_id, date, start_time, end_time, user_name는 필수입니다.'
    });
  }

  try {
    const conn = await pool.getConnection();

    // 아주 간단한 중복 체크(시간 겹침 여부)
    const [dupRows] = await conn.query(
      `
      SELECT 1
      FROM 학생_강의실예약
      WHERE 강의실 = ?
        AND 사용일자 = ?
        AND NOT (종료시간 <= ? OR 시작시간 >= ?)
      LIMIT 1
      `,
      [room_id, date, start_time, end_time]
    );

    if (dupRows.length > 0) {
      conn.release();
      return res.status(409).json({
        success: false,
        message: '선택한 시간에 이미 예약이 있습니다.'
      });
    }

    // 학번 컬럼이 필수라서 일단 user_name을 그대로 학번으로 사용
    const fakeStudentId = user_name;

    await conn.query(
      `
      INSERT INTO 학생_강의실예약
      (학번, 강의실, 사용일자, 시작시간, 종료시간)
      VALUES (?, ?, ?, ?, ?)
      `,
      [fakeStudentId, room_id, date, start_time, end_time]
    );

    conn.release();

    res.status(201).json({
      success: true,
      message: '예약이 등록되었습니다.'
    });
  } catch (err) {
    console.error('❌ POST /api/reservations 에러:', err);
    res.status(500).json({
      success: false,
      message: '예약 저장 중 오류가 발생했습니다.'
    });
  }
});

// ==============================
// 서버 시작
// ==============================
app.listen(port, () => {
  console.log(`✅ 강의실 예약 API 서버가 ${port}번 포트에서 실행 중입니다.`);
  console.log('DB HOST:', process.env.DB_HOST);
  console.log('DB USER:', process.env.DB_USER);
  console.log('DB NAME:', process.env.DB_NAME);
});
