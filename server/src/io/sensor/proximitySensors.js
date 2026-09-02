/**
 * 근접센서/리미트센서류 상태 읽기 어댑터.
 * 대상: 위치이동실린더 전진/후진완료, 리프트실린더 상승/하강완료,
 *       노즐 X/Z축 최대·최소리밋 + 회전감지센서 (2026-08-31 축당 3개로 확정)
 * 근거: docs/02_IO_태그맵.md "Discrete Inputs" 표
 *
 * 역할: 상태 읽기 전용. 이 값을 근거로 자동 진행을 "결정"하지 않는다 — 그것은 PLC의 역할.
 * (개별 실린더 핸드셰이크가 필요한 곳은 io/cylinder/positionCylinder.js, liftCylinder.js 가
 *  각자 완료센서를 읽는다 — 이 파일은 여러 근접센서를 한 번에 조회하는 용도의 별도 집계 함수다)
 *
 * 모든 함수는 연결된 modbusClient(server/src/modbus/client.js 의 createModbusClient() 반환값)를
 * 인자로 받는다 — 이 파일 자체는 연결을 만들지 않고, 상위(향후 wsServer.js 등)가 주입한다.
 */

const { discreteInputs } = require("../../modbus/registerMap");

// 대상 근접센서/리미트센서 10종을 한 번에 읽어 { 신호명: boolean } 형태로 반환
async function readAll(modbusClient) {
  const names = [
    "위치이동실린더_전진완료",
    "위치이동실린더_후진완료",
    "리프트실린더_상승완료",
    "리프트실린더_하강완료",
    "노즐X축_최대리밋",
    "노즐X축_최소리밋",
    "노즐X축_회전감지",
    "노즐Z축_최대리밋",
    "노즐Z축_최소리밋",
    "노즐Z축_회전감지",
  ];

  const result = {};
  for (const name of names) {
    const [value] = await modbusClient.readDiscreteInputs(discreteInputs[name].addr, 1);
    result[name] = !!value;
  }
  return result;
}

module.exports = { readAll };
