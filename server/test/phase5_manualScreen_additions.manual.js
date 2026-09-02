/**
 * 2026-08-31 수동화면 개편분 검증 스크립트 — 신규 추가된 신호/어댑터만 콕 집어서 확인한다.
 * (기존 기능 회귀는 phase2/phase3/phase4 manual 스크립트가 이미 담당)
 *
 * 확인 항목: 노즐회전실린더 전진→완료감지, 도어 닫힘→안전도어_닫힘잠김 반영,
 * 인버터 회전속도>0→토크/전류 비0, 서보 이동 중 토크/전류 비0→완료 후 0
 *
 * 실행: node server/test/phase5_manualScreen_additions.manual.js
 * (simulator를 미리 켤 필요 없음 — 이 스크립트가 직접 시뮬레이터 모듈을 불러온다)
 */

const registerMap = require("../src/modbus/registerMap");
const { createModbusClient } = require("../src/modbus/client");
const plcConfig = require("../src/config/plcConfig");

const nozzleRotationCylinder = require("../src/io/cylinder/nozzleRotationCylinder");
const doorInterlock = require("../src/io/sensor/doorInterlock");
const inverterRotation = require("../src/io/motor/inverterRotation");
const servoAxisX = require("../src/io/motor/servoAxisX");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passCount = 0;
let failCount = 0;
function check(label, condition) {
  if (condition) {
    console.log(`[phase5-test] ✅ ${label}`);
    passCount++;
  } else {
    console.error(`[phase5-test] ❌ ${label}`);
    failCount++;
  }
}

(async () => {
  require("../../simulator/src/mockPlcServer");
  await sleep(300);

  const modbus = createModbusClient();
  modbus.connect(plcConfig.simulator);
  for (let i = 0; i < 20 && !modbus.isOpen(); i++) await sleep(200);
  if (!modbus.isOpen()) {
    console.error("[phase5-test] 연결 실패");
    process.exit(1);
  }

  try {
    // 1. 노즐회전실린더 전진 → 완료감지
    await nozzleRotationCylinder.advance(modbus);
    await sleep(2000);
    const nrStatus = await nozzleRotationCylinder.readStatus(modbus);
    check("노즐회전실린더 전진완료(90도 틸팅) 감지", nrStatus.advanced === true);

    // 2. 도어 닫힘 → 안전도어_닫힘잠김 반영
    await doorInterlock.close(modbus);
    await sleep(2000);
    const doorStatus = await doorInterlock.readStatus(modbus);
    check("도어 닫힘 명령 → 안전도어_닫힘잠김 반영", doorStatus.closedAndLocked === true);

    // 3. 도어 열림 → 안전도어_닫힘잠김 해제
    await doorInterlock.open(modbus);
    await sleep(2000);
    const doorStatus2 = await doorInterlock.readStatus(modbus);
    check("도어 열림 명령 → 안전도어_닫힘잠김 해제", doorStatus2.closedAndLocked === false);

    // 4. 실링 on/off 왕복 (완료센서 없음 — 코일 값 자체만 확인)
    await doorInterlock.setSealing(modbus, true);
    await sleep(300);
    const [sealingOn] = await modbus.readCoils(registerMap.coils.실링_onoff.addr, 1);
    check("실링 On 코일 반영", sealingOn === true);

    // 5. 인버터 회전속도 > 0 → 토크/전류 비0, 0 → 토크/전류 0
    await inverterRotation.setSpeed(modbus, 12);
    await sleep(300);
    const invRunning = await inverterRotation.readStatus(modbus);
    check("회전속도>0 시 토크/전류 비0", invRunning.torqueNm > 0 && invRunning.currentA > 0);
    await inverterRotation.setSpeed(modbus, 0);
    await sleep(300);
    const invStopped = await inverterRotation.readStatus(modbus);
    check("회전속도=0 시 토크/전류 0", invStopped.torqueNm === 0 && invStopped.currentA === 0);

    // 6. 서보 이동 중 토크/전류 비0 → 완료 후 0
    servoAxisX.moveTo(modbus, 200); // await 안 함 — 이동 "중" 상태를 잡기 위해
    await sleep(300);
    const xMoving = await servoAxisX.readStatus(modbus);
    check("서보 이동 중 토크/전류 비0", xMoving.torqueNm > 0 && xMoving.currentA > 0);
    await sleep(1500);
    const xDone = await servoAxisX.readStatus(modbus);
    check("서보 이동완료 후 토크/전류 0", xDone.torqueNm === 0 && xDone.currentA === 0);

    // 7. 서보 시운전 속도지령 왕복 확인
    await servoAxisX.setSpeed(modbus, 15.5);
    const [speedRaw] = await modbus.readHoldingRegisters(registerMap.holdingRegisters.노즐X축_속도지령.addr, 1);
    check("노즐X축 시운전 속도지령 반영 (15.5mm/s → 16 반올림)", speedRaw === 16);
  } catch (err) {
    console.error("[phase5-test] 오류:", err.message);
    failCount++;
  } finally {
    modbus.disconnect();
    console.log(`[phase5-test] 결과: 성공 ${passCount} / 실패 ${failCount}`);
    process.exit(failCount > 0 ? 1 : 0);
  }
})();
