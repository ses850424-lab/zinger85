/**
 * 시뮬레이터 디버그 패널용 WebSocket 서버.
 *
 * 실제 PLC에는 없는 기능 — 순수 테스트/개발 편의용이다. Modbus TCP(5020)와는 별개 포트에서
 * 사람이 브라우저(../debugPanel.html)로 시뮬레이터 내부 레지스터 상태를 실시간으로 보고,
 * discreteInputs(센서/버튼)와 sequenceStep을 직접 조작할 수 있게 해준다.
 *
 * 왜 필요한가: 실제 현장에서는 센서·버튼이 물리적으로 눌리면서 discreteInputs가 바뀌지만,
 * 지금은 사람이 그 역할을 대신해야 서버/HMI 쪽 코드를 왕복 테스트할 수 있다. 반대로 Coils와
 * (일부) Holding Register는 서버가 보낸 지령이 시뮬레이터에 실제로 반영됐는지 "눈으로 확인"하는
 * 용도이므로 읽기 전용으로만 보여준다.
 */

const WebSocket = require("ws");
const registerMap = require("../../server/src/modbus/registerMap");

const DEBUG_PORT = 5021;

// discreteInputs, coils, holdingRegisters — mockPlcServer.js가 들고 있는 실제 배열(참조)을 받는다.
// 배열 자체를 받아서 직접 읽고/쓰므로 mockPlcServer.js 쪽 시뮬레이션 로직과 상태를 그대로 공유한다.
function startDebugServer({ discreteInputs, coils, holdingRegisters }) {
  const wss = new WebSocket.Server({ port: DEBUG_PORT });
  console.log(`[debugServer] 디버그 패널 WebSocket 시작: ws://127.0.0.1:${DEBUG_PORT} (simulator/debugPanel.html 접속용)`);

  // registerMap(이름→addr/label/unit)과 현재 값 배열을 함께 보내서, 패널이 이름표를 그릴 수 있게 한다.
  function snapshot() {
    return {
      type: "state",
      registerMap: {
        discreteInputs: registerMap.discreteInputs,
        coils: registerMap.coils,
        holdingRegisters: registerMap.holdingRegisters,
      },
      values: {
        discreteInputs: Array.from(discreteInputs),
        coils: Array.from(coils),
        holdingRegisters: Array.from(holdingRegisters),
      },
    };
  }

  function broadcast() {
    const message = JSON.stringify(snapshot());
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    });
  }

  wss.on("connection", (ws) => {
    console.log("[debugServer] 디버그 패널 접속");
    ws.send(JSON.stringify(snapshot()));

    // 패널에서 오는 조작 명령: discreteInput 토글, sequenceStep(홀딩레지스터) 직접 지정
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        console.error("[debugServer] 잘못된 메시지 형식:", err.message);
        return;
      }

      if (msg.type === "setDiscreteInput" && registerMap.discreteInputs[msg.name]) {
        discreteInputs[registerMap.discreteInputs[msg.name].addr] = msg.value ? 1 : 0;
        console.log(`[debugServer] discreteInput 수동 설정: ${msg.name} = ${msg.value ? 1 : 0}`);
        broadcast();
      } else if (msg.type === "setHoldingRegister" && registerMap.holdingRegisters[msg.name]) {
        holdingRegisters[registerMap.holdingRegisters[msg.name].addr] = Number(msg.value);
        console.log(`[debugServer] holdingRegister 수동 설정: ${msg.name} = ${msg.value}`);
        broadcast();
      }
    });
  });

  // 주기적으로 최신 상태를 밀어준다 (mockPlcServer.js 내부 시뮬레이션 타이머로 바뀐 값도 반영되도록)
  setInterval(broadcast, 300);
}

module.exports = { startDebugServer, DEBUG_PORT };
