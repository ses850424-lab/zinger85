/**
 * Phase 4 wsServer.js 수동 검증 스크립트.
 *
 * 시뮬레이터(mockPlcServer.js)와 wsServer.js를 이 프로세스에 직접 require한다 — 비상정지처럼
 * discrete input(읽기전용)인 신호는 실제 Modbus 클라이언트로 쓸 수 없어서(FC02는 읽기 전용
 * 함수코드라 대응하는 "쓰기" 함수코드가 없음), 알람 감지를 테스트하려면 시뮬레이터의 가상
 * 레지스터 배열에 직접 접근해야 하기 때문이다.
 *
 * ws 클라이언트로 HMI를 흉내내며: 명령 전송 → 시뮬레이터 레지스터 반영 → 상태 push 수신까지
 * 왕복을 확인한다. PROJECT_PLAN.md Phase 4 완료조건을 이 스크립트로 실증한다.
 *
 * 실행: node server/test/phase4_wsServer.manual.js
 * (simulator를 미리 켤 필요 없음 — 이 스크립트가 직접 시뮬레이터 모듈을 불러온다)
 */

const WebSocket = require("ws");
const registerMap = require("../src/modbus/registerMap");
const wsConfig = require("../src/config/wsConfig");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passCount = 0;
let failCount = 0;

function check(label, condition) {
  if (condition) {
    console.log(`[phase4-test] ✅ ${label}`);
    passCount++;
  } else {
    console.error(`[phase4-test] ❌ ${label}`);
    failCount++;
  }
}

(async () => {
  // 1. 시뮬레이터를 이 프로세스에 직접 불러온다 (discreteInputs 배열 직접 조작용)
  const simulator = require("../../simulator/src/mockPlcServer");
  await sleep(300); // 리스닝 시작 대기

  // 2. wsServer.js를 불러온다 (내부적으로 시뮬레이터에 접속 + WS 서버 오픈)
  require("../src/api/wsServer");
  await sleep(1000); // modbus 연결 + 최초 폴링 대기

  // 3. HMI를 흉내내는 ws 클라이언트로 접속
  const ws = new WebSocket(`ws://127.0.0.1:${wsConfig.port}`);
  const states = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "state") states.push(msg);
  });

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  for (let i = 0; i < 20 && states.length === 0; i++) await sleep(200);
  check("최초 state 메시지 수신", states.length > 0);
  const first = states[0] || {};
  check(
    "state 메시지에 필요한 필드 포함",
    "sequenceStep" in first && "sensors" in first && "alarms" in first && "cycleCount" in first
  );

  // 4. setRotationSpeed 명령 → 레지스터/운전상태 반영 확인
  ws.send(JSON.stringify({ type: "command", action: "setRotationSpeed", payload: { rpm: 15 } }));
  await sleep(600);
  check(
    "회전속도 지령 반영 (홀딩레지스터)",
    simulator.holdingRegisters[registerMap.holdingRegisters.파렛트회전_속도지령.addr] === 15
  );
  check(
    "회전속도 지령 후 운전상태 on",
    simulator.discreteInputs[registerMap.discreteInputs.파렛트회전_운전상태.addr] === 1
  );

  // 5. 실린더 전진 명령 → 완료센서 반영 확인 (mockPlcServer 지연 1500ms보다 여유있게 대기)
  ws.send(JSON.stringify({ type: "command", action: "positionCylinder.advance" }));
  await sleep(2000);
  check(
    "위치이동실린더 전진 명령 → 완료센서 반영",
    simulator.discreteInputs[registerMap.discreteInputs.위치이동실린더_전진완료.addr] === 1
  );

  // 6. cycleStart 명령 → 코일 반영 확인
  ws.send(JSON.stringify({ type: "command", action: "cycleStart" }));
  await sleep(300);
  check("오토사이클_시작 코일 반영", simulator.coils[registerMap.coils.오토사이클_시작.addr] === 1);

  // 7. 알람: 비상정지 discrete input을 시뮬레이터 배열에 직접 세팅해 "눌림"을 흉내낸 뒤,
  //    다음 폴링에서 wsServer가 알람으로 감지해 state 메시지의 alarms에 반영하는지 확인
  simulator.discreteInputs[registerMap.discreteInputs.비상정지.addr] = 1;
  await sleep(600);
  const latest = states[states.length - 1] || { alarms: [] };
  check("비상정지 알람이 state 메시지에 반영됨", latest.alarms.some((a) => a.message.includes("비상정지")));

  console.log(`[phase4-test] 결과: 성공 ${passCount} / 실패 ${failCount}`);
  process.exit(failCount > 0 ? 1 : 0);
})();
