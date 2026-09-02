/**
 * 파렛트 회전용 AC모터 + 인버터(VFD) 제어 어댑터.
 * 근거: docs/01_설비개요.md — 속도가변, HMI에서 실시간 속도 조절 가능해야 함.
 *       고정 회전속도 없음 — 대략 5초/회전 = 12rpm 부근에서 튜닝 시작 예상 (확정값 아님, 현장 튜닝 대상)
 * 통신방식: "통신"으로 확인(2026-08-31, 아날로그 아님) — 구체 프로토콜(Modbus RTU 등)은 아직
 * 미정이나, PLC가 내부에서 변환을 담당하므로 이 어댑터는 그냥 rpm 값 하나를 레지스터에 쓰면 된다.
 *
 * 역할:
 *  - HMI(mainScreen.js 의 속도 슬라이더)에서 설정한 속도값을 받아 PLC가 인버터로 전달할 수 있는
 *    레지스터 형식으로 변환
 *  - 현재 회전 상태(운전중/정지)를 읽어 HMI에 전달 — 파렛트회전_운전상태는 docs/02_IO_태그맵.md 상
 *    "신규 제안" 항목 (원래 I/O 리스트엔 없었으나 이 기능을 위해 필요해서 추가)
 *  - 토크/전류(2026-08-31 신규 제안, 수동화면 개편)를 읽어 HMI에 전달 — 제안값(0.01 단위),
 *    실제 스케일/최대치는 PLC·드라이브 사양서 확인 필요
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { discreteInputs, holdingRegisters } = require("../../modbus/registerMap");

// 속도지령(rpm)을 레지스터에 쓴다. 0을 쓰면 정지 명령이 된다 (mockPlcServer.js 기준 운전상태도 즉시 off).
async function setSpeed(modbusClient, rpm) {
  if (rpm < 0) {
    throw new Error(`파렛트 회전속도 ${rpm}rpm 은 음수일 수 없음`);
  }
  await modbusClient.writeRegister(holdingRegisters.파렛트회전_속도지령.addr, Math.round(rpm));
}

// 현재 운전중/정지 상태 + 토크/전류를 읽어 HMI에 표시할 형태로 반환
async function readStatus(modbusClient) {
  const [running] = await modbusClient.readDiscreteInputs(discreteInputs.파렛트회전_운전상태.addr, 1);
  const [torqueRaw] = await modbusClient.readHoldingRegisters(holdingRegisters.파렛트회전_토크.addr, 1);
  const [currentRaw] = await modbusClient.readHoldingRegisters(holdingRegisters.파렛트회전_전류.addr, 1);
  return {
    running: !!running,
    torqueNm: torqueRaw * 0.01,
    currentA: currentRaw * 0.01,
  };
}

module.exports = { setSpeed, readStatus };
