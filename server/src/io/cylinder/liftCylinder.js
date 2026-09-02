/**
 * 파렛트 리프트 업/다운 에어실린더 제어 어댑터.
 * 근거: docs/01_설비개요.md — "에어실린더(모터 아님 — 이전 검토 정정)"
 *       docs/03_공정시퀀스.md 3단계(리프트업)/7단계(리프트다운)
 *
 * 출력: 리프트실린더 상승/하강 솔레노이드 (registerMap.js coils)
 * 입력: 상승완료/하강완료 근접센서 (registerMap.js discreteInputs) — 2026-08-31 종류 확인 완료(근접센서)
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { coils, discreteInputs } = require("../../modbus/registerMap");

// 상승 코일에 1을 써서 상승 명령을 내린다
async function raise(modbusClient) {
  await modbusClient.writeCoil(coils.리프트실린더_상승.addr, true);
}

// 하강 코일에 1을 써서 하강 명령을 내린다
async function lower(modbusClient) {
  await modbusClient.writeCoil(coils.리프트실린더_하강.addr, true);
}

// 상승완료/하강완료 근접센서 상태를 읽어 HMI에 표시할 형태로 반환
async function readStatus(modbusClient) {
  const [raised] = await modbusClient.readDiscreteInputs(discreteInputs.리프트실린더_상승완료.addr, 1);
  const [lowered] = await modbusClient.readDiscreteInputs(discreteInputs.리프트실린더_하강완료.addr, 1);
  return { raised: !!raised, lowered: !!lowered };
}

module.exports = { raise, lower, readStatus };
