/**
 * 차량 기종별 노즐 경로(웨이포인트) 데이터 저장소.
 * 근거: docs/05_차량기종.md — FF/FR 각 10개 기종, 기종마다 노즐 X/Z 경로(좌표점 리스트)가 다르다.
 *
 * server/data/vehicleModels.json 이 단일 진실 소스다. 이 파일이 그 JSON을 읽고 쓰는
 * 유일한 통로 — registerMap.js가 docs/02를 코드로 옮긴 것과 같은 역할이라고 보면 된다.
 * 실제 기종명은 비어있는 채로 시작한다(CLAUDE.md 원칙 — 모르는 값을 임의로 채우지 않음).
 */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "../../data/vehicleModels.json");

function load() {
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  return JSON.parse(raw);
}

function save(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function getModel(category, number) {
  const data = load();
  const list = data.categories[category];
  if (!list) throw new Error(`알 수 없는 카테고리: ${category}`);
  const model = list[number - 1];
  if (!model) throw new Error(`알 수 없는 모델 번호: ${category}-${number}`);
  return model;
}

// 웨이포인트를 목록 맨 뒤에 추가하고 파일에 저장한다
function addWaypoint(category, number, point) {
  const data = load();
  const model = data.categories[category][number - 1];
  model.waypoints.push({ x: point.x, z: point.z });
  save(data);
  return model;
}

// 인덱스로 웨이포인트 1개를 삭제하고 파일에 저장한다
function deleteWaypoint(category, number, index) {
  const data = load();
  const model = data.categories[category][number - 1];
  model.waypoints.splice(index, 1);
  save(data);
  return model;
}

// 전체 기종 목록(카테고리/번호/이름/웨이포인트 개수)을 HMI에 보여줄 요약 형태로 반환
function listSummary() {
  const data = load();
  const summarize = (list) => list.map((m) => ({ id: m.id, name: m.name, waypointCount: m.waypoints.length }));
  return {
    FF: summarize(data.categories.FF),
    FR: summarize(data.categories.FR),
  };
}

module.exports = { load, save, getModel, addWaypoint, deleteWaypoint, listSummary, DATA_PATH };
