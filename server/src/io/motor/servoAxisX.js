/**
 * 노즐 X축 서보모터 제어 어댑터.
 * 근거: docs/01_설비개요.md — 리드 5mm, 스트로크 800mm, 최대속도 25mm/s (2026-08-31 확인)
 * 통신방식: 펄스열 (2026-08-31 확인, PLC가 직접 펄스를 생성) — 이 미들웨어는 위치지령 값만
 * 레지스터에 써주고, 실제 위치제어(가감속, 펄스 계산 등)는 PLC/서보앰프가 담당한다.
 *
 * 핸드셰이크 (2026-08-31 확정, docs/02_IO_태그맵.md): 위치지령 홀딩레지스터에 값을 쓰면 PLC가
 * 이동을 시작하고, 완료되면 이동완료 discrete input이 켜지며 현재위치 홀딩레지스터에 도달한
 * 위치가 반영된다. (기존에 검토했던 "이동시작 코일" 방식은 폐기 — 위치지령 write 자체가 트리거)
 * 원점/리미트 센서 구성 (2026-08-31 확인): 최대리밋 1개 + 최소리밋 1개 + 회전감지센서 1개
 *
 * 역할: PLC가 갖고 있는 서보 상태(위치/리밋/회전감지)를 읽어 HMI에 전달하고,
 *       HMI에서 받은 이동 지령을 PLC가 받을 수 있는 레지스터 형식으로 변환한다.
 *       실제 서보 위치제어 로직(가감속, 좌표계산 등)은 PLC/서보앰프가 담당 — 여기서 재구현하지 않는다.
 * 토크/전류, 시운전용 속도지령(2026-08-31 신규 제안, 수동화면 개편)도 여기서 함께 다룬다 —
 * 제안값(0.01 단위/mm/s), 실제 스케일/최대치는 PLC·드라이브 사양서 확인 필요.
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { discreteInputs, holdingRegisters } = require("../../modbus/registerMap");

const POSITION_UNIT_MM = 0.1; // 위치지령/현재위치 레지스터 1 카운트 = 0.1mm (제안값, docs/02 참고)
const STROKE_MAX_MM = 800; // 확정된 스트로크 (docs/01_설비개요.md 2026-08-31)

// 목표위치(mm)를 위치지령 레지스터에 쓴다. 이 write 자체가 PLC 이동 트리거다.
// mm는 0~800(스트로크) 범위여야 하며, 벗어나면 PLC가 아니라 여기서 먼저 막는다
// (이 검사는 "안전판단"이 아니라 단순 입력값 범위 방어 — 도어/비상정지 판단과는 무관).
async function moveTo(modbusClient, mm) {
  if (mm < 0 || mm > STROKE_MAX_MM) {
    throw new Error(`X축 목표위치 ${mm}mm 는 스트로크 범위(0~${STROKE_MAX_MM}mm)를 벗어남`);
  }
  const raw = Math.round(mm / POSITION_UNIT_MM);
  await modbusClient.writeRegister(holdingRegisters.노즐X축_위치지령.addr, raw);
}

// 시운전용 속도지령(mm/s) — 기존 위치지령(moveTo)과 별개의 파라미터, 값만 레지스터에 저장된다
async function setSpeed(modbusClient, mmPerSec) {
  if (mmPerSec < 0) {
    throw new Error(`X축 시운전 속도 ${mmPerSec}mm/s 는 음수일 수 없음`);
  }
  await modbusClient.writeRegister(holdingRegisters.노즐X축_속도지령.addr, Math.round(mmPerSec));
}

// 최대/최소 리밋, 회전감지, 이동완료, 현재위치(mm 환산), 토크/전류 상태를 읽어 HMI에 표시할 형태로 반환
async function readStatus(modbusClient) {
  const [maxLimit] = await modbusClient.readDiscreteInputs(discreteInputs.노즐X축_최대리밋.addr, 1);
  const [minLimit] = await modbusClient.readDiscreteInputs(discreteInputs.노즐X축_최소리밋.addr, 1);
  const [rotationDetected] = await modbusClient.readDiscreteInputs(discreteInputs.노즐X축_회전감지.addr, 1);
  const [moveDone] = await modbusClient.readDiscreteInputs(discreteInputs.노즐X축_이동완료.addr, 1);
  const [currentRaw] = await modbusClient.readHoldingRegisters(holdingRegisters.노즐X축_현재위치.addr, 1);
  const [torqueRaw] = await modbusClient.readHoldingRegisters(holdingRegisters.노즐X축_토크.addr, 1);
  const [currentAmpRaw] = await modbusClient.readHoldingRegisters(holdingRegisters.노즐X축_전류.addr, 1);
  return {
    maxLimit: !!maxLimit,
    minLimit: !!minLimit,
    rotationDetected: !!rotationDetected,
    moveDone: !!moveDone,
    currentPositionMm: currentRaw * POSITION_UNIT_MM,
    torqueNm: torqueRaw * 0.01,
    currentA: currentAmpRaw * 0.01,
  };
}

module.exports = { moveTo, setSpeed, readStatus };
