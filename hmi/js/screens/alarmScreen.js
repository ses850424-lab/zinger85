/**
 * 알람이력 / 사이클카운트 / 인터록·비상정지 상태 표시 화면.
 * 근거: docs/01_설비개요.md 6항
 *
 * 알람 목록은 서버(wsServer.js)가 상태 전이를 감지해서 보내주는 것을 그대로 표시만 한다
 * — 이 화면이 알람 여부를 스스로 판단하지 않는다.
 */

(function () {
  const container = document.getElementById("alarm-screen");

  container.innerHTML = `
    <h2>알람 / 이력</h2>
    <p>사이클 카운트: <span id="alarm-cycle-count">-</span></p>
    <ul id="alarm-list"></ul>
  `;

  const cycleCountEl = container.querySelector("#alarm-cycle-count");
  const listEl = container.querySelector("#alarm-list");

  window.wsClient.onState((state) => {
    cycleCountEl.textContent = state.cycleCount;

    listEl.innerHTML = "";
    state.alarms.forEach((alarm) => {
      const li = document.createElement("li");
      li.textContent = `[${new Date(alarm.time).toLocaleString()}] ${alarm.message}`;
      listEl.appendChild(li);
    });
  });
})();
