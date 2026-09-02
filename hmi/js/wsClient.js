/**
 * server/src/api/wsServer.js 와의 WebSocket 통신 클라이언트.
 * 서버로부터 시퀀스 단계/센서상태/알람을 수신하고, 사용자 명령(모드전환, 시작/정지,
 * 회전속도 설정, 수동조작)을 서버로 전송한다.
 *
 * 브라우저 전역에 window.wsClient 로 노출한다 (빌드 도구 없이 <script> 태그로 순서대로
 * 로드하는 구조라, screens/*.js 는 이 전역을 그대로 사용한다).
 *
 * ⚠️ 연결 끊김을 조용히 숨기지 않는다: state 메시지 안의 connected 필드(PLC/Modbus 쪽 상태)와는
 * 별개로, 이 소켓 자체(HMI↔서버)가 끊기면 state 메시지가 아예 안 오므로 화면이 마지막 값에서
 * 멈춘 채 아무 표시도 없이 "정상"처럼 보일 수 있다. 그래서 open/close를 onConnectionChange로
 * 별도 노출해 hmi/js/connectionStatus.js 가 배너로 알리게 한다.
 */

(function () {
  // wsServer.js 의 wsConfig.js 포트(8081)와 맞춰야 한다. 현재 페이지를 띄운 호스트로 접속.
  const WS_PORT = 8081;
  const RECONNECT_DELAY_MS = 2000; // 브라우저 탭이 떠있는 동안만 필요한 간단한 고정 지연 재시도

  let socket = null;
  const stateListeners = [];
  const connectionListeners = [];

  function connect() {
    // index.html을 file://로 직접 열면 location.hostname이 빈 문자열이라 fallback 필요
    // (debugPanel.html과 동일한 패턴)
    const host = location.hostname || "127.0.0.1";
    socket = new WebSocket(`ws://${host}:${WS_PORT}`);

    socket.addEventListener("open", () => {
      console.log("[wsClient] 서버 연결됨");
      connectionListeners.forEach((listener) => listener(true));
    });

    socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        console.error("[wsClient] 잘못된 메시지 형식:", err);
        return;
      }
      if (msg.type === "state") {
        stateListeners.forEach((listener) => listener(msg));
      }
    });

    socket.addEventListener("close", () => {
      console.warn(`[wsClient] 연결 끊김 — ${RECONNECT_DELAY_MS}ms 후 재접속`);
      connectionListeners.forEach((listener) => listener(false));
      setTimeout(connect, RECONNECT_DELAY_MS);
    });

    socket.addEventListener("error", (err) => {
      console.error("[wsClient] 소켓 오류:", err);
    });
  }

  // 상태 메시지를 받을 때마다 호출될 콜백 등록 (여러 화면이 각자 구독 가능)
  function onState(callback) {
    stateListeners.push(callback);
  }

  // 소켓 자체(HMI↔서버)가 열리거나 끊길 때 호출될 콜백 등록. connected(boolean)를 받는다.
  function onConnectionChange(callback) {
    connectionListeners.push(callback);
  }

  // 명령 전송: action은 wsServer.js 의 COMMAND_HANDLERS 키와 일치해야 한다
  function send(action, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn(`[wsClient] 연결 안 됨 — 명령 무시: ${action}`);
      return;
    }
    socket.send(JSON.stringify({ type: "command", action, payload: payload || {} }));
  }

  connect();

  window.wsClient = { onState, onConnectionChange, send };
})();
