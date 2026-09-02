/**
 * 화면 상단 연결 상태 표시 — 어느 탭(자동/수동/기종설정/알람)을 보고 있어도 항상 보인다.
 * simulator/debugPanel.html의 상단 상태줄(#conn-status)과 같은 목적: 문제 생겼을 때만 배너로
 * 알리는 대신, 지금 연결이 정상인지를 항상 눈으로 확인할 수 있게 한다.
 *
 * 두 가지 단절을 구분해서 각각 표시한다:
 *  1. 서버 연결 — HMI ↔ 서버 WebSocket 자체 (wsClient.onConnectionChange). 이게 끊기면 state
 *     메시지가 아예 안 오므로 화면이 마지막 값에서 멈춘다.
 *  2. PLC 통신 — 서버 ↔ PLC(Modbus) (state.connected). 소켓은 살아있어 서버가 "끊겼다"는 사실은
 *     보내주지만, 센서값 자체는 마지막으로 받은 값(오래된 값)이 그대로 온다.
 */

(function () {
  const wsBadge = document.getElementById("conn-ws");
  const plcBadge = document.getElementById("conn-plc");

  function setBadge(el, text, ok) {
    el.textContent = text;
    el.classList.toggle("ok", ok === true);
    el.classList.toggle("bad", ok === false);
  }

  window.wsClient.onConnectionChange((connected) => {
    setBadge(wsBadge, connected ? "서버 연결: 정상" : "서버 연결: 끊김", connected);
    if (!connected) {
      // 소켓이 끊기면 PLC 상태도 더는 최신이 아니므로 "확인불가"로 표시한다.
      setBadge(plcBadge, "PLC 통신: 확인불가", null);
    }
  });

  window.wsClient.onState((state) => {
    setBadge(plcBadge, state.connected ? "PLC 통신: 정상" : "PLC 통신: 끊김", state.connected);
  });
})();
