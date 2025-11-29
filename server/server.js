// server/server.js

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const fetch = global.fetch;

const app = express();
const port = 8000;

// ==============================
// 미들웨어
// ==============================
app.use(cors());
app.use(express.json());

// ==============================
// DB 연결 풀
// ==============================
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ==============================
// Lambda Function URL (Claude 3.5 Haiku 호출용)
// ==============================
const LAMBDA_URL =
  process.env.BEDROCK_LAMBDA_URL || process.env.BEDROCK_LAMDBA_URL || "";

function getKoreanDayName(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const map = ["일", "월", "화", "수", "목", "금", "토"];
  return map[day];
}

// ==============================
// 0) 테스트용 루트
// ==============================
app.get("/", async (req, res) => {
  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query("SELECT NOW() AS now");
    conn.release();

    res.json({
      message: "강의실 예약 API 서버입니다.",
      now: rows[0].now,
    });
  } catch (err) {
    console.error("루트 테스트 에러:", err);
    res.status(500).json({ error: "DB 테스트 실패" });
  }
});

// ==============================
// 1) 강의실 시간표 + 학생 예약 조회
// ==============================
app.get("/api/rooms/:roomId/schedule", async (req, res) => {
  const roomId = req.params.roomId;
  const date = req.query.date;

  console.log("▶ [GET] /api/rooms/:roomId/schedule 호출됨", { roomId, date });

  if (!date) {
    return res.status(400).json({
      success: false,
      message: "date 쿼리 파라미터가 필요합니다.",
    });
  }

  try {
    const conn = await pool.getConnection();

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

    conn.release();

    return res.json({
      success: true,
      data: {
        date,
        roomId,
        timetable: timetableRows,
        reservations: reservationRows,
      },
    });
  } catch (err) {
    console.error("❌ /api/rooms/:roomId/schedule 에러:", err);
    return res.status(500).json({
      success: false,
      message: "시간표/예약 정보를 불러오는 중 오류가 발생했습니다.",
      error: String(err),
    });
  }
});

// ==============================
// 2) 학생 예약 생성
// ==============================
app.post("/api/reservations", async (req, res) => {
  const { room_id, date, start_time, end_time, purpose, user_name } = req.body;

  console.log("▶ [POST] /api/reservations", req.body);

  if (!room_id || !date || !start_time || !end_time || !user_name) {
    return res.status(400).json({
      success: false,
      message: "room_id, date, start_time, end_time, user_name는 필수입니다.",
    });
  }

  try {
    const conn = await pool.getConnection();

    // 시간 겹침 체크
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
        message: "선택한 시간에 이미 예약이 있습니다.",
      });
    }

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
      message: "예약이 등록되었습니다.",
    });
  } catch (err) {
    console.error("❌ POST /api/reservations 에러:", err);
    res.status(500).json({
      success: false,
      message: "예약 저장 중 오류가 발생했습니다.",
    });
  }
});

// ==============================
// 3) AI 챗봇 (/api/chat → Lambda 프록시)
// ==============================
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    console.log("▶ [POST] /api/chat 요청:", message);
    console.log("LAMBDA_URL:", LAMBDA_URL);

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        success: false,
        message: "message 필드가 필요합니다.",
      });
    }

    if (!LAMBDA_URL) {
      console.error("❌ LAMBDA_URL 미설정");
      return res.status(500).json({
        success: false,
        message: "서버 설정에 Lambda URL이 없습니다.",
      });
    }

    const lambdaRes = await fetch(LAMBDA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: message }),
    });

    const lambdaText = await lambdaRes.text();
    console.log("Lambda raw response:", lambdaRes.status, lambdaText);

    let lambdaJson;
    try {
      lambdaJson = JSON.parse(lambdaText || "{}");
    } catch (e) {
      console.error("❌ Lambda 응답 JSON 파싱 실패:", lambdaText);
      return res.status(500).json({
        success: false,
        message: "Lambda 응답을 이해할 수 없습니다.",
      });
    }

    if (!lambdaRes.ok) {
      console.error("❌ Lambda 호출 실패:", lambdaRes.status, lambdaJson);
      return res.status(500).json({
        success: false,
        message: "챗봇 엔진 호출 중 오류가 발생했습니다.",
      });
    }

    const reply =
      lambdaJson.result ||
      lambdaJson.reply ||
      "답변을 가져오지 못했습니다.";

    return res.json({
      success: true,
      reply,
    });
  } catch (err) {
    console.error("❌ /api/chat 서버 에러:", err);
    return res.status(500).json({
      success: false,
      message: "챗봇 응답 생성 중 서버 오류가 발생했습니다.",
      error: String(err),
    });
  }
});

// ==============================
// 서버 시작
// ==============================
app.listen(port, () => {
  console.log(`✅ 강의실 예약 API 서버가 ${port}번 포트에서 실행 중입니다.`);
  console.log("DB HOST:", process.env.DB_HOST);
  console.log("DB USER:", process.env.DB_USER);
  console.log("DB NAME:", process.env.DB_NAME);
  console.log("BEDROCK REGION:", process.env.BEDROCK_REGION || "us-east-2");
  console.log("LAMBDA URL:", LAMBDA_URL || "(미설정)");
});
