/**
 * Modbus TCP 클라이언트 — PLC와의 연결/재접속을 담당.
 *
 * 참고 문서: docs/02_IO_태그맵.md (통신방식 미확정 — 레지스터 의미는 아직 모름).
 *          이 파일은 registerMap.js 가 채워지기 전까지는 "주소를 직접 받는" 형태로만 동작한다.
 *          docs/04_확인필요사항.md 의 "서보앰프-PLC 통신방식", "인버터-PLC 통신방식" 항목이
 *          확정되면 registerMap.js 를 참조하는 헬퍼를 추가한다.
 *
 * 개발 순서 (PROJECT_PLAN.md Phase 1):
 *   1. simulator/src/mockPlcServer.js 를 대상으로 먼저 연결 테스트 (이 파일 하단 자가 테스트 블록)
 *   2. 연결 끊김 시 재접속 로직(backoff) 구현
 *   3. registerMap.js 를 이용해 읽기/쓰기 헬퍼 함수 제공 (readHoldingRegisters, writeRegister)
 *
 * 폴링 루프는 여기서 만들지 않는다 — plcConfig.js 의 pollingIntervalMs 가 아직 미확정(null)이며,
 * 폴링은 Phase 3(stateMachine.js)에서 값이 정해진 뒤 구현한다.
 */

const ModbusRTU = require("modbus-serial");

const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
// modbus-serial 라이브러리는 TCP 연결이 리셋(ECONNRESET 등)될 때 close/error 이벤트를
// 상위(ModbusRTU 인스턴스)로 올려주지 않는 경우가 있음 (내부적으로 openFlag만 조용히 false로
// 바뀜) — 이를 잡기 위해 주기적으로 isOpen 상태를 확인하는 워치독을 둔다.
const WATCHDOG_INTERVAL_MS = 2000;

function createModbusClient() {
  const client = new ModbusRTU();
  client.setID(1);

  let target = null; // 접속 대상 { host, port } — connect() 호출 시 저장
  let reconnectDelayMs = MIN_RECONNECT_DELAY_MS; // 다음 재접속까지 대기시간 (매 실패마다 2배씩 증가)
  let reconnectTimer = null; // 예약된 재접속 setTimeout 핸들 (중복 예약 방지용)
  let watchdogTimer = null; // 아래 checkHealth()를 주기적으로 돌리는 setInterval 핸들
  let connecting = false; // connectTCP 시도가 진행 중인지 (중복 접속 시도 방지용)
  let stopped = true; // disconnect() 호출 후에는 재접속을 아예 시도하지 않기 위한 플래그

  // 재접속을 backoff(1s→2s→4s→...→최대 30s)로 예약한다.
  // 이미 예약돼 있거나(reconnectTimer) 사용자가 disconnect()한 상태(stopped)면 아무것도 안 함.
  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    console.log(`[modbus/client] ${reconnectDelayMs}ms 후 재접속 시도`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      doConnect();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }

  // 실제 TCP 접속 시도. 성공하면 backoff 대기시간을 초기값으로 리셋하고,
  // 실패하면 scheduleReconnect()로 다음 재시도를 예약한다.
  function doConnect() {
    if (stopped || !target || connecting) return;
    connecting = true;
    client.connectTCP(target.host, { port: target.port }, (err) => {
      connecting = false;
      if (err) {
        console.error("[modbus/client] 연결 실패:", err.message);
        scheduleReconnect();
        return;
      }
      reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
      console.log(`[modbus/client] 연결됨: ${target.host}:${target.port}`);
    });
  }

  // 워치독: 2초마다 실제 연결 상태(client.isOpen)를 직접 확인한다.
  // 이유(테스트로 확인한 실제 문제) — modbus-serial 라이브러리는 TCP 연결이 리셋(ECONNRESET 등)될 때
  // close/error 이벤트를 상위(ModbusRTU 인스턴스)로 안 올려주고 내부 openFlag만 조용히 꺼뜨리는
  // 경우가 있었다. 이벤트만 믿으면 그 케이스에서 영원히 재접속을 안 하게 되므로, 상태를 직접
  // 폴링해서 놓치는 경우가 없도록 이중으로 감시한다.
  function checkHealth() {
    if (stopped || connecting || reconnectTimer) return;
    if (!client.isOpen) {
      console.warn("[modbus/client] 연결 끊김 감지(워치독)");
      scheduleReconnect();
    }
  }

  // 소켓 오류 로그 (연결 유지 여부는 워치독이 판단하므로 여기서는 로그만 남김)
  client.on("error", (err) => {
    console.error("[modbus/client] 소켓 오류:", err.message);
  });

  // 정상적으로 close 이벤트가 올라오는 경우(예: 상대가 정상 종료) 즉시 재접속 예약.
  // (워치독과 별개로, 이벤트가 제대로 오는 경우엔 더 빠르게 반응하기 위해 둘 다 둔다)
  client.on("close", () => {
    console.warn("[modbus/client] 연결 끊김(close 이벤트)");
    if (!stopped) scheduleReconnect();
  });

  return {
    /** target: { host, port } — 개발 중에는 plcConfig.simulator, 실 PLC 연동 후 plcConfig.plc */
    connect(connectTarget) {
      target = connectTarget;
      stopped = false;
      reconnectDelayMs = MIN_RECONNECT_DELAY_MS;
      doConnect();
      if (!watchdogTimer) {
        watchdogTimer = setInterval(checkHealth, WATCHDOG_INTERVAL_MS);
      }
    },

    // 의도적인 연결 종료. stopped=true로 표시해서 이후 close/워치독이 재접속을 시도하지 않게 한다.
    disconnect() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      client.close(() => {});
    },

    // 현재 접속 상태 확인 (호출부에서 접속 완료를 기다리거나 상태를 표시할 때 사용)
    isOpen() {
      return client.isOpen;
    },

    // 주소 address부터 length개 홀딩 레지스터 읽기 — registerMap.js 확정 전까지는 주소를 직접 받는다
    async readHoldingRegisters(address, length) {
      const result = await client.readHoldingRegisters(address, length);
      return result.data;
    },

    // 주소 address에 값 value 쓰기 (단일 레지스터, 함수코드 06)
    async writeRegister(address, value) {
      await client.writeRegister(address, value);
    },

    // 주소 address부터 length개 discrete input 읽기 (읽기전용 비트, 함수코드 02) — 센서 상태용
    async readDiscreteInputs(address, length) {
      const result = await client.readDiscreteInputs(address, length);
      return result.data;
    },

    // 주소 address부터 length개 코일 읽기 (읽기·쓰기 비트, 함수코드 01) — 밸브/펌프 등 출력 상태 확인용
    async readCoils(address, length) {
      const result = await client.readCoils(address, length);
      return result.data;
    },

    // 주소 address의 코일에 boolean 값 쓰기 (함수코드 05) — 밸브/펌프 등 출력 지령용
    async writeCoil(address, value) {
      await client.writeCoil(address, value);
    },
  };
}

module.exports = { createModbusClient };

// 연결성 자가 테스트 (Phase 1 완료조건 검증용)
// 실행: node server/src/modbus/client.js  (먼저 simulator/src/mockPlcServer.js 를 켜둘 것)
if (require.main === module) {
  const plcConfig = require("../config/plcConfig");

  const ECHO_REG = 1;
  const CYLINDER_CMD_REG = 2;
  const CYLINDER_DONE_REG = 3;
  const CYLINDER_DELAY_WAIT_MS = 2000; // mockPlcServer.js 의 지연(1500ms)보다 여유있게 대기

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  (async () => {
    const modbus = createModbusClient();
    modbus.connect(plcConfig.simulator);

    // 연결이 잡힐 때까지 대기 (간단한 폴링, Phase 1 테스트용)
    for (let i = 0; i < 20 && !modbus.isOpen(); i++) {
      await sleep(200);
    }
    if (!modbus.isOpen()) {
      console.error("[self-test] 연결 실패 — simulator가 켜져 있는지 확인하세요.");
      process.exit(1);
    }

    try {
      // 테스트 1: 에코 레지스터 왕복 확인 — 임의 값을 썼다가 그대로 읽히는지 확인해서
      // 쓰기/읽기 요청이 실제로 simulator까지 왕복하는지 검증한다.
      const testValue = Math.floor(Math.random() * 1000);
      console.log(`[self-test] 에코 레지스터(${ECHO_REG})에 ${testValue} 쓰기`);
      await modbus.writeRegister(ECHO_REG, testValue);
      const [echoed] = await modbus.readHoldingRegisters(ECHO_REG, 1);
      console.log(`[self-test] 읽은 값: ${echoed} — ${echoed === testValue ? "일치 ✅" : "불일치 ❌"}`);

      // 테스트 2: 실린더 명령→완료신호 지연 확인 — mockPlcServer.js 가 명령 레지스터에 1을 받으면
      // 일정 시간 뒤 완료 레지스터를 자동으로 켜주는지 확인한다 (실제 실린더 동작 흉내가 맞는지 검증).
      console.log(`[self-test] 실린더 명령 레지스터(${CYLINDER_CMD_REG})에 1 쓰기`);
      await modbus.writeRegister(CYLINDER_CMD_REG, 1);
      await sleep(CYLINDER_DELAY_WAIT_MS);
      const [done] = await modbus.readHoldingRegisters(CYLINDER_DONE_REG, 1);
      console.log(`[self-test] 완료 레지스터(${CYLINDER_DONE_REG}) 값: ${done} — ${done === 1 ? "완료신호 확인 ✅" : "완료신호 없음 ❌"}`);
    } catch (err) {
      console.error("[self-test] 오류:", err.message);
    } finally {
      modbus.disconnect();
      process.exit(0);
    }
  })();
}
