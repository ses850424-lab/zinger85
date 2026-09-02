/**
 * 자동모드 화면.
 * 근거: docs/01_설비개요.md 6항
 * 포함 기능:
 *  - 사이클 시작/정지
 *  - 현재 단계 표시 (docs/03_공정시퀀스.md 0~9단계)
 *  - 파렛트 회전속도 설정 (슬라이더) — 인버터로 실시간 반영, 세척력 튜닝용
 *  - 도어·비상정지·고압펌프 이상 상태 표시 (판단은 PLC, 여기서는 표시만)
 *
 * PLC 통신 로직은 직접 넣지 않고 wsClient.js(window.wsClient)를 거쳐서만 서버와 통신한다.
 */

(function () {
  const container = document.getElementById("main-screen");

  const STEP_LABELS = [
    "0. 대기", "1. 파렛트 로딩", "2. 위치이동", "3. 리프트 업", "4. 안전 확인",
    "5. 세척", "6. 세척 종료", "7. 리프트 다운", "8. 위치 복귀", "9. 완료",
  ];

  container.innerHTML = `
    <h2>자동모드</h2>
    <p>현재 단계: <span id="main-step">-</span></p>
    <button type="button" id="main-cycle-start">사이클 시작</button>
    <button type="button" id="main-cycle-stop">사이클 정지</button>
    <button type="button" id="main-goto-manual">수동모드로 전환</button>

    <p>
      파렛트 회전속도:
      <input type="range" id="main-speed" min="0" max="60" step="1" value="12">
      <span id="main-speed-value">12</span> rpm
    </p>

    <ul>
      <li>도어: <span id="main-door">-</span></li>
      <li>비상정지: <span id="main-estop">-</span></li>
      <li>고압펌프 이상: <span id="main-pump">-</span></li>
    </ul>
  `;

  const stepEl = container.querySelector("#main-step");
  const doorEl = container.querySelector("#main-door");
  const estopEl = container.querySelector("#main-estop");
  const pumpEl = container.querySelector("#main-pump");
  const speedInput = container.querySelector("#main-speed");
  const speedValueEl = container.querySelector("#main-speed-value");

  container.querySelector("#main-cycle-start").addEventListener("click", () => {
    window.wsClient.send("cycleStart");
  });
  container.querySelector("#main-cycle-stop").addEventListener("click", () => {
    window.wsClient.send("cycleStop");
  });
  container.querySelector("#main-goto-manual").addEventListener("click", () => {
    window.wsClient.send("setMode", { mode: "manual" });
    window.showScreen("manual-screen");
  });

  // 슬라이더를 움직이는 동안(input)엔 화면 숫자만 갱신, 손을 뗄 때(change)만 서버로 전송
  // — 매 픽셀마다 Modbus write를 보내지 않기 위함
  speedInput.addEventListener("input", () => {
    speedValueEl.textContent = speedInput.value;
  });
  speedInput.addEventListener("change", () => {
    window.wsClient.send("setRotationSpeed", { rpm: Number(speedInput.value) });
  });

  window.wsClient.onState((state) => {
    stepEl.textContent = state.sequenceStep === null ? "-" : (STEP_LABELS[state.sequenceStep] || state.sequenceStep);
    // sensors는 PLC와 한 번도 통신에 성공하기 전까지만 null — connectionStatus.js가 배너로
    // 알리므로, 여기서는 값이 없으면 그냥 이전 표시를 유지하고 갱신을 건너뛴다.
    if (!state.sensors) return;
    doorEl.textContent = state.sensors.door.closedAndLocked ? "닫힘/잠김" : "열림/미확인";
    doorEl.className = state.sensors.door.closedAndLocked ? "ok" : "warn";
    estopEl.textContent = state.sensors.estop.pressed ? "눌림" : "정상";
    estopEl.className = state.sensors.estop.pressed ? "alarm" : "ok";
    const pumpAbnormal = state.sensors.pump.pressureAbnormal || state.sensors.pump.flowAbnormal;
    pumpEl.textContent = pumpAbnormal ? "이상" : "정상";
    pumpEl.className = pumpAbnormal ? "alarm" : "ok";
  });
})();
