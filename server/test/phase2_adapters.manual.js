/**
 * Phase 2 어댑터 연결성 수동 검증 스크립트.
 * simulator/src/mockPlcServer.js 를 대상으로 8개 io 어댑터를 순서대로 호출해서
 * PROJECT_PLAN.md Phase 2 완료조건("모터 속도지령 전달, 실린더 전후진 명령, 센서 상태
 * 읽기가 각각 단위테스트 통과")을 실증한다.
 *
 * 실행: simulator를 먼저 켠 뒤 → node server/test/phase2_adapters.manual.js
 *
 * 아직 registerMap.js가 "제안 초안" 단계라 정식 테스트 프레임워크(Jest 등) 대신
 * client.js 자가테스트와 같은 스타일의 수동 스크립트로 작성한다.
 */

const { createModbusClient } = require("../src/modbus/client");
const plcConfig = require("../src/config/plcConfig");

const positionCylinder = require("../src/io/cylinder/positionCylinder");
const liftCylinder = require("../src/io/cylinder/liftCylinder");
const servoAxisX = require("../src/io/motor/servoAxisX");
const servoAxisZ = require("../src/io/motor/servoAxisZ");
const inverterRotation = require("../src/io/motor/inverterRotation");
const doorInterlock = require("../src/io/sensor/doorInterlock");
const estop = require("../src/io/sensor/estop");
const proximitySensors = require("../src/io/sensor/proximitySensors");
const highPressurePump = require("../src/io/motor/highPressurePump");
const { holdingRegisters } = require("../src/modbus/registerMap");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// mockPlcServer.js 의 지연(실린더 1500ms, 서보 1000ms)보다 여유있게 대기
const CYLINDER_WAIT_MS = 2000;
const SERVO_WAIT_MS = 1500;

let passCount = 0;
let failCount = 0;

function check(label, condition) {
  if (condition) {
    console.log(`[phase2-test] ✅ ${label}`);
    passCount++;
  } else {
    console.error(`[phase2-test] ❌ ${label}`);
    failCount++;
  }
}

(async () => {
  const modbus = createModbusClient();
  modbus.connect(plcConfig.simulator);

  // 연결이 잡힐 때까지 대기 (간단한 폴링, 기존 client.js 자가테스트와 동일한 패턴)
  for (let i = 0; i < 20 && !modbus.isOpen(); i++) {
    await sleep(200);
  }
  if (!modbus.isOpen()) {
    console.error("[phase2-test] 연결 실패 — simulator가 켜져 있는지 확인하세요.");
    process.exit(1);
  }

  try {
    // 1. 위치이동실린더 전진 → 완료감지
    await positionCylinder.advance(modbus);
    await sleep(CYLINDER_WAIT_MS);
    const posStatus = await positionCylinder.readStatus(modbus);
    check("위치이동실린더 전진완료 감지", posStatus.advanced === true);

    // 2. 리프트실린더 상승 → 완료감지
    await liftCylinder.raise(modbus);
    await sleep(CYLINDER_WAIT_MS);
    const liftStatus = await liftCylinder.readStatus(modbus);
    check("리프트실린더 상승완료 감지", liftStatus.raised === true);

    // 3. 노즐X축 위치지령 이동 → 이동완료 감지 + 현재위치 피드백 확인
    await servoAxisX.moveTo(modbus, 123.4); // mm
    await sleep(SERVO_WAIT_MS);
    const xStatus = await servoAxisX.readStatus(modbus);
    check("노즐X축 이동완료 감지", xStatus.moveDone === true);
    check("노즐X축 현재위치 피드백이 지령값과 일치 (123.4mm)", xStatus.currentPositionMm === 123.4);
    const [xRaw] = await modbus.readHoldingRegisters(holdingRegisters.노즐X축_위치지령.addr, 1);
    check("노즐X축 위치지령 레지스터 값 변환 확인 (123.4mm → 1234)", xRaw === 1234);

    // 4. 노즐Z축도 동일 패턴 확인 (스트로크 미정이라 범위검증 없이 이동만 확인)
    await servoAxisZ.moveTo(modbus, 50);
    await sleep(SERVO_WAIT_MS);
    const zStatus = await servoAxisZ.readStatus(modbus);
    check("노즐Z축 이동완료 감지", zStatus.moveDone === true);
    check("노즐Z축 현재위치 피드백이 지령값과 일치 (50mm)", zStatus.currentPositionMm === 50);

    // 5. 인버터 속도지령 → 운전상태 감지
    await inverterRotation.setSpeed(modbus, 12);
    const invStatus = await inverterRotation.readStatus(modbus);
    check("인버터 속도지령 후 운전상태 on 감지", invStatus.running === true);
    await inverterRotation.setSpeed(modbus, 0);
    const invStoppedStatus = await inverterRotation.readStatus(modbus);
    check("인버터 속도 0 지령 후 운전상태 off 감지", invStoppedStatus.running === false);

    // 6. 센서 읽기 (판단 없이 상태만 읽히는지 확인)
    const doorStatus = await doorInterlock.readStatus(modbus);
    check("도어 상태 읽기 동작 (boolean 반환)", typeof doorStatus.closedAndLocked === "boolean");
    const estopStatus = await estop.readStatus(modbus);
    check("비상정지 상태 읽기 동작 (boolean 반환)", typeof estopStatus.pressed === "boolean");
    const proxAll = await proximitySensors.readAll(modbus);
    check("근접센서 일괄 읽기 동작 (10종: 실린더4 + 축당 리밋2·회전감지1×2축)", Object.keys(proxAll).length === 10);

    // 7. 고압펌프 on/off 지령 + 이상신호 읽기 (시뮬레이터엔 이상신호를 흔드는 로직이 없어 항상 false지만,
    //    읽기 경로 자체가 정상 동작하는지 확인)
    await highPressurePump.turnOn(modbus);
    await highPressurePump.turnOff(modbus);
    const pumpStatus = await highPressurePump.readStatus(modbus);
    check(
      "고압펌프 이상신호 읽기 동작 (boolean 반환)",
      typeof pumpStatus.pressureAbnormal === "boolean" && typeof pumpStatus.flowAbnormal === "boolean"
    );

    // 8. sequenceStep 읽기 (registerMap.js 기준 홀딩레지스터 0번)
    const [step] = await modbus.readHoldingRegisters(holdingRegisters.sequenceStep.addr, 1);
    check("sequenceStep 읽기 동작 (0~9 범위)", step >= 0 && step <= 9);
  } catch (err) {
    console.error("[phase2-test] 오류:", err.message);
    failCount++;
  } finally {
    modbus.disconnect();
    console.log(`[phase2-test] 결과: 성공 ${passCount} / 실패 ${failCount}`);
    process.exit(failCount > 0 ? 1 : 0);
  }
})();
