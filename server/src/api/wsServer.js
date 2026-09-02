/**
 * HMI ↔ 미들웨어 실시간 통신 (WebSocket).
 *
 * 역할:
 *  - 서버 → HMI: 시퀀스 단계, 센서 상태, 알람 상태 push
 *  - HMI → 서버: 자동/수동 모드 전환, 사이클 시작/정지, 회전속도 설정값, 수동모드 개별 조작 명령
 *
 * 근거: docs/01_설비개요.md 6항 HMI 화면 요구사항 (기획서 인용), docs/02_IO_태그맵.md
 *
 * ⚠️ 이 파일도 안전판단을 하지 않는다 — 비상정지/도어/펌프이상을 감지해도 "정지시키는" 로직은
 * 없다. 감지된 사실을 알람으로 기록하고 HMI에 표시만 한다 (CLAUDE.md 원칙).
 *
 * 개발 단계 기본값: plcConfig.simulator 에 연결한다. 실PLC 연동(Phase 6) 시 plcConfig.plc 로
 * 바꾸면 된다 — 지금은 하드코딩하지 않고 이 주석으로만 남겨둔다.
 */

const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const { createModbusClient } = require("../modbus/client");
const { createStateMachine, DEFAULT_POLLING_INTERVAL_MS } = require("../sequence/stateMachine");
const plcConfig = require("../config/plcConfig");
const wsConfig = require("../config/wsConfig");
const registerMap = require("../modbus/registerMap");

const positionCylinder = require("../io/cylinder/positionCylinder");
const liftCylinder = require("../io/cylinder/liftCylinder");
const nozzleRotationCylinder = require("../io/cylinder/nozzleRotationCylinder");
const servoAxisX = require("../io/motor/servoAxisX");
const servoAxisZ = require("../io/motor/servoAxisZ");
const inverterRotation = require("../io/motor/inverterRotation");
const highPressurePump = require("../io/motor/highPressurePump");
const doorInterlock = require("../io/sensor/doorInterlock");
const estop = require("../io/sensor/estop");
const proximitySensors = require("../io/sensor/proximitySensors");
const vehicleModelRecipe = require("../io/motor/vehicleModelRecipe");
const vehicleModelStore = require("../data/vehicleModelStore");

// logs/ 폴더 경로 (server/src/api/ 기준 3단계 위 = 저장소 루트)
const LOGS_DIR = path.join(__dirname, "../../../logs");
const ALARM_LOG_PATH = path.join(LOGS_DIR, "alarms.log");
const CYCLE_COUNT_PATH = path.join(LOGS_DIR, "cycleCount.json");
const MAX_RECENT_ALARMS = 20;

// 사이클카운트를 파일에서 읽어온다 (프로세스 재시작해도 값 유지)
function loadCycleCount() {
  try {
    const raw = fs.readFileSync(CYCLE_COUNT_PATH, "utf-8");
    return JSON.parse(raw).count || 0;
  } catch {
    return 0;
  }
}

function saveCycleCount(count) {
  try {
    fs.writeFileSync(CYCLE_COUNT_PATH, JSON.stringify({ count }), "utf-8");
  } catch (err) {
    console.error("[wsServer] 사이클카운트 저장 실패:", err.message);
  }
}

let cycleCount = loadCycleCount();
const recentAlarms = [];

// 알람 1건을 in-memory 목록(HMI로 push할 최근 목록)과 파일(logs/alarms.log, JSONL)에 기록
function recordAlarm(message) {
  const entry = { time: new Date().toISOString(), message };
  recentAlarms.unshift(entry);
  if (recentAlarms.length > MAX_RECENT_ALARMS) recentAlarms.length = MAX_RECENT_ALARMS;
  try {
    fs.appendFileSync(ALARM_LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    console.error("[wsServer] 알람 로그 기록 실패:", err.message);
  }
  console.warn(`[wsServer] 알람: ${message}`);
}

const modbus = createModbusClient();
modbus.connect(plcConfig.simulator);

const stateMachine = createStateMachine(modbus, registerMap, plcConfig);
// sequenceStep 자체는 stateMachine이 내부적으로 최신값을 계속 폴링해서 들고 있는다.
// 여기서는 변화가 생겼다는 사실만 필요할 뿐, 값은 매번 getCurrentStep()으로 꺼내 쓴다.
stateMachine.start(() => {});

let mode = "auto"; // HMI가 마지막으로 요청한 모드 (표시용 — 실제 허용 판단은 PLC 몫)

// 기종 티칭 화면에서 "지금 편집 중인 모델" — server/data/vehicleModels.json 자체엔 저장하지 않는
// 런타임 상태(서버 재시작하면 초기화됨). { category: "FF"|"FR", number: 1~10 } 또는 null
let selectedVehicleModel = null;
// 경로 전달(vehicleModelRecipe.transferPath) 진행 상황 — HMI 진행률 표시용, 전달 중이 아니면 null
let vehicleModelTransferProgress = null;

// 알람을 "off→on 전이"에서만 1번 기록하기 위한 이전 상태 기억용 변수들
let prevEstopPressed = false;
let prevDoorOpenDuringCycle = false;
let prevPumpAbnormal = false;
let prevSequenceStep = null;

// PLC(Modbus) 연결이 끊긴 동안에도 HMI가 "마지막 값을 정상 상태인 것처럼" 계속 표시하지
// 않도록, 마지막으로 성공한 센서 스냅샷을 따로 들고 있다가 connected:false와 함께 내보낸다.
let lastSensorsSnapshot = null;

const wss = new WebSocket.Server({ port: wsConfig.port });
console.log(`[wsServer] WebSocket 서버 시작: ws://0.0.0.0:${wsConfig.port}`);

function broadcastState(snapshot) {
  const message = JSON.stringify({ type: "state", ...snapshot });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  });
}

// state 브로드캐스트 메시지의 공통 형태를 만든다. connected:false일 때도 화면이 계속
// 무언가를 그릴 수 있도록 sensors는 항상 마지막으로 성공한 값(lastSensorsSnapshot, 없으면 null)을
// 담아 보내되, connected 필드로 "이 값이 지금 최신인지"를 HMI가 판단해서 배너로 알리게 한다.
function buildSnapshot(connected, sequenceStep) {
  return {
    connected,
    sequenceStep,
    mode,
    sensors: lastSensorsSnapshot,
    alarms: recentAlarms,
    cycleCount,
    vehicleModels: vehicleModelStore.listSummary(),
    selectedVehicleModel,
    selectedVehicleModelDetail: selectedVehicleModel
      ? vehicleModelStore.getModel(selectedVehicleModel.category, selectedVehicleModel.number)
      : null,
    vehicleModelTransferProgress,
  };
}

// 모든 어댑터 상태를 모아 HMI에 한 번에 push하는 주기 작업.
// 알람 감지(전이 시에만 기록)와 사이클카운트 증가(9단계 도달 시에만)도 여기서 처리한다.
async function pollAndBroadcast() {
  // 워치독이 이미 연결 끊김을 감지한 상태라면 Modbus 읽기를 시도조차 하지 않고
  // 바로 connected:false로 알린다 — "마지막 값을 정상인 것처럼" 들고 있지 않기 위함.
  if (!modbus.isOpen()) {
    broadcastState(buildSnapshot(false, stateMachine.getCurrentStep()));
    return;
  }

  try {
    const sequenceStep = stateMachine.getCurrentStep();

    const [doorStatus, estopStatus, pumpStatus, proximity, servoX, servoZ, inverter, nozzleRotation] = await Promise.all([
      doorInterlock.readStatus(modbus),
      estop.readStatus(modbus),
      highPressurePump.readStatus(modbus),
      proximitySensors.readAll(modbus),
      servoAxisX.readStatus(modbus),
      servoAxisZ.readStatus(modbus),
      inverterRotation.readStatus(modbus),
      nozzleRotationCylinder.readStatus(modbus),
    ]);

    if (estopStatus.pressed && !prevEstopPressed) recordAlarm("비상정지 눌림");
    prevEstopPressed = estopStatus.pressed;

    // 대기(0단계) 중이 아닐 때 도어가 열려있으면 알람 (실제 정지는 PLC/하드와이어드가 수행)
    const doorOpenDuringCycle = !doorStatus.closedAndLocked && sequenceStep !== null && sequenceStep !== 0;
    if (doorOpenDuringCycle && !prevDoorOpenDuringCycle) recordAlarm("사이클 진행 중 도어 열림 감지");
    prevDoorOpenDuringCycle = doorOpenDuringCycle;

    const pumpAbnormal = pumpStatus.pressureAbnormal || pumpStatus.flowAbnormal;
    if (pumpAbnormal && !prevPumpAbnormal) {
      recordAlarm(`고압펌프 이상 감지 (압력이상=${pumpStatus.pressureAbnormal}, 유량이상=${pumpStatus.flowAbnormal})`);
    }
    prevPumpAbnormal = pumpAbnormal;

    if (sequenceStep === 9 && prevSequenceStep !== 9) {
      cycleCount += 1;
      saveCycleCount(cycleCount);
    }
    prevSequenceStep = sequenceStep;

    lastSensorsSnapshot = { door: doorStatus, estop: estopStatus, pump: pumpStatus, proximity, servoX, servoZ, inverter, nozzleRotation };
    broadcastState(buildSnapshot(true, sequenceStep));
  } catch (err) {
    // 읽기 도중 연결이 끊긴 경우 — client.js 의 재접속 로직이 알아서 복구하므로 여기서는
    // 재시도하지 않고, 다음 poll부터는 위 isOpen() 체크가 connected:false를 계속 알린다.
    console.error("[wsServer] 상태 조회 실패:", err.message);
    broadcastState(buildSnapshot(false, stateMachine.getCurrentStep()));
  }
}

const POLL_INTERVAL_MS = plcConfig.plc.pollingIntervalMs || DEFAULT_POLLING_INTERVAL_MS;
setInterval(pollAndBroadcast, POLL_INTERVAL_MS);

// HMI가 { type:"command", action:"...", payload:{...} } 형태로 보내는 명령을 어댑터 호출로 라우팅
const COMMAND_HANDLERS = {
  cycleStart: () => modbus.writeCoil(registerMap.coils.오토사이클_시작.addr, true),
  cycleStop: () => modbus.writeCoil(registerMap.coils.오토사이클_정지.addr, true),
  setMode: (payload) => {
    mode = payload.mode === "manual" ? "manual" : "auto";
    return modbus.writeCoil(registerMap.coils.운전모드_수동.addr, mode === "manual");
  },
  setRotationSpeed: (payload) => inverterRotation.setSpeed(modbus, payload.rpm),
  "positionCylinder.advance": () => positionCylinder.advance(modbus),
  "positionCylinder.retract": () => positionCylinder.retract(modbus),
  "liftCylinder.raise": () => liftCylinder.raise(modbus),
  "liftCylinder.lower": () => liftCylinder.lower(modbus),
  "servoAxisX.moveTo": (payload) => servoAxisX.moveTo(modbus, payload.mm),
  "servoAxisZ.moveTo": (payload) => servoAxisZ.moveTo(modbus, payload.mm),
  "servoAxisX.setSpeed": (payload) => servoAxisX.setSpeed(modbus, payload.mmPerSec),
  "servoAxisZ.setSpeed": (payload) => servoAxisZ.setSpeed(modbus, payload.mmPerSec),
  "pump.on": () => highPressurePump.turnOn(modbus),
  "pump.off": () => highPressurePump.turnOff(modbus),
  "nozzleRotationCylinder.advance": () => nozzleRotationCylinder.advance(modbus),
  "nozzleRotationCylinder.retract": () => nozzleRotationCylinder.retract(modbus),
  "door.open": () => doorInterlock.open(modbus),
  "door.close": () => doorInterlock.close(modbus),
  "door.setSealing": (payload) => doorInterlock.setSealing(modbus, payload.on),

  // 기종별 노즐 경로 티칭 (docs/05_차량기종.md)
  "vehicleModel.selectModel": (payload) => {
    selectedVehicleModel = { category: payload.category, number: payload.number };
  },
  "vehicleModel.addWaypointFromCurrentPosition": async () => {
    if (!selectedVehicleModel) throw new Error("먼저 기종을 선택하세요");
    const [servoXStatus, servoZStatus] = await Promise.all([servoAxisX.readStatus(modbus), servoAxisZ.readStatus(modbus)]);
    vehicleModelStore.addWaypoint(selectedVehicleModel.category, selectedVehicleModel.number, {
      x: servoXStatus.currentPositionMm,
      z: servoZStatus.currentPositionMm,
    });
  },
  "vehicleModel.deleteWaypoint": (payload) => {
    vehicleModelStore.deleteWaypoint(payload.category, payload.number, payload.index);
  },
  "vehicleModel.transferToPlc": async (payload) => {
    const model = vehicleModelStore.getModel(payload.category, payload.number);
    vehicleModelTransferProgress = { category: payload.category, number: payload.number, done: 0, total: model.waypoints.length };
    try {
      await vehicleModelRecipe.transferPath(modbus, payload.category, payload.number, model.waypoints, (done, total) => {
        vehicleModelTransferProgress = { category: payload.category, number: payload.number, done, total };
      });
    } finally {
      vehicleModelTransferProgress = null;
    }
  },
};

wss.on("connection", (ws) => {
  console.log("[wsServer] HMI 클라이언트 접속");

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.error("[wsServer] 잘못된 메시지 형식:", err.message);
      return;
    }
    if (msg.type !== "command") return;

    const handler = COMMAND_HANDLERS[msg.action];
    if (!handler) {
      console.error(`[wsServer] 알 수 없는 명령: ${msg.action}`);
      return;
    }
    try {
      await handler(msg.payload || {});
    } catch (err) {
      console.error(`[wsServer] 명령 처리 실패(${msg.action}):`, err.message);
    }
  });

  ws.on("close", () => console.log("[wsServer] HMI 클라이언트 연결 종료"));
});

process.on("SIGINT", () => {
  console.log("[wsServer] 종료 중...");
  stateMachine.stop();
  modbus.disconnect();
  wss.close(() => process.exit(0));
});

module.exports = { wss };
