/**
 * 파렛트 위치이동 에어실린더(전진/후진) 제어 어댑터.
 * 근거: docs/01_설비개요.md, docs/03_공정시퀀스.md 2단계(위치이동)/8단계(위치복귀)
 *
 * 출력: 위치이동실린더 전진/후진 솔레노이드 (registerMap.js coils)
 * 입력: 전진완료/후진완료 근접센서 (registerMap.js discreteInputs) — 둘 다 2026-08-31 확인 완료
 *
 * 역할: 수동모드(hmi/js/screens/manualScreen.js)에서의 개별 전후진 명령을 PLC 레지스터로 전달하고,
 *       완료센서 상태를 읽어 HMI에 표시. 자동 사이클 진행 판단은 PLC가 한다.
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { coils, discreteInputs } = require("../../modbus/registerMap");

// 전진 코일에 1을 써서 전진 명령을 내린다
async function advance(modbusClient) {
  await modbusClient.writeCoil(coils.위치이동실린더_전진.addr, true);
}

// 후진 코일에 1을 써서 후진 명령을 내린다
async function retract(modbusClient) {
  await modbusClient.writeCoil(coils.위치이동실린더_후진.addr, true);
}

// 전진완료/후진완료 근접센서 상태를 읽어 HMI에 표시할 형태로 반환
async function readStatus(modbusClient) {
  const [advanced] = await modbusClient.readDiscreteInputs(discreteInputs.위치이동실린더_전진완료.addr, 1);
  const [retracted] = await modbusClient.readDiscreteInputs(discreteInputs.위치이동실린더_후진완료.addr, 1);
  return { advanced: !!advanced, retracted: !!retracted };
}

module.exports = { advance, retract, readStatus };
