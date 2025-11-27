/*******************************************************
 *  강의실 예약 시스템 (public/app.js)
 *  - 백엔드: http://localhost:8000/api
 *  - 사용 테이블: 죽헌_시간표, 학생_강의실예약
 *******************************************************/

// 백엔드 API 기본 URL
const API_BASE_URL = "http://localhost:8000/api";

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
    const res = await fetch(
      `${API_BASE_URL}/rooms/${roomId}/schedule?date=${encodeURIComponent(date)}`
    );

    if (!res.ok) {
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
    const res = await fetch(`${API_BASE_URL}/reservations`, {
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
 * 2. 시간표/예약 카드 HTML 생성 (프로토타입 스타일)
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
  const prettyDate = (() => {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return date;
    return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}. ${String(d.getDate()).padStart(2, "0")}.`;
  })();

  const todayDayName = getKoreanDayName(date); // 오늘 요일 (예약 표시용)

  // ----- 1) "오늘 정규 수업" 리스트를 만들기 위해 오늘 요일만 필터 -----
  const todayLectures = timetable.filter(
    (row) => (row["요일"] || row.day) === todayDayName
  );

  let todayLectureHtml = "";
  if (todayLectures.length === 0) {
    todayLectureHtml = `<div class="text-sm text-gray-500">오늘은 정규 수업이 없습니다.</div>`;
  } else {
    todayLectureHtml = todayLectures
      .map((row) => {
        const subject = row["과목명"] || row.subject || "";
        const prof = row["대표교수"] || row.professor || "";
        const periods = String(row["교시"] || row.periods || "")
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        let timeText = "--:-- ~ --:--";
        if (periods.length > 0) {
          const startP = parseInt(periods[0], 10);
          const endP = parseInt(periods[periods.length - 1], 10) + 1;
          timeText = `${periodToTime(startP)} ~ ${periodToTime(endP)}`;
        }
        return `
          <div class="mb-1">
            <div class="text-sm font-semibold text-gray-800">· ${subject}</div>
            <div class="text-xs text-gray-600">${todayDayName}요일 / ${prof} / ${timeText}</div>
          </div>
        `;
      })
      .join("");
  }

  // ----- 2) 주간 시간표 그리드용 데이터 구성 -----
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

  // ----- 3) 최종 카드 HTML (프로토타입 스타일) -----
  return `
    <div class="h-full flex flex-col gap-4">
      <!-- 상단 카드 (방 정보) -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div class="flex items-center mb-4">
          <div class="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center mr-3">
            <svg class="w-5 h-5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1z"/>
            </svg>
          </div>
          <div>
            <div class="text-sm font-semibold text-gray-700">시간표 및 예약 현황</div>
            <div class="text-xs text-gray-400">선택한 강의실의 정규 수업과 학생 예약 정보를 보여줍니다.</div>
          </div>
        </div>

        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="text-base font-semibold text-gray-900">${room.name}</div>
            <div class="text-xs text-gray-500">${prettyDate}</div>
          </div>
          <div class="text-xs text-gray-500">
            수용인원: <span class="font-semibold">${room.capacity}</span>명
          </div>
        </div>

        <div class="flex flex-wrap gap-2 mb-2">
          ${room.features
            .map(
              (f) =>
                `<span class="inline-flex items-center px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">${f}</span>`
            )
            .join("")}
        </div>
        <div class="text-xs text-gray-500">
          유형: <span class="font-medium">${room.type}</span>
        </div>
      </div>

      <!-- 주간 시간표 -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex-1 flex flex-col min-h-[220px]">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm font-semibold text-gray-800">주간 시간표</div>
          <div class="flex items-center space-x-3 text-[10px] text-gray-500">
            <div class="flex items-center">
              <span class="w-3 h-3 rounded-full bg-rose-200 border border-rose-300 mr-1"></span> 수업중
            </div>
            <div class="flex items-center">
              <span class="w-3 h-3 rounded-full bg-emerald-200 border border-emerald-300 mr-1"></span> 예약시간
            </div>
          </div>
        </div>
        <div class="overflow-x-auto text-xs">
          <table class="w-full border border-gray-200 rounded-lg text-[11px]">
            <thead class="bg-gray-50">
              <tr>
                <th class="border border-gray-200 px-2 py-1 text-center font-medium">시간</th>
                ${days
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
  roomInput.value = room.name;
  roomInput.dataset.roomId = roomId;

  // 날짜 기본값: 오늘
  const dateInput = document.getElementById("modal-date");
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  dateInput.value = todayStr;

  // 시간표 / 예약 정보 불러오기
  const scheduleData = await fetchRoomSchedule(roomId, todayStr);
  const container = document.getElementById("modal-schedule-content");
  container.innerHTML = generateScheduleHtml(roomId, scheduleData);

  // 모달 표시
  const modal = document.getElementById("reservation-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeReservationModal() {
  const modal = document.getElementById("reservation-modal");
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
  const date = document.getElementById("modal-date").value;
  const startTime = document.getElementById("modal-start-time").value;
  const endTime = document.getElementById("modal-end-time").value;
  const purpose = document.getElementById("modal-purpose").value.trim();
  const userName = document.getElementById("modal-user-name").value.trim();

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
 * 5. 챗봇 (기존 기능 유지)
 ********************************************************/

function setupChatbot() {
  const chatbotButton = document.getElementById("chatbot-button");
  const chatbotModal = document.getElementById("chatbot-modal");
  const closeChatbotBtn = document.getElementById("close-chatbot");
  const sendChatBtn = document.getElementById("send-chat");
  const chatInput = document.getElementById("chat-input");
  const chatContainer = document.getElementById("chat-container");

  if (!chatbotButton) return;

  chatbotButton.addEventListener("click", () => {
    chatbotModal.classList.remove("hidden");
  });

  closeChatbotBtn.addEventListener("click", () => {
    chatbotModal.classList.add("hidden");
  });

  function addChatMessage(message, sender) {
    const msgDiv = document.createElement("div");
    msgDiv.className = "chat-message mb-3";
    if (sender === "user") {
      msgDiv.innerHTML = `
        <div class="flex justify-end">
          <div class="bg-gray-300 text-gray-800 rounded-lg p-3 max-w-xs text-sm">
            ${message}
          </div>
        </div>`;
    } else {
      msgDiv.innerHTML = `
        <div class="bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg p-3 max-w-xs text-sm">
          ${message}
        </div>`;
    }
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function generateChatResponse(msg) {
    const m = msg.toLowerCase();
    if (m.includes("스터디")) {
      return "👥 스터디에 적합한 강의실은 803호(세미나실), 807호(일반강의실)입니다.";
    }
    if (m.includes("발표") || m.includes("프레젠테이션")) {
      return "📽 발표용으로는 801호, 802호, 807호(프로젝터 보유)를 추천합니다.";
    }
    if (m.includes("컴퓨터") || m.includes("실습")) {
      return "💻 컴퓨터 실습에는 808호가 적합합니다.";
    }
    return "원하는 인원 수, 용도(스터디/발표/실습 등)를 알려주시면 강의실을 추천해 드릴게요!";
  }

  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    addChatMessage(text, "user");
    chatInput.value = "";
    setTimeout(() => {
      addChatMessage(generateChatResponse(text), "bot");
    }, 500);
  }

  sendChatBtn.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

/********************************************************
 * 6. 초기화
 ********************************************************/

document.addEventListener("DOMContentLoaded", () => {
  console.log("🔥 강의실 예약 시스템 초기화(프로토타입 스타일)");

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
});
