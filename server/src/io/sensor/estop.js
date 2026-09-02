/**
 * 비상정지(E-STOP) 상태 읽기 어댑터.
 *
 * ⚠️ 비상정지 회로는 하드와이어드로 고압펌프·서보 인에이블·인버터 런 신호를 직접 차단한다
 * (기획서 5항). 이 파일은 "비상정지가 눌렸다"는 상태를 HMI 알람화면에 표시하기 위해서만
 * 존재하며, 실제 정지 동작을 이 소프트웨어가 수행하지 않는다.
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { discreteInputs } = require("../../modbus/registerMap");

// 비상정지 상태를 읽어 그대로 반환 (판단 없음, 표시용)
async function readStatus(modbusClient) {
  const [pressed] = await modbusClient.readDiscreteInputs(discreteInputs.비상정지.addr, 1);
  return { pressed: !!pressed };
}

module.exports = { readStatus };
