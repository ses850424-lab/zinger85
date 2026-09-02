/**
 * 가상 PLC — Modbus TCP 서버.
 * 실제 PLC 납품 전까지 server/ 와 hmi/ 를 개발·테스트하기 위한 목적.
 *
 * 근거: docs/02_IO_태그맵.md (2026-08-31 "제안 초안" 확정), docs/03_공정시퀀스.md
 *
 * Phase 2: docs/02_IO_태그맵.md 가 "제안 초안"으로 정리된 것을 반영해, registerMap.js 와
 * 동일한 레이아웃(discreteInputs/coils/holdingRegisters)의 가상 메모리를 만든다.
 * 실린더/서보/인버터 동작은 아래처럼 흉내낸다 (모두 테스트용 임의 지연값, 실기 데이터 아님):
 *   - 실린더 코일에 1을 쓰면 일정 지연 후 대응하는 완료 discrete input이 켜지고, 반대방향 완료비트는 꺼진다
 *   - 서보 "위치지령" 홀딩레지스터에 값이 쓰이면(2026-08-31 확정: 이동시작 코일 방식 대체) 이동완료
 *     비트가 먼저 꺼지고, 지연 후 현재위치 레지스터에 지령값이 반영되면서 이동완료 비트가 켜진다
 *   - 인버터 속도지령 레지스터가 0보다 크면 운전상태 discrete input이 즉시 켜지고, 0이면 꺼진다
 *   - 2026-08-31 신규(수동화면 개편): 서보/인버터가 "동작 중"일 때 토크·전류 레지스터에
 *     임의 테스트값을 넣어주고, 정지/완료되면 0으로 되돌린다 (실제 센서값 아님 — 화면에서
 *     "회전할 때 값이 바뀌는지" 눈으로 확인하기 위한 용도)
 *   - 도어_닫힘 코일에 1을 쓰면 지연 후 안전도어_닫힘잠김이 켜지고, 도어_열림이면 꺼진다
 */

const ModbusRTU = require("modbus-serial");
const registerMap = require("../../server/src/modbus/registerMap");

// server/src/config/plcConfig.js 의 simulator 설정(127.0.0.1:5020)과 동일한 값.
// 두 파일이 다른 npm 패키지에 속해 있어 직접 import할 수 없으므로 값만 동기화해서 유지한다.
// plcConfig.js 의 simulator 설정이 바뀌면 이 값도 같이 바꿀 것.
const HOST = "127.0.0.1";
const PORT = 5020;

// 테스트용 임의 지연값 — 실제 실린더/서보 동작시간과 무관, 연결성/왕복 확인용
const CYLINDER_DELAY_MS = 1500;
const SERVO_MOVE_DELAY_MS = 1000;
const WAYPOINT_SAVE_DELAY_MS = 200; // 경로점 저장은 물리 동작이 아니라 단순 레지스터 기록이라 짧게 잡음
// 토크/전류 테스트값 — 실제 센서값이 아니라 "동작 중엔 0이 아닌 값이 보인다"는 것만 확인하기 위한 임의 고정값
const TEST_TORQUE_RAW = 80; // 0.01N·m 단위 → 0.80N·m
const TEST_CURRENT_RAW = 210; // 0.01A 단위 → 2.10A

const { discreteInputs: DI, coils: COIL, holdingRegisters: HR } = registerMap;

// 가상 레지스터 메모리 — 인덱스가 곧 Modbus 주소, 각 자료형별로 별도 배열(별도 주소공간)
// 크기는 registerMap.js 의 최대 addr+1 — discreteInputs가 늘어나면 이 숫자도 같이 늘려야 함
const discreteInputs = new Array(21).fill(0);
const coils = new Array(16).fill(0);
const holdingRegisters = new Array(20).fill(0);

// 기종별 노즐 경로(웨이포인트) — 실제 PLC의 레시피 메모리를 흉내낸 것.
// key: "FF-1" 형태, value: { x, z } 배열(인덱스 순서) — 테스트 스크립트가 전달 결과를 검증할 때 참조한다.
const vehicleModelWaypoints = {};

// 경로점_저장 코일이 켜질 때, 지금 레지스터에 실린 모델/인덱스/X/Z 값을 레시피에 기록하고
// 경로_저장개수를 갱신한다 (docs/05_차량기종.md 참고).
function recordWaypointPoint() {
  const category = holdingRegisters[HR.모델_카테고리.addr] === 1 ? "FR" : "FF";
  const number = holdingRegisters[HR.모델_번호.addr];
  const index = holdingRegisters[HR.경로점_인덱스.addr];
  const x = holdingRegisters[HR.경로점_X.addr];
  const z = holdingRegisters[HR.경로점_Z.addr];
  const key = `${category}-${number}`;
  if (!vehicleModelWaypoints[key]) vehicleModelWaypoints[key] = [];
  vehicleModelWaypoints[key][index] = { x, z };
  const savedCount = vehicleModelWaypoints[key].filter(Boolean).length;
  holdingRegisters[HR.경로_저장개수.addr] = savedCount;
  console.log(`[mockPlcServer] 경로점 기록: ${key}[${index}] = {x:${x}, z:${z}} (누적 ${savedCount}개)`);
}

// 실린더 코일(전진/후진, 상승/하강)에 1이 쓰이면 일정 지연 후 완료센서가 켜지고
// 반대방향 완료센서는 꺼지는 상황을 흉내낸다.
function simulateCylinder(onAddr, offAddr) {
  setTimeout(() => {
    discreteInputs[onAddr] = 1;
    discreteInputs[offAddr] = 0;
    console.log(`[mockPlcServer] discreteInput ${onAddr} = 1 (지연 ${CYLINDER_DELAY_MS}ms 후 자동 세팅)`);
  }, CYLINDER_DELAY_MS);
}

// 서보 "위치지령" 레지스터에 값이 쓰이면(2026-08-31 확정: 이동시작 코일 방식 대체), 이동완료
// 비트를 먼저 끄고(이동 중) 지연 후 현재위치 레지스터에 지령값을 반영하며 이동완료 비트를 켠다.
// 이동 중엔 토크/전류에 테스트값을 넣었다가 완료 시 0으로 되돌린다.
function simulateServoMove(doneAddr, currentPosAddr, commandedValue, torqueAddr, currentAddr) {
  discreteInputs[doneAddr] = 0;
  holdingRegisters[torqueAddr] = TEST_TORQUE_RAW;
  holdingRegisters[currentAddr] = TEST_CURRENT_RAW;
  setTimeout(() => {
    holdingRegisters[currentPosAddr] = commandedValue;
    discreteInputs[doneAddr] = 1;
    holdingRegisters[torqueAddr] = 0;
    holdingRegisters[currentAddr] = 0;
    console.log(
      `[mockPlcServer] 현재위치(${currentPosAddr}) = ${commandedValue}, 이동완료(${doneAddr}) = 1 (지연 ${SERVO_MOVE_DELAY_MS}ms 후 자동 세팅)`
    );
  }, SERVO_MOVE_DELAY_MS);
}

function setCoil(addr, value) {
  coils[addr] = value ? 1 : 0;
  console.log(`[mockPlcServer] 코일 쓰기: addr=${addr}, value=${coils[addr]}`);

  // 경로점_저장은 off로 돌아올 때도 ack 리셋 동작이 필요해 아래 early-return보다 먼저 처리한다
  if (addr === COIL.경로점_저장.addr) {
    if (value) {
      setTimeout(() => {
        recordWaypointPoint();
        discreteInputs[DI.경로점_저장확인.addr] = 1;
      }, WAYPOINT_SAVE_DELAY_MS);
    } else {
      discreteInputs[DI.경로점_저장확인.addr] = 0; // 다음 점 전송을 위해 ack 리셋
    }
    return;
  }

  if (addr === COIL.경로_저장완료.addr && value) {
    console.log(`[mockPlcServer] 경로_저장완료 수신 — 레시피 확정 (기록된 점 개수: ${holdingRegisters[HR.경로_저장개수.addr]})`);
    return;
  }

  if (!value) return; // 0으로 끄는 명령은 흉내낼 동작이 없음(단순 온오프 출력)

  switch (addr) {
    case COIL.위치이동실린더_전진.addr:
      simulateCylinder(DI.위치이동실린더_전진완료.addr, DI.위치이동실린더_후진완료.addr);
      break;
    case COIL.위치이동실린더_후진.addr:
      simulateCylinder(DI.위치이동실린더_후진완료.addr, DI.위치이동실린더_전진완료.addr);
      break;
    case COIL.리프트실린더_상승.addr:
      simulateCylinder(DI.리프트실린더_상승완료.addr, DI.리프트실린더_하강완료.addr);
      break;
    case COIL.리프트실린더_하강.addr:
      simulateCylinder(DI.리프트실린더_하강완료.addr, DI.리프트실린더_상승완료.addr);
      break;
    case COIL.노즐회전실린더_전진.addr:
      simulateCylinder(DI.노즐회전실린더_전진완료.addr, DI.노즐회전실린더_후진완료.addr);
      break;
    case COIL.노즐회전실린더_후진.addr:
      simulateCylinder(DI.노즐회전실린더_후진완료.addr, DI.노즐회전실린더_전진완료.addr);
      break;
    case COIL.도어_닫힘.addr:
      setTimeout(() => {
        discreteInputs[DI.안전도어_닫힘잠김.addr] = 1;
        console.log("[mockPlcServer] 안전도어_닫힘잠김 = 1 (도어_닫힘 지연 후 자동 세팅)");
      }, CYLINDER_DELAY_MS);
      break;
    case COIL.도어_열림.addr:
      setTimeout(() => {
        discreteInputs[DI.안전도어_닫힘잠김.addr] = 0;
        console.log("[mockPlcServer] 안전도어_닫힘잠김 = 0 (도어_열림 지연 후 자동 세팅)");
      }, CYLINDER_DELAY_MS);
      break;
    // 고압펌프_onoff, 완료램프부저, 오토사이클_시작/정지, 운전모드_수동, 실링_onoff는
    // 흉내낼 부가동작 없이 값만 저장하면 충분
  }
}

function setHoldingRegister(addr, value) {
  holdingRegisters[addr] = value;
  console.log(`[mockPlcServer] 레지스터 쓰기: addr=${addr}, value=${value}`);

  // 인버터 속도지령이 0보다 크면 즉시 운전상태 on + 토크/전류 테스트값, 0이면 즉시 off + 0
  if (addr === HR.파렛트회전_속도지령.addr) {
    const running = value > 0;
    discreteInputs[DI.파렛트회전_운전상태.addr] = running ? 1 : 0;
    holdingRegisters[HR.파렛트회전_토크.addr] = running ? TEST_TORQUE_RAW : 0;
    holdingRegisters[HR.파렛트회전_전류.addr] = running ? TEST_CURRENT_RAW : 0;
  } else if (addr === HR.노즐X축_위치지령.addr) {
    simulateServoMove(DI.노즐X축_이동완료.addr, HR.노즐X축_현재위치.addr, value, HR.노즐X축_토크.addr, HR.노즐X축_전류.addr);
  } else if (addr === HR.노즐Z축_위치지령.addr) {
    simulateServoMove(DI.노즐Z축_이동완료.addr, HR.노즐Z축_현재위치.addr, value, HR.노즐Z축_토크.addr, HR.노즐Z축_전류.addr);
  }
  // 노즐X/Z축_속도지령(시운전용)은 값만 저장 — 별도 시뮬레이션 없음
}

// modbus-serial ServerTCP가 요구하는 읽기/쓰기 콜백 모음(vector).
// 클라이언트가 Modbus 함수코드로 읽기/쓰기 요청을 보내면 이 함수들이 호출된다.
const vector = {
  // discrete input 읽기 (FC02, 읽기전용 — 센서/버튼 상태)
  getDiscreteInput: function (addr, unitID, callback) {
    callback(null, !!discreteInputs[addr]);
  },
  // 코일 읽기 (FC01, 읽기·쓰기 — 밸브/펌프 등 출력)
  getCoil: function (addr, unitID, callback) {
    callback(null, !!coils[addr]);
  },
  // 코일 쓰기 (FC05)
  setCoil: function (addr, value, unitID) {
    setCoil(addr, value);
  },
  // 홀딩 레지스터 읽기 (FC03)
  getHoldingRegister: function (addr, unitID, callback) {
    callback(null, holdingRegisters[addr] || 0);
  },
  // 홀딩 레지스터 쓰기 (FC06)
  setRegister: function (addr, value, unitID) {
    setHoldingRegister(addr, value);
  },
};

// 가상 Modbus TCP 슬레이브 서버 기동 (server/src/modbus/client.js 가 접속할 대상)
const serverTCP = new ModbusRTU.ServerTCP(vector, {
  host: HOST,
  port: PORT,
  unitID: 1,
  debug: false,
});

console.log(`[mockPlcServer] ModbusTCP 리스닝 시작: modbus://${HOST}:${PORT} (docs/02_IO_태그맵.md 제안 초안 기준 레지스터)`);

// 디버그 패널(simulator/debugPanel.html)이 붙을 WebSocket 창구 — 사람이 눈으로 상태를 보고
// discreteInputs/sequenceStep을 수동으로 조작하기 위한 테스트 전용 기능 (Modbus와 무관)
const { startDebugServer } = require("./debugServer");
startDebugServer({ discreteInputs, coils, holdingRegisters });

// 소켓 레벨 오류(클라이언트 접속 중 끊김 등) — 서버는 계속 살아있어야 하므로 로그만 남김
serverTCP.on("socketError", function (err) {
  console.error("[mockPlcServer] 소켓 오류:", err);
});

// Ctrl+C 로 종료할 때 리스닝 소켓을 정상적으로 닫고 종료
process.on("SIGINT", () => {
  console.log("[mockPlcServer] 종료 중...");
  serverTCP.close(() => process.exit(0));
});

module.exports = { discreteInputs, coils, holdingRegisters, vehicleModelWaypoints };
