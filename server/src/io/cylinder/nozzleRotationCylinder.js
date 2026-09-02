/**
 * 노즐회전실린더 제어 어댑터 (2026-08-31 신규 추가).
 * 근거: docs/01_설비개요.md — 전진 시 노즐 90도 틸팅, 후진 시 원위치 복귀
 *
 * 출력: 노즐회전실린더 전진/후진 솔레노이드 (registerMap.js coils)
 * 입력: 전진완료/후진완료 근접센서 (registerMap.js discreteInputs)
 *
 * positionCylinder.js, liftCylinder.js와 동일한 패턴 — 상태 읽기/지령 전달만 담당,
 * 자동 사이클 진행 판단은 PLC가 한다.
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { coils, discreteInputs } = require("../../modbus/registerMap");

// 전진 코일에 1을 써서 90도 틸팅 명령을 내린다
async function advance(modbusClient) {
  await modbusClient.writeCoil(coils.노즐회전실린더_전진.addr, true);
}

// 후진 코일에 1을 써서 원위치 복귀 명령을 내린다
async function retract(modbusClient) {
  await modbusClient.writeCoil(coils.노즐회전실린더_후진.addr, true);
}

// 전진완료(틸팅완료)/후진완료(원위치) 근접센서 상태를 읽어 HMI에 표시할 형태로 반환
async function readStatus(modbusClient) {
  const [advanced] = await modbusClient.readDiscreteInputs(discreteInputs.노즐회전실린더_전진완료.addr, 1);
  const [retracted] = await modbusClient.readDiscreteInputs(discreteInputs.노즐회전실린더_후진완료.addr, 1);
  return { advanced: !!advanced, retracted: !!retracted };
}

module.exports = { advance, retract, readStatus };
