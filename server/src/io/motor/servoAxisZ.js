/**
 * 노즐 Z축 서보모터 제어 어댑터.
 * 근거: docs/01_설비개요.md — 서보모터 1대 + 볼스크류 2개 + 감속기(10:1) + 라인샤프트
 * 스펙: 이송질량 70kg, 리드 5mm, 최대속도 25mm/s, 축간거리 1000mm,
 *       기준토크(SF1.5) 약 0.1197N·m(Case1, 가감속0.1s)~0.1095N·m(Case3, 0.5s), 모터 3000rpm
 *       (출처: 볼스크류2축_서보모터선정_계산서.xlsx — 50~100W급 검토 권장)
 * 통신방식: 펄스열 (2026-08-31 확인, servoAxisX.js와 동일한 방식) — PLC가 직접 펄스를 생성한다.
 *
 * 핸드셰이크 (2026-08-31 확정, docs/02_IO_태그맵.md): X축과 동일 — 위치지령 레지스터에 값을
 * 쓰면 그 write 자체가 PLC 이동 트리거이고, 완료되면 이동완료 discrete input이 켜지며
 * 현재위치 레지스터에 도달 위치가 반영된다.
 *
 * ⚠️ Z축 수직 스트로크(이동 가능 범위)는 아직 미정 (docs/02_IO_태그맵.md 참고) — X축처럼
 * 범위를 미리 막는 검증은 넣지 않는다 (모르는 값을 임의로 채우지 않음, CLAUDE.md 원칙).
 * 실제 상한 방어는 PLC측 리미트가 담당한다.
 * 원점/리미트 센서 구성 (2026-08-31 확인): X축과 동일 — 최대리밋 1개 + 최소리밋 1개 + 회전감지센서 1개
 *
 * 역할: servoAxisX.js와 동일한 패턴 — 상태 읽기/지령 전달만 담당, 위치제어 로직은 재구현하지 않음.
 * 토크/전류, 시운전용 속도지령(2026-08-31 신규 제안, 수동화면 개편)도 여기서 함께 다룬다 —
 * 제안값(0.01 단위/mm/s), 실제 스케일/최대치는 PLC·드라이브 사양서 확인 필요.
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { discreteInputs, holdingRegisters } = require("../../modbus/registerMap");

const POSITION_UNIT_MM = 0.1; // 위치지령/현재위치 레지스터 1 카운트 = 0.1mm (제안값, docs/02 참고)

// 목표위치(mm)를 위치지령 레지스터에 쓴다. 이 write 자체가 PLC 이동 트리거다.
// 스트로크 상한이 미정이라 여기서는 음수만 막는다 — 실제 상한 방어는 PLC측 리미트가 담당.
async function moveTo(modbusClient, mm) {
  if (mm < 0) {
    throw new Error(`Z축 목표위치 ${mm}mm 는 음수일 수 없음`);
  }
  const raw = Math.round(mm / POSITION_UNIT_MM);
  await modbusClient.writeRegister(holdingRegisters.노즐Z축_위치지령.addr, raw);
}

// 시운전용 속도지령(mm/s) — 기존 위치지령(moveTo)과 별개의 파라미터, 값만 레지스터에 저장된다
async function setSpeed(modbusClient, mmPerSec) {
  if (mmPerSec < 0) {
    throw new Error(`Z축 시운전 속도 ${mmPerSec}mm/s 는 음수일 수 없음`);
  }
  await modbusClient.writeRegister(holdingRegisters.노즐Z축_속도지령.addr, Math.round(mmPerSec));
}

// 최대/최소 리밋, 회전감지, 이동완료, 현재위치(mm 환산), 토크/전류 상태를 읽어 HMI에 표시할 형태로 반환
async function readStatus(modbusClient) {
  const [maxLimit] = await modbusClient.readDiscreteInputs(discreteInputs.노즐Z축_최대리밋.addr, 1);
  const [minLimit] = await modbusClient.readDiscreteInputs(discreteInputs.노즐Z축_최소리밋.addr, 1);
  const [rotationDetected] = await modbusClient.readDiscreteInputs(discreteInputs.노즐Z축_회전감지.addr, 1);
  const [moveDone] = await modbusClient.readDiscreteInputs(discreteInputs.노즐Z축_이동완료.addr, 1);
  const [currentRaw] = await modbusClient.readHoldingRegisters(holdingRegisters.노즐Z축_현재위치.addr, 1);
  const [torqueRaw] = await modbusClient.readHoldingRegisters(holdingRegisters.노즐Z축_토크.addr, 1);
  const [currentAmpRaw] = await modbusClient.readHoldingRegisters(holdingRegisters.노즐Z축_전류.addr, 1);
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
