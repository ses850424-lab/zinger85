/**
 * 2026-08-31 차량 기종별 노즐 경로(웨이포인트) 관리 검증 스크립트.
 * docs/05_차량기종.md, PROJECT_PLAN 패턴과 동일하게 실제 프로세스를 띄워서 검증한다.
 *
 * 확인 항목:
 *  1. vehicleModelRecipe.transferPath() — 웨이포인트를 하나씩 전송하면 경로_저장개수가 순서대로
 *     올라가고, 시뮬레이터의 레시피 메모리(vehicleModelWaypoints)에 실제로 쌓이는지
 *  2. vehicleModelStore — JSON 파일에 addWaypoint/deleteWaypoint가 실제로 반영되는지
 *  3. wsServer 명령(vehicleModel.selectModel/addWaypointFromCurrentPosition/deleteWaypoint/
 *     transferToPlc)이 ws 클라이언트를 통해 왕복하는지
 *
 * server/data/vehicleModels.json은 실제 데이터 파일이라, 테스트 시작 전 내용을 백업해뒀다가
 * 끝나면 그대로 복원한다(테스트로 더럽히지 않기 위함).
 *
 * 실행: node server/test/phase6_vehicleModel.manual.js
 */

const fs = require("fs");
const WebSocket = require("ws");

const registerMap = require("../src/modbus/registerMap");
const { createModbusClient } = require("../src/modbus/client");
const plcConfig = require("../src/config/plcConfig");
const wsConfig = require("../src/config/wsConfig");
const vehicleModelRecipe = require("../src/io/motor/vehicleModelRecipe");
const vehicleModelStore = require("../src/data/vehicleModelStore");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passCount = 0;
let failCount = 0;
function check(label, condition) {
  if (condition) {
    console.log(`[phase6-test] ✅ ${label}`);
    passCount++;
  } else {
    console.error(`[phase6-test] ❌ ${label}`);
    failCount++;
  }
}

(async () => {
  // 테스트로 건드릴 데이터 파일 백업
  const originalData = fs.readFileSync(vehicleModelStore.DATA_PATH, "utf-8");

  const simulator = require("../../simulator/src/mockPlcServer");
  await sleep(300);
  require("../src/api/wsServer"); // wsConfig.port 로 WS 서버까지 같이 띄움
  await sleep(1000);

  const modbus = createModbusClient();
  modbus.connect(plcConfig.simulator);
  for (let i = 0; i < 20 && !modbus.isOpen(); i++) await sleep(200);
  if (!modbus.isOpen()) {
    console.error("[phase6-test] modbus 연결 실패");
    process.exit(1);
  }

  try {
    // 1. vehicleModelRecipe.transferPath 직접 검증
    const waypoints = [
      { x: 10, z: 20 },
      { x: 15, z: 25 },
      { x: 20, z: 30 },
    ];
    await vehicleModelRecipe.transferPath(modbus, "FF", 3, waypoints);
    const savedCount = await vehicleModelRecipe.readSavedCount(modbus);
    check("경로_저장개수가 전송한 점 개수와 일치 (3개)", savedCount === 3);
    const recipe = simulator.vehicleModelWaypoints["FF-3"];
    check(
      "시뮬레이터 레시피 메모리에 좌표가 정확히 기록됨",
      recipe && recipe[0].x === 100 && recipe[0].z === 200 && recipe[2].x === 200 && recipe[2].z === 300
    );

    // 2. vehicleModelStore 파일 반영 검증
    vehicleModelStore.addWaypoint("FR", 5, { x: 1, z: 2 });
    vehicleModelStore.addWaypoint("FR", 5, { x: 3, z: 4 });
    let model = vehicleModelStore.getModel("FR", 5);
    check("addWaypoint 2회 후 파일에 2개 저장됨", model.waypoints.length === 2 && model.waypoints[1].x === 3);
    vehicleModelStore.deleteWaypoint("FR", 5, 0);
    model = vehicleModelStore.getModel("FR", 5);
    check("deleteWaypoint 후 1개 남고 값이 맞음", model.waypoints.length === 1 && model.waypoints[0].x === 3);

    // 3. wsServer 명령 왕복 검증
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

    ws.send(JSON.stringify({ type: "command", action: "vehicleModel.selectModel", payload: { category: "FF", number: 7 } }));
    await sleep(500);
    let latest = states[states.length - 1];
    check("vehicleModel.selectModel 반영 (selectedVehicleModel)", latest.selectedVehicleModel.category === "FF" && latest.selectedVehicleModel.number === 7);

    // 노즐 X/Z를 특정 위치로 이동시켜서 "현재 위치 추가"가 그 값을 쓰는지 확인
    ws.send(JSON.stringify({ type: "command", action: "servoAxisX.moveTo", payload: { mm: 55.5 } }));
    ws.send(JSON.stringify({ type: "command", action: "servoAxisZ.moveTo", payload: { mm: 66.6 } }));
    await sleep(1500);
    ws.send(JSON.stringify({ type: "command", action: "vehicleModel.addWaypointFromCurrentPosition" }));
    await sleep(500);
    latest = states[states.length - 1];
    const addedWp = latest.selectedVehicleModelDetail.waypoints.slice(-1)[0];
    // 부동소수점 오차 대비 근사 비교 (currentPositionMm = raw * 0.1 계산 과정에서 생길 수 있음)
    check(
      "addWaypointFromCurrentPosition이 현재 서보 위치를 그대로 기록",
      addedWp && Math.abs(addedWp.x - 55.5) < 0.01 && Math.abs(addedWp.z - 66.6) < 0.01
    );

    const deleteIndex = latest.selectedVehicleModelDetail.waypoints.length - 1;
    ws.send(
      JSON.stringify({ type: "command", action: "vehicleModel.deleteWaypoint", payload: { category: "FF", number: 7, index: deleteIndex } })
    );
    await sleep(500);
    latest = states[states.length - 1];
    check("deleteWaypoint 명령으로 방금 추가한 점 삭제됨", latest.selectedVehicleModelDetail.waypoints.length === deleteIndex);

    // FF-7에 점 2개를 채운 뒤 PLC로 전달
    vehicleModelStore.addWaypoint("FF", 7, { x: 5, z: 5 });
    vehicleModelStore.addWaypoint("FF", 7, { x: 8, z: 8 });
    ws.send(JSON.stringify({ type: "command", action: "vehicleModel.transferToPlc", payload: { category: "FF", number: 7 } }));
    await sleep(2000);
    const ff7Recipe = simulator.vehicleModelWaypoints["FF-7"];
    check("transferToPlc 명령으로 FF-7 경로가 시뮬레이터 레시피에 반영됨", ff7Recipe && ff7Recipe.length >= 2);

    ws.close();
  } catch (err) {
    console.error("[phase6-test] 오류:", err.message);
    failCount++;
  } finally {
    // 데이터 파일 원복
    fs.writeFileSync(vehicleModelStore.DATA_PATH, originalData, "utf-8");
    console.log("[phase6-test] server/data/vehicleModels.json 원복 완료");

    modbus.disconnect();
    console.log(`[phase6-test] 결과: 성공 ${passCount} / 실패 ${failCount}`);
    process.exit(failCount > 0 ? 1 : 0);
  }
})();
