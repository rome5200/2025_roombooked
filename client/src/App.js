/*******************************************************
 *  강의실 예약 시스템 (src/App.js - React 버전)
 *  - 백엔드: http://localhost:8000/api (또는 EC2 IP:8000/api)
 *  - 사용 테이블: 죽헌_시간표, 학생_강의실예약
 *  - AI 챗봇: /api/chat → Node 서버 → Lambda → Bedrock(Claude 3.5 Haiku)
 *******************************************************/

import { useEffect } from "react";

// React 18 StrictMode에서 useEffect 두 번 실행되는 것 방지용
let initialized = false;

// ✅ 백엔드 API 기본 URL
//   - 시간표/예약: /rooms, /reservations
//   - 챗봇: /chat (서버가 Lambda로 프록시)
const API_BASE_URL = "http://3.129.18.124:8000/api";

// 전역 상태
let currentRoomId = null;

// 강의실 기본 정보
const roomData = {
  "801": { name: "801호", capacity: 25, features: ["프로젝터", "화이트보드"], type: "일반강의실" },
  "802": { name: "802호", capacity: 30, features: ["프로젝터", "화이트보드"], type: "일반강의실" },
  "803": { name: "803호", capacity: 25, features: ["원형테이블", "화이트보드"], type: "세미나실" },
  "804": { name: "804호", capacity: 40, features: ["프로젝터", "음향시설"], type: "대형강의실" },
  "807": { name: "807호", capacity: 35, features: ["프로젝터", "화이트보드"], type: "일반강의실" },
  "808": { name: "808호", capacity: 20, features: ["컴퓨터", "프로젝터"], type: "컴퓨터실" },
};

/********************************************************
 * 0. 유틸 함수들
 ********************************************************/

// 1교시 = 9시, 2교시 = 10시 ... →  (교시 + 8)시
function periodToTime(period) {
  const p = parseInt(period, 10);
  if (Number.isNaN(p)) return "--:--";
  const hour = p + 8; // 1교시 = 9시 = 1 + 8
  return `${String(hour).padStart(2, "0")}:00`;
}

// YYYY-MM-DD → '월', '화' ...
function getKoreanDayName(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay(); // 0~6 (일~토)
  const map = ["일", "월", "화", "수", "목", "금", "토"];
  return map[day];
}

/********************************************************
 * 1. API 호출 함수들
 ********************************************************/

// 특정 강의실 + 날짜의 "정규 수업 + 학생 예약" 정보 조회
async function fetchRoomSchedule(roomId, date) {
  try {
    const url = `${API_BASE_URL}/rooms/${roomId}/schedule?date=${encodeURIComponent(
      date
    )}`;
    console.log("📡 요청 URL:", url);

    const res = await fetch(url);

    console.log("📡 상태코드:", res.status);
    if (!res.ok) {
      try {
        const text = await res.text();
        console.error("❌ 응답 본문:", text);
      } catch (_) {
        /* ignore */
      }
      console.error("❌ /rooms/:roomId/schedule 응답 오류:", res.status);
      return null;
    }

    const json = await res.json();
    console.log("📥 schedule data:", json);

    if (!json.success) {
      console.error("❌ schedule success=false:", json.message);
      return null;
    }

    return json.data; // {date, roomId, timetable, reservations}
  } catch (err) {
    console.error("❌ fetchRoomSchedule 에러:", err);
    return null;
  }
}

// 학생 예약 생성
async function createReservation(reservationData) {
  try {
    const url = `${API_BASE_URL}/reservations`;
    console.log("📡 예약 요청 URL:", url, reservationData);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reservationData),
    });

    const json = await res.json();
    console.log("📥 createReservation 응답:", json);
    return json;
  } catch (err) {
    console.error("❌ createReservation 에러:", err);
    return { success: false, message: "예약 요청 중 오류가 발생했습니다." };
  }
}

/********************************************************
 * 2. 시간표/예약 카드 HTML 생성
 ********************************************************/

function generateScheduleHtml(roomId, scheduleData) {
  const room = roomData[roomId];
  if (!room) {
    return `<div class="text-sm text-gray-500">알 수 없는 강의실입니다.</div>`;
  }

  if (!scheduleData) {
    return `<div class="text-sm text-gray-500">시간표 정보를 불러오지 못했습니다.</div>`;
  }

  const { date, timetable = [], reservations = [] } = scheduleData;

  const todayDayName = getKoreanDayName(date); // 오늘 요일 (예약 표시용)

  const days = ["월", "화", "수", "목", "금"];
  const timeSlots = [
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
  ];

  // 요일별 수업
  const classesByDay = {};
  days.forEach((d) => (classesByDay[d] = []));
  timetable.forEach((row) => {
    const day = row["요일"] || row.day;
    if (!days.includes(day)) return;

    const subject = row["과목명"] || row.subject || "";
    const prof = row["대표교수"] || row.professor || "";
    const periods = String(row["교시"] || row.periods || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (periods.length === 0) return;
    const startP = parseInt(periods[0], 10);
    const endP = parseInt(periods[periods.length - 1], 10) + 1;

    classesByDay[day].push({
      subject,
      professor: prof,
      start: periodToTime(startP),
      end: periodToTime(endP),
    });
  });

  // 요일별 학생 예약(선택한 date 만 해당 요일 칸에 표시)
  const reservationsByDay = {};
  days.forEach((d) => (reservationsByDay[d] = []));
  reservations.forEach((r) => {
    const start = (r.start_time || r["시작시간"] || "").slice(0, 5);
    const end = (r.end_time || r["종료시간"] || "").slice(0, 5);
    const userName = r.user_name || r["학번"] || "학생 예약";
    const purpose = r.purpose || r["사용목적"] || "";
    reservationsByDay[todayDayName].push({
      start,
      end,
      userName,
      purpose,
    });
  });

  // 주간 테이블 바디 생성
  let weeklyRowsHtml = "";
  timeSlots.forEach((slot) => {
    weeklyRowsHtml += `<tr>
      <td class="border border-gray-200 px-2 py-1 text-center text-xs bg-gray-50 font-medium">${slot}</td>`;

    days.forEach((day) => {
      const classAt = classesByDay[day].find(
        (c) => slot >= c.start && slot < c.end
      );
      const resAt = reservationsByDay[day].find(
        (r) => slot >= r.start && slot < r.end
      );

      let cellContent = `<div class="text-[10px] text-gray-300 text-center">-</div>`;

      if (classAt) {
        cellContent = `
          <div class="bg-rose-100 border border-rose-300 text-rose-800 rounded-md px-1 py-1 leading-tight text-[11px]">
            <div class="font-semibold">${classAt.subject}</div>
            <div class="text-[10px]">${classAt.professor}</div>
          </div>
        `;
      } else if (resAt) {
        cellContent = `
          <div class="bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-md px-1 py-1 leading-tight text-[11px]">
            <div class="font-semibold">${resAt.userName}</div>
            <div class="text-[10px]">${resAt.start} ~ ${resAt.end}</div>
          </div>
        `;
      }

      weeklyRowsHtml += `<td class="border border-gray-200 px-1 py-1 align-top">${cellContent}</td>`;
    });

    weeklyRowsHtml += `</tr>`;
  });

  // 최종 카드 HTML
  return `
  <div class="h-full flex flex-col gap-4">
    <!-- 상단 카드 (강의실 정보) -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div class="flex items-center mb-4">
        <div class="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center mr-3">
          <svg class="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1z"/>
          </svg>
        </div>
        <div>
          <div class="text-sm font-semibold text-gray-700">강의실 정보</div>
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-lg font-semibold text-gray-900">
          ${room.name}
        </div>

        <div class="text-sm text-gray-600">
          유형:
          <span class="font-medium">${room.type}</span>
          · 수용인원:
          <span class="font-semibold">${room.capacity}</span>명
        </div>

        <div class="flex flex-wrap gap-2 pt-1">
          ${
            room.features
              .map(
                (f) =>
                  `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">${f}</span>`
              )
              .join("")
          }
        </div>
      </div>
    </div>

    <!-- 주간 시간표 -->
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex-1 flex flex-col min-h-[260px]">
      <div class="flex items-center justify-between mb-2">
        <div class="text-sm font-semibold text-gray-800">강의실 시간표 및 예약 현황</div>
        <div class="flex items-center space-x-3 text-[10px] text-gray-500">
          <div class="flex items-center">
            <span class="w-3 h-3 rounded-full bg-rose-200 border border-rose-300 mr-1"></span> 수업중
          </div>
          <div class="flex items-center">
            <span class="w-3 h-3 rounded-full bg-emerald-200 border border-emerald-300 mr-1"></span> 예약시간
          </div>
        </div>
      </div>
      <div class="overflow-x-auto overflow-y-auto text-xs max-h-[360px]">
        <table class="w-full border border-gray-200 rounded-lg text-[11px]">
          <thead class="bg-gray-50">
            <tr>
              <th class="border border-gray-200 px-2 py-1 text-center font-medium">시간</th>
              ${["월","화","수","목","금"]
                .map(
                  (d) =>
                    `<th class="border border-gray-200 px-2 py-1 text-center font-medium">${d}</th>`
                )
                .join("")}
            </tr>
          </thead>
          <tbody>
            ${weeklyRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </div>
`;
}

/********************************************************
 * 3. 모달 열기 / 닫기
 ********************************************************/

async function openReservationModal(roomId) {
  currentRoomId = roomId;

  const room = roomData[roomId];
  if (!room) {
    alert("알 수 없는 강의실입니다.");
    return;
  }

  // 강의실 이름 표시
  const roomInput = document.getElementById("modal-room");
  if (!roomInput) return;
  roomInput.value = room.name;
  roomInput.dataset.roomId = roomId;

  // 날짜 기본값: 오늘
  const dateInput = document.getElementById("modal-date");
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  if (dateInput) dateInput.value = todayStr;

  // 시간표 / 예약 정보 불러오기
  const scheduleData = await fetchRoomSchedule(roomId, todayStr);
  const container = document.getElementById("modal-schedule-content");
  if (container) {
    container.innerHTML = generateScheduleHtml(roomId, scheduleData);
  }

  // 모달 표시
  const modal = document.getElementById("reservation-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }
}

function closeReservationModal() {
  const modal = document.getElementById("reservation-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

/********************************************************
 * 4. 예약 폼 처리
 ********************************************************/

async function handleReservationSubmit(e) {
  e.preventDefault();

  if (!currentRoomId) {
    alert("강의실을 먼저 선택해주세요.");
    return;
  }

  const roomId = currentRoomId;
  const dateEl = document.getElementById("modal-date");
  const startEl = document.getElementById("modal-start-time");
  const endEl = document.getElementById("modal-end-time");
  const purposeEl = document.getElementById("modal-purpose");
  const userEl = document.getElementById("modal-user-name");

  if (!dateEl || !startEl || !endEl || !purposeEl || !userEl) {
    alert("폼 요소를 찾을 수 없습니다.");
    return;
  }

  const date = dateEl.value;
  const startTime = startEl.value;
  const endTime = endEl.value;
  const purpose = purposeEl.value.trim();
  const userName = userEl.value.trim();

  if (!date || !startTime || !endTime || !purpose || !userName) {
    alert("모든 필드를 입력해주세요.");
    return;
  }

  if (startTime >= endTime) {
    alert("종료 시간은 시작 시간보다 늦어야 합니다.");
    return;
  }

  const payload = {
    room_id: roomId,
    date,
    start_time: startTime,
    end_time: endTime,
    purpose,
    user_name: userName,
  };

  const result = await createReservation(payload);

  if (!result.success) {
    alert(result.message || "예약에 실패했습니다.");
    return;
  }

  alert("예약이 완료되었습니다.");
  closeReservationModal();
}

/********************************************************
 * 5. 챗봇 (Claude API 연동 - 서버 → Lambda 프록시 사용)
/********************************************************/

function setupChatbot() {
  const chatbotButton = document.getElementById("chatbot-button");
  const chatbotModal = document.getElementById("chatbot-modal");
  const closeChatbotBtn = document.getElementById("close-chatbot");
  const sendChatBtn = document.getElementById("send-chat");
  const chatInput = document.getElementById("chat-input");
  const chatContainer = document.getElementById("chat-container");

  if (!chatbotButton || !chatbotModal || !closeChatbotBtn || !sendChatBtn || !chatInput || !chatContainer) {
    console.warn("챗봇 요소를 일부 찾지 못했습니다.");
    return;
  }

  chatbotButton.addEventListener("click", () => {
    chatbotModal.classList.remove("hidden");
  });

  closeChatbotBtn.addEventListener("click", () => {
    chatbotModal.classList.add("hidden");
  });

  function addChatMessage(message, sender) {
    const msgDiv = document.createElement("div");

    if (sender === "user") {
      msgDiv.className = "chat-message mb-3";
      msgDiv.innerHTML = `
        <div class="flex justify-end">
          <div class="bg-gray-300 text-gray-800 rounded-lg p-3 max-w-xs text-sm">
            ${message}
          </div>
        </div>`;
    } else if (sender === "bot-temp") {
      msgDiv.className = "chat-message mb-3 bot-temp";
      msgDiv.innerHTML = `
        <div class="bg-gradient-to-r from-blue-400 to-indigo-500 text-white rounded-lg p-3 max-w-xs text-sm opacity-70">
          ${message}
        </div>`;
    } else {
      msgDiv.className = "chat-message mb-3";
      msgDiv.innerHTML = `
        <div class="bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg p-3 max-w-xs text-sm">
          ${message}
        </div>`;
    }

    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    return msgDiv;
  }

  async function generateChatResponse(msg) {
    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }), // 서버가 { message }를 받아 Lambda로 전달
      });

      if (!res.ok) {
        console.error("❌ /api/chat 응답 오류:", res.status);
        return "챗봇 서버와 통신 중 오류가 발생했습니다.";
      }

      const json = await res.json();
      if (!json.success) {
        console.error("❌ /api/chat success=false:", json.message);
        return "챗봇이 현재 응답할 수 없습니다.";
      }

      return json.reply || "응답이 비어 있어요.";
    } catch (err) {
      console.error("❌ generateChatResponse 에러:", err);
      return "챗봇 요청 중 오류가 발생했습니다.";
    }
  }

  async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    addChatMessage(text, "user");
    chatInput.value = "";

    const placeholder = addChatMessage("생각 중입니다...", "bot-temp");

    const reply = await generateChatResponse(text);

    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }

    addChatMessage(reply, "bot");
  }

  sendChatBtn.addEventListener("click", () => {
    sendMessage();
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

/********************************************************
 * 6. React App 컴포넌트: 초기화만 담당
 ********************************************************/

function App() {
  useEffect(() => {
    if (initialized) return; // StrictMode 중복 실행 방지
    initialized = true;

    console.log("🔥 강의실 예약 시스템 초기화 (React 버전)");
    console.log("🌐 API_BASE_URL:", API_BASE_URL);

    // SVG 강의실 클릭 이벤트
    document.querySelectorAll("[id^='room-']").forEach((el) => {
      el.addEventListener("click", () => {
        const roomId = el.id.replace("room-", "");
        console.log("📌 room clicked:", roomId);
        openReservationModal(roomId);
      });
    });

    // 모달 취소 버튼
    const cancelBtn = document.getElementById("cancel-reservation");
    if (cancelBtn) cancelBtn.addEventListener("click", closeReservationModal);

    // 예약 폼 submit
    const form = document.getElementById("reservation-form");
    if (form) form.addEventListener("submit", handleReservationSubmit);

    // 챗봇
    setupChatbot();
  }, []);

  // 실제 UI는 public/index.html에 있으므로 여기선 렌더할 게 없음
  return null;
}

export default App;
