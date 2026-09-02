/**
 * 수동모드 화면 (셋업·유지보수용).
 * 근거: docs/01_설비개요.md 6항, 2026-08-31 수동화면 개편 요청
 * 포함 기능: 파렛트 회전(RPM+토크/전류), 노즐 X/Z 서보(목표위치 이동+시운전속도+토크/전류),
 * 실린더류(위치이동/리프트/노즐회전) 전후진 + 완료센서 표시, 도어 개폐+실링, 고압펌프 on/off
 *
 * PLC 통신 로직은 직접 넣지 않고 wsClient.js(window.wsClient)를 거쳐서만 서버와 통신한다.
 */

(function () {
  const container = document.getElementById("manual-screen");

  container.innerHTML = `
    <h2>수동모드</h2>
    <button type="button" id="manual-goto-auto">자동모드로 복귀</button>

    <h3>파렛트 회전 (턴테이블)</h3>
    <input type="number" id="manual-rpm" placeholder="rpm" min="0" step="1" value="12">
    <button type="button" id="manual-rpm-start">회전 시작</button>
    <button type="button" id="manual-rpm-stop">정지</button>
    <p>
      운전상태: <span id="manual-inverter-running">-</span> /
      토크: <span id="manual-inverter-torque">-</span>N·m /
      전류: <span id="manual-inverter-current">-</span>A
    </p>

    <h3>노즐 X축</h3>
    <input type="number" id="manual-x-mm" placeholder="목표위치(mm)" min="0" max="800" step="0.1">
    <button type="button" id="manual-x-move">이동</button>
    <br>
    <input type="number" id="manual-x-speed" placeholder="시운전 속도(mm/s)" min="0" step="0.1">
    <button type="button" id="manual-x-speed-set">속도 설정</button>
    <p>
      현재위치: <span id="manual-x-pos">-</span>mm /
      토크: <span id="manual-x-torque">-</span>N·m /
      전류: <span id="manual-x-current">-</span>A
    </p>

    <h3>노즐 Z축</h3>
    <input type="number" id="manual-z-mm" placeholder="목표위치(mm)" min="0" step="0.1">
    <button type="button" id="manual-z-move">이동</button>
    <br>
    <input type="number" id="manual-z-speed" placeholder="시운전 속도(mm/s)" min="0" step="0.1">
    <button type="button" id="manual-z-speed-set">속도 설정</button>
    <p>
      현재위치: <span id="manual-z-pos">-</span>mm /
      토크: <span id="manual-z-torque">-</span>N·m /
      전류: <span id="manual-z-current">-</span>A
    </p>

    <h3>위치이동실린더</h3>
    <button type="button" id="manual-pos-advance">전진</button>
    <button type="button" id="manual-pos-retract">후진</button>
    <p>전진완료: <span id="manual-pos-advanced">-</span> / 후진완료: <span id="manual-pos-retracted">-</span></p>

    <h3>리프트실린더</h3>
    <button type="button" id="manual-lift-raise">상승</button>
    <button type="button" id="manual-lift-lower">하강</button>
    <p>상승완료: <span id="manual-lift-raised">-</span> / 하강완료: <span id="manual-lift-lowered">-</span></p>

    <h3>노즐회전실린더 (전진=90도 틸팅 / 후진=원복)</h3>
    <button type="button" id="manual-nozzle-rot-advance">전진(틸팅)</button>
    <button type="button" id="manual-nozzle-rot-retract">후진(원복)</button>
    <p>전진완료: <span id="manual-nozzle-rot-advanced">-</span> / 후진완료: <span id="manual-nozzle-rot-retracted">-</span></p>

    <h3>도어</h3>
    <button type="button" id="manual-door-open">열림</button>
    <button type="button" id="manual-door-close">닫힘</button>
    <button type="button" id="manual-sealing-on">실링 On</button>
    <button type="button" id="manual-sealing-off">실링 Off</button>
    <p>도어 상태: <span id="manual-door-status">-</span></p>

    <h3>고압펌프</h3>
    <button type="button" id="manual-pump-on">On</button>
    <button type="button" id="manual-pump-off">Off</button>
    <p id="manual-pump-hint" class="warn"></p>
  `;

  container.querySelector("#manual-goto-auto").addEventListener("click", () => {
    window.wsClient.send("setMode", { mode: "auto" });
    window.showScreen("main-screen");
  });

  // 파렛트 회전
  container.querySelector("#manual-rpm-start").addEventListener("click", () => {
    const rpm = Number(container.querySelector("#manual-rpm").value);
    window.wsClient.send("setRotationSpeed", { rpm });
  });
  container.querySelector("#manual-rpm-stop").addEventListener("click", () => {
    window.wsClient.send("setRotationSpeed", { rpm: 0 });
  });

  // 노즐 X축
  container.querySelector("#manual-x-move").addEventListener("click", () => {
    const mm = Number(container.querySelector("#manual-x-mm").value);
    window.wsClient.send("servoAxisX.moveTo", { mm });
  });
  container.querySelector("#manual-x-speed-set").addEventListener("click", () => {
    const mmPerSec = Number(container.querySelector("#manual-x-speed").value);
    window.wsClient.send("servoAxisX.setSpeed", { mmPerSec });
  });

  // 노즐 Z축
  container.querySelector("#manual-z-move").addEventListener("click", () => {
    const mm = Number(container.querySelector("#manual-z-mm").value);
    window.wsClient.send("servoAxisZ.moveTo", { mm });
  });
  container.querySelector("#manual-z-speed-set").addEventListener("click", () => {
    const mmPerSec = Number(container.querySelector("#manual-z-speed").value);
    window.wsClient.send("servoAxisZ.setSpeed", { mmPerSec });
  });

  // 위치이동실린더
  container.querySelector("#manual-pos-advance").addEventListener("click", () => {
    window.wsClient.send("positionCylinder.advance");
  });
  container.querySelector("#manual-pos-retract").addEventListener("click", () => {
    window.wsClient.send("positionCylinder.retract");
  });

  // 리프트실린더
  container.querySelector("#manual-lift-raise").addEventListener("click", () => {
    window.wsClient.send("liftCylinder.raise");
  });
  container.querySelector("#manual-lift-lower").addEventListener("click", () => {
    window.wsClient.send("liftCylinder.lower");
  });

  // 노즐회전실린더
  container.querySelector("#manual-nozzle-rot-advance").addEventListener("click", () => {
    window.wsClient.send("nozzleRotationCylinder.advance");
  });
  container.querySelector("#manual-nozzle-rot-retract").addEventListener("click", () => {
    window.wsClient.send("nozzleRotationCylinder.retract");
  });

  // 도어 + 실링
  container.querySelector("#manual-door-open").addEventListener("click", () => {
    window.wsClient.send("door.open");
  });
  container.querySelector("#manual-door-close").addEventListener("click", () => {
    window.wsClient.send("door.close");
  });
  container.querySelector("#manual-sealing-on").addEventListener("click", () => {
    window.wsClient.send("door.setSealing", { on: true });
  });
  container.querySelector("#manual-sealing-off").addEventListener("click", () => {
    window.wsClient.send("door.setSealing", { on: false });
  });

  // 고압펌프
  const pumpOnBtn = container.querySelector("#manual-pump-on");
  pumpOnBtn.addEventListener("click", () => {
    window.wsClient.send("pump.on");
  });
  container.querySelector("#manual-pump-off").addEventListener("click", () => {
    window.wsClient.send("pump.off");
  });

  function boolText(el, value) {
    el.textContent = value ? "완료" : "-";
    el.className = value ? "ok" : "";
  }

  window.wsClient.onState((state) => {
    // sensors는 PLC와 한 번도 통신에 성공하기 전까지만 null — connectionStatus.js가 배너로
    // 알리므로, 여기서는 값이 없으면 그냥 이전 표시를 유지하고 갱신을 건너뛴다.
    if (!state.sensors) return;
    const inv = state.sensors.inverter;
    container.querySelector("#manual-inverter-running").textContent = inv.running ? "운전중" : "정지";
    container.querySelector("#manual-inverter-torque").textContent = inv.torqueNm.toFixed(2);
    container.querySelector("#manual-inverter-current").textContent = inv.currentA.toFixed(2);

    const sx = state.sensors.servoX;
    container.querySelector("#manual-x-pos").textContent = sx.currentPositionMm.toFixed(1);
    container.querySelector("#manual-x-torque").textContent = sx.torqueNm.toFixed(2);
    container.querySelector("#manual-x-current").textContent = sx.currentA.toFixed(2);

    const sz = state.sensors.servoZ;
    container.querySelector("#manual-z-pos").textContent = sz.currentPositionMm.toFixed(1);
    container.querySelector("#manual-z-torque").textContent = sz.torqueNm.toFixed(2);
    container.querySelector("#manual-z-current").textContent = sz.currentA.toFixed(2);

    const prox = state.sensors.proximity;
    boolText(container.querySelector("#manual-pos-advanced"), prox["위치이동실린더_전진완료"]);
    boolText(container.querySelector("#manual-pos-retracted"), prox["위치이동실린더_후진완료"]);
    boolText(container.querySelector("#manual-lift-raised"), prox["리프트실린더_상승완료"]);
    boolText(container.querySelector("#manual-lift-lowered"), prox["리프트실린더_하강완료"]);

    const rot = state.sensors.nozzleRotation;
    boolText(container.querySelector("#manual-nozzle-rot-advanced"), rot.advanced);
    boolText(container.querySelector("#manual-nozzle-rot-retracted"), rot.retracted);

    const doorClosed = state.sensors.door.closedAndLocked;
    const doorEl = container.querySelector("#manual-door-status");
    doorEl.textContent = doorClosed ? "닫힘/잠김" : "열림/미확인";
    doorEl.className = doorClosed ? "ok" : "warn";

    // 고압펌프 On 버튼 활성화 조건: 위치이동실린더 후진완료 + 리프트 상승완료 + 도어 닫힘
    // ⚠️ UI 편의 기능일 뿐 — 실제 안전판단/전원 인가는 PLC/하드와이어드가 한다 (CLAUDE.md 원칙)
    const pumpReady = !!prox["위치이동실린더_후진완료"] && !!prox["리프트실린더_상승완료"] && doorClosed;
    pumpOnBtn.disabled = !pumpReady;
    container.querySelector("#manual-pump-hint").textContent = pumpReady
      ? ""
      : "펌프 On 조건 미충족: 위치이동실린더 후진 + 리프트 상승 + 도어 닫힘 필요";
  });
})();
