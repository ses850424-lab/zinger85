/**
 * 고압펌프 On/Off 제어 + 이상신호 읽기 어댑터.
 * 근거: docs/01_설비개요.md — On/Off만, 압력조절 기능 없음
 * 이상신호 (2026-08-31 확인): 압력센서·유량센서로 이상여부 판단 → 압력게이지 이상 시
 * PLC가 운전을 정지시킨다.
 *
 * ⚠️ 안전판단 없음: 이상 감지 시 실제로 펌프를 멈추는 판단/동작은 PLC/하드와이어드가 한다.
 * 이 파일은 On/Off 지령 전달과 이상상태 "표시"만 담당한다.
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { coils, discreteInputs } = require("../../modbus/registerMap");

// 고압펌프_onoff 코일을 1로 세팅해 기동 지령
async function turnOn(modbusClient) {
  await modbusClient.writeCoil(coils.고압펌프_onoff.addr, true);
}

// 고압펌프_onoff 코일을 0으로 세팅해 정지 지령
async function turnOff(modbusClient) {
  await modbusClient.writeCoil(coils.고압펌프_onoff.addr, false);
}

// 압력이상/유량이상 상태를 읽어 HMI 알람화면에 표시할 형태로 반환
async function readStatus(modbusClient) {
  const [pressureAbnormal] = await modbusClient.readDiscreteInputs(discreteInputs.고압펌프_압력이상.addr, 1);
  const [flowAbnormal] = await modbusClient.readDiscreteInputs(discreteInputs.고압펌프_유량이상.addr, 1);
  return { pressureAbnormal: !!pressureAbnormal, flowAbnormal: !!flowAbnormal };
}

module.exports = { turnOn, turnOff, readStatus };
