/**
 * Phase 3 상태머신(stateMachine.js) 수동 검증 스크립트.
 * simulator/src/mockPlcServer.js 를 대상으로 sequenceStep 레지스터 값을 0→9까지 순서대로
 * 바꿔가며, stateMachine.js가 매 변화를 정확히 따라오는지 확인한다.
 * PROJECT_PLAN.md Phase 3 완료조건("시뮬레이터에서 레지스터 값을 단계별로 바꿔가며 상태머신이
 * 0→9까지 정확히 따라감을 확인")을 이 스크립트로 실증한다.
 *
 * 실행: simulator를 먼저 켠 뒤 → node server/test/phase3_stateMachine.manual.js
 *
 * 실제 PLC라면 sequenceStep은 읽기전용이지만, 우리 mockPlcServer.js는 테스트 편의를 위해
 * 쓰기도 허용한다 — 그래서 이 스크립트는 modbusClient로 직접 값을 써서 "PLC가 단계를
 * 진행시킨 상황"을 흉내낸다.
 */

const { createModbusClient } = require("../src/modbus/client");
const { createStateMachine } = require("../src/sequence/stateMachine");
const plcConfig = require("../src/config/plcConfig");
const registerMap = require("../src/modbus/registerMap");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passCount = 0;
let failCount = 0;

function check(label, condition) {
  if (condition) {
    console.log(`[phase3-test] ✅ ${label}`);
    passCount++;
  } else {
    console.error(`[phase3-test] ❌ ${label}`);
    failCount++;
  }
}

(async () => {
  const modbus = createModbusClient();
  modbus.connect(plcConfig.simulator);

  for (let i = 0; i < 20 && !modbus.isOpen(); i++) {
    await sleep(200);
  }
  if (!modbus.isOpen()) {
    console.error("[phase3-test] 연결 실패 — simulator가 켜져 있는지 확인하세요.");
    process.exit(1);
  }

  const observedSteps = [];
  const stateMachine = createStateMachine(modbus, registerMap, plcConfig);
  stateMachine.start((step) => observedSteps.push(step));

  // 상태머신이 초기값(0)을 먼저 읽을 시간을 준다
  await sleep(500);

  try {
    // sequenceStep을 0→9까지 순서대로 써서 "PLC가 단계를 진행시키는" 상황을 흉내낸다.
    for (let step = 1; step <= 9; step++) {
      await modbus.writeRegister(registerMap.holdingRegisters.sequenceStep.addr, step);
      await sleep(500); // 폴링 주기(기본 300ms)보다 여유있게 대기해서 변화가 감지되도록 함
    }

    check("stateMachine이 0~9 전체 단계를 순서대로 관찰함", JSON.stringify(observedSteps) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    check("getCurrentStep()이 마지막 단계(9)를 반환함", stateMachine.getCurrentStep() === 9);
  } catch (err) {
    console.error("[phase3-test] 오류:", err.message);
    failCount++;
  } finally {
    stateMachine.stop();
    modbus.disconnect();
    console.log(`[phase3-test] 관찰된 단계 순서: ${JSON.stringify(observedSteps)}`);
    console.log(`[phase3-test] 결과: 성공 ${passCount} / 실패 ${failCount}`);
    process.exit(failCount > 0 ? 1 : 0);
  }
})();
