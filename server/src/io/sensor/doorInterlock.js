/**
 * 안전도어 인터록 상태 읽기 + 개폐/실링 지령 어댑터.
 * 근거: docs/01_설비개요.md, 기획서 5항 안전설계 권고사항
 * 도어 메커니즘 (2026-08-31 확인): 에어실린더 온오프 방식 + 근접센서(닫힘확인) + 도어가 닫히면
 * 고무호스로 에어를 투입해 실링. 별도의 "실링완료" 확인센서는 언급되지 않아 추가하지 않았다.
 * 도어 열림/닫힘, 실링 on/off 코일은 2026-08-31 신규 제안(수동화면 개편, docs/02 참고).
 *
 * ⚠️ 중요한 설계 제약 (반드시 지킬 것):
 * 안전 판단(도어를 지금 열어도 되는지, 닫힘·잠김 확인 등)은 PLC/하드와이어드가 전담한다.
 * open()/close()/setSealing()은 HMI에서 받은 "열어줘/닫아줘" 요청을 그대로 PLC 레지스터에
 * 전달만 할 뿐, 실제로 그 요청을 수행할지 말지는 PLC가 판단한다 — 이 파일이 안전 여부를
 * 판단하거나 도어를 직접 잠그고 여는 로직을 갖지 않는다 (이중 안전판단은 오히려 위험).
 * readStatus()도 마찬가지로 판단 결과를 "표시"하기 위해 상태만 읽어올 뿐이다.
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { coils, discreteInputs } = require("../../modbus/registerMap");

// 도어 열림 코일에 1을 써서 "열어줘" 요청을 PLC에 전달 (실제 허용 여부는 PLC 판단)
async function open(modbusClient) {
  await modbusClient.writeCoil(coils.도어_열림.addr, true);
}

// 도어 닫힘 코일에 1을 써서 "닫아줘" 요청을 PLC에 전달
async function close(modbusClient) {
  await modbusClient.writeCoil(coils.도어_닫힘.addr, true);
}

// 실링(에어 투입) on/off 요청을 PLC에 전달
async function setSealing(modbusClient, on) {
  await modbusClient.writeCoil(coils.실링_onoff.addr, !!on);
}

// 도어 닫힘·잠김 상태를 읽어 그대로 반환 (판단 없음, 표시용)
async function readStatus(modbusClient) {
  const [closedAndLocked] = await modbusClient.readDiscreteInputs(discreteInputs.안전도어_닫힘잠김.addr, 1);
  return { closedAndLocked: !!closedAndLocked };
}

module.exports = { open, close, setSealing, readStatus };
