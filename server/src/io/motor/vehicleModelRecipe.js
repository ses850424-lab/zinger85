/**
 * 차량 기종별 노즐 경로(웨이포인트) 전달 어댑터.
 * 근거: docs/05_차량기종.md, docs/02_IO_태그맵.md (2026-08-31 신규 제안)
 *
 * 역할: server/data/vehicleModels.json에 저장된 기종별 경로(좌표점 리스트)를 점 하나씩
 * 순서대로 PLC에 전달한다 — PLC는 이걸 받아 자체 레시피/시퀀스 메모리에 저장해두고,
 * 나중에 그 기종이 선택된 세척 사이클에서 이 경로를 따라 위치제어를 수행한다.
 * 실제 위치제어 실행은 PLC 몫 — 이 파일은 "전달"만 담당한다.
 *
 * 핸드셰이크: 인덱스/X/Z 레지스터를 쓰고 경로점_저장 코일을 1로 세팅 → PLC가 기록하면
 * 경로점_저장확인 discrete input이 켜짐 → 확인되면 코일을 0으로 내려 다음 점 준비.
 * 전체 점을 다 보내면 경로_저장완료 코일을 펄스로 세팅해 PLC에게 레시피 확정을 알린다.
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { coils, discreteInputs, holdingRegisters } = require("../../modbus/registerMap");

const POSITION_UNIT_MM = 0.1; // 경로점_X/Z 레지스터 1 카운트 = 0.1mm (제안값, docs/02 참고)
const ACK_POLL_INTERVAL_MS = 100;
const ACK_TIMEOUT_MS = 5000; // 점 하나 기록에 이 시간 안에 ack가 안 오면 실패로 간주

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function categoryToCode(category) {
  return category === "FR" ? 1 : 0; // 0=FF, 1=FR (docs/02 참고)
}

// 대상 모델을 지정한다 (경로 전송/실행 대상)
async function selectModel(modbusClient, category, number) {
  await modbusClient.writeRegister(holdingRegisters.모델_카테고리.addr, categoryToCode(category));
  await modbusClient.writeRegister(holdingRegisters.모델_번호.addr, number);
}

// 경로점_저장확인 discrete input이 켜질 때까지 폴링 대기 (타임아웃 시 에러)
async function waitForAck(modbusClient) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ACK_TIMEOUT_MS) {
    const [ack] = await modbusClient.readDiscreteInputs(discreteInputs.경로점_저장확인.addr, 1);
    if (ack) return;
    await sleep(ACK_POLL_INTERVAL_MS);
  }
  throw new Error("경로점 저장 확인(ack) 타임아웃 — PLC 응답 없음");
}

// waypoints: [{x, z}, ...] (mm 단위) — 점 하나씩 순서대로 PLC에 전달하고, 끝나면 저장완료를 알린다.
// onProgress(index, total)를 넘기면 각 점 전송 완료 시마다 호출된다 (HMI 진행률 표시용).
async function transferPath(modbusClient, category, number, waypoints, onProgress) {
  await selectModel(modbusClient, category, number);

  for (let i = 0; i < waypoints.length; i++) {
    const raw = {
      x: Math.round(waypoints[i].x / POSITION_UNIT_MM),
      z: Math.round(waypoints[i].z / POSITION_UNIT_MM),
    };
    await modbusClient.writeRegister(holdingRegisters.경로점_인덱스.addr, i);
    await modbusClient.writeRegister(holdingRegisters.경로점_X.addr, raw.x);
    await modbusClient.writeRegister(holdingRegisters.경로점_Z.addr, raw.z);
    await modbusClient.writeCoil(coils.경로점_저장.addr, true);
    await waitForAck(modbusClient);
    await modbusClient.writeCoil(coils.경로점_저장.addr, false);

    if (onProgress) onProgress(i + 1, waypoints.length);
  }

  // 경로_저장완료를 펄스(짧게 on 후 off)로 세팅해 PLC에게 레시피 확정을 알린다
  await modbusClient.writeCoil(coils.경로_저장완료.addr, true);
  await modbusClient.writeCoil(coils.경로_저장완료.addr, false);
}

// 지금까지 PLC가 기록 확인한 점 개수 (전달 진행률/검증용)
async function readSavedCount(modbusClient) {
  const [count] = await modbusClient.readHoldingRegisters(holdingRegisters.경로_저장개수.addr, 1);
  return count;
}

module.exports = { selectModel, transferPath, readSavedCount };
